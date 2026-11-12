-- This does not enable owner code sign-in or create/change any Auth user.
-- The configured code stays in Edge Function Secrets. Only the Edge backend
-- can register the result of a comparison or receive the existing owner ID.
create table training_code_private.owner_attempts (
 singleton boolean primary key default true check (singleton),
 failed_at timestamptz[] not null default '{}' check (cardinality(failed_at) <= 12),
 last_issued_at timestamptz
);
alter table training_code_private.owner_attempts enable row level security;
revoke all on training_code_private.owner_attempts from public, anon, authenticated, service_role;
grant select, update on training_code_private.owner_attempts to service_role;
insert into training_code_private.owner_attempts default values;

create function public.training_owner_code_attempt(p_match boolean)
returns jsonb
language plpgsql volatile security invoker set search_path = '' as $$
declare
 attempts training_code_private.owner_attempts%rowtype;
 recent timestamptz[];
 blocked_until timestamptz;
 checked_at timestamptz;
 owners uuid[];
begin
 select * into attempts from training_code_private.owner_attempts where singleton for update;
 if not found or p_match is null then return jsonb_build_object('error','unavailable'); end if;
 checked_at := clock_timestamp();
 select coalesce(array_agg(t order by t),'{}'::timestamptz[]) into recent
  from unnest(attempts.failed_at) as a(t) where t > checked_at - interval '24 hours';
 if cardinality(recent) >= 12 then blocked_until := recent[1] + interval '24 hours'; end if;
 if cardinality(recent) >= 5 and recent[cardinality(recent)-4] > checked_at - interval '15 minutes' then
  blocked_until := greatest(blocked_until,recent[cardinality(recent)-4]+interval '15 minutes');
 end if;
 if p_match then
  blocked_until := greatest(blocked_until,attempts.last_issued_at+interval '15 seconds');
 end if;
 if blocked_until > checked_at then
  return jsonb_build_object('error','limited','retry_after',
   greatest(1,ceil(extract(epoch from blocked_until-checked_at))::integer));
 end if;
 if not p_match then
  update training_code_private.owner_attempts set failed_at=array_append(recent,checked_at) where singleton;
  return jsonb_build_object('error','invalid_code');
 end if;
 -- Fail closed if owner access changes to zero owners or more than one owner.
 -- Never accept a user or role identifier from an unauthenticated request.
 select array_agg(user_id) into owners
 from (select user_id from public.access_users where role='owner' limit 2) a;
 if coalesce(cardinality(owners),0) <> 1 then return jsonb_build_object('error','unavailable'); end if;
 update training_code_private.owner_attempts set failed_at='{}',last_issued_at=checked_at where singleton;
 return jsonb_build_object('owner_id',owners[1]);
end
$$;
revoke all on function public.training_owner_code_attempt(boolean) from public, anon, authenticated;
grant execute on function public.training_owner_code_attempt(boolean) to service_role;

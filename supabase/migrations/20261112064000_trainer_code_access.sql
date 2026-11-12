-- Add a second, restricted sign-in for trainers. No existing Auth role or RLS
-- policy is changed. No code, verifier, or session is seeded by this migration.
create schema training_code_private;
revoke all on schema training_code_private from public, anon, authenticated;
grant usage on schema training_code_private to service_role;

create table training_code_private.config (
 singleton boolean primary key default true check (singleton),
 verifier text not null check (verifier ~ '^\$2[abxy]\$[0-9]{2}\$[./A-Za-z0-9]{53}$'),
 enabled boolean not null default false,
 code_version uuid not null default gen_random_uuid(),
 failed_at timestamptz[] not null default '{}' check (cardinality(failed_at) <= 24)
);
create table training_code_private.sessions (
 digest bytea primary key check (octet_length(digest) = 32),
 code_version uuid not null,
 expires_at timestamptz not null
);
create index trainer_code_session_expiry on training_code_private.sessions (expires_at);
alter table training_code_private.config enable row level security;
alter table training_code_private.sessions enable row level security;
revoke all on all tables in schema training_code_private from public, anon, authenticated, service_role;
grant select, update on training_code_private.config to service_role;
grant select, insert, delete on training_code_private.sessions to service_role;

-- The existing authenticated write policies require recorded_by = auth.uid().
-- Only the restricted server path writes NULL, meaning "shared trainer code."
alter table public.progress alter column recorded_by drop not null;
comment on column public.progress.recorded_by is 'Authenticated recorder; NULL means a recording through the shared trainer code.';

create function public.training_trainer_code(p_action text, p_data jsonb)
returns jsonb
language plpgsql volatile security invoker set search_path = '' as $$
declare
 cfg training_code_private.config%rowtype;
 recent timestamptz[];
 blocked_until timestamptz;
 checked_at timestamptz;
 token text;
 expiry timestamptz;
 target_member text := p_data->>'member_id';
 target_item text := p_data->>'item_id';
 target_status text := p_data->>'status';
 target_department text := p_data->>'department';
begin
 if p_action = 'sign_in' then
  if jsonb_typeof(p_data->'pin') is distinct from 'string'
     or (p_data->>'pin') !~ '^[0-9]{5,12}$' then
   return jsonb_build_object('error', 'invalid_request');
  end if;
  -- A single row lock makes the rolling limits apply across devices and workers.
  select * into cfg from training_code_private.config where singleton for update;
  if not found or not cfg.enabled then return jsonb_build_object('error', 'unavailable'); end if;
  checked_at := clock_timestamp();
  select coalesce(array_agg(t order by t), '{}'::timestamptz[]) into recent
   from unnest(cfg.failed_at) as a(t) where t > checked_at - interval '24 hours';
  if cardinality(recent) >= 24 then blocked_until := recent[1] + interval '24 hours'; end if;
  if cardinality(recent) >= 12 and recent[cardinality(recent)-11] > checked_at - interval '30 minutes' then
   blocked_until := greatest(blocked_until, recent[cardinality(recent)-11] + interval '30 minutes');
  end if;
  if blocked_until > checked_at then
   return jsonb_build_object('error', 'limited', 'retry_after',
      greatest(1, ceil(extract(epoch from blocked_until - checked_at))::integer));
  end if;
  if extensions.crypt(p_data->>'pin', cfg.verifier) is distinct from cfg.verifier then
   update training_code_private.config set failed_at = array_append(recent, checked_at) where singleton;
   return jsonb_build_object('error', 'invalid_code');
  end if;
  delete from training_code_private.sessions where expires_at <= checked_at or code_version <> cfg.code_version;
  if (select count(*) from training_code_private.sessions) >= 48 then
   return jsonb_build_object('error', 'unavailable');
  end if;
  token := encode(extensions.gen_random_bytes(32), 'hex');
  expiry := checked_at + interval '8 hours';
  insert into training_code_private.sessions(digest, code_version, expires_at)
   values (extensions.digest(token,'sha256'), cfg.code_version, expiry);
  return jsonb_build_object('token', token, 'expires_at', floor(extract(epoch from expiry))::bigint);
 end if;

 token := p_data->>'token';
 if token is null or token !~ '^[0-9a-f]{64}$' or not exists (
  select 1 from training_code_private.sessions s
  join training_code_private.config c on c.singleton and c.enabled and c.code_version=s.code_version
  where s.digest=extensions.digest(token,'sha256') and s.expires_at > clock_timestamp()
 ) then return jsonb_build_object('error', 'session_expired'); end if;

 if p_action = 'team' then
  return jsonb_build_object(
   'members', coalesce((select jsonb_agg(
      jsonb_build_object('id',m.id,'name',m.name,'role',m.role,'status_boh',m.status_boh,'status_foh',m.status_foh)
      order by m.name,m.id) from public.members m), '[]'::jsonb),
   'progress', coalesce((select jsonb_agg(jsonb_build_object(
      'member_id',p.member_id,'item_id',p.item_id,'status',p.status))
     from public.progress p join public.items i on i.id=p.item_id and not i.hidden), '[]'::jsonb));
 elsif p_action = 'save_progress' then
  if target_status is null or target_status not in ('Not started','In Training','Trained')
     or not exists (select 1 from public.members where id=target_member)
     or not exists (select 1 from public.items where id=target_item and not hidden) then
   return jsonb_build_object('error', 'invalid_request');
  end if;
  insert into public.progress(member_id,item_id,status,updated_at,recorded_by)
   values(target_member,target_item,target_status,clock_timestamp(),null)
  on conflict(member_id,item_id) do update set
   status=excluded.status,updated_at=excluded.updated_at,recorded_by=null;
 elsif p_action = 'save_overall' then
  if target_status is null or target_status not in ('In Training','Trained')
     or target_department is null or target_department not in ('BOH','FOH') then
   return jsonb_build_object('error', 'invalid_request');
  end if;
  if target_department = 'BOH' then
   update public.members set status_boh=target_status where id=target_member;
  else
   update public.members set status_foh=target_status where id=target_member;
  end if;
  if not found then return jsonb_build_object('error', 'invalid_request'); end if;
 elsif p_action = 'sign_out' then
  delete from training_code_private.sessions where digest=extensions.digest(token,'sha256');
 else
  return jsonb_build_object('error', 'invalid_request');
 end if;
 return '{"ok":true}'::jsonb;
end
$$;
revoke all on function public.training_trainer_code(text,jsonb) from public, anon, authenticated;
grant execute on function public.training_trainer_code(text,jsonb) to service_role;

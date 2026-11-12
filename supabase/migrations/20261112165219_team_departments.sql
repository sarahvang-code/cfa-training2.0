-- Preserve existing roster records and their progress. Old records start unassigned.
alter table public.members add column training_area text not null default 'UNASSIGNED'
 check (training_area in ('UNASSIGNED','FOH','BOH','BOTH'));

-- Extend only the backend RPC. The public and authenticated roles still cannot
-- call it; the existing trainer token check runs before roster operations.
create or replace function public.training_trainer_code(p_action text, p_data jsonb)
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
 target_area text := p_data->>'training_area';
 target_name text := nullif(btrim(regexp_replace(p_data->>'name','[[:space:]]+',' ','g')),'');
 created_id text;
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
      jsonb_build_object('id',m.id,'name',m.name,'role',m.role,'status_boh',m.status_boh,
                         'status_foh',m.status_foh,'training_area',m.training_area)
      order by m.name,m.id) from public.members m), '[]'::jsonb),
   'progress', coalesce((select jsonb_agg(jsonb_build_object(
      'member_id',p.member_id,'item_id',p.item_id,'status',p.status))
     from public.progress p join public.items i on i.id=p.item_id and not i.hidden), '[]'::jsonb));
 elsif p_action = 'add_member' then
  if jsonb_typeof(p_data->'name') is distinct from 'string'
     or target_name is null or char_length(target_name)>100
     or target_area is null or target_area not in ('FOH','BOH','BOTH') then
   return jsonb_build_object('error', 'invalid_request');
  end if;
  insert into public.members(id,name,role,training_area)
   values(gen_random_uuid()::text,target_name,'Team member',target_area)
   returning id into created_id;
  return jsonb_build_object('id',created_id);
 elsif p_action = 'assign_department' then
  if target_area is null or target_area not in ('FOH','BOH','BOTH') then
   return jsonb_build_object('error', 'invalid_request');
  end if;
  update public.members set training_area=target_area where id=target_member;
  if not found then return jsonb_build_object('error', 'invalid_request'); end if;
 elsif p_action = 'save_progress' then
  if target_status is null or target_status not in ('Not started','In Training','Trained') then
   return jsonb_build_object('error', 'invalid_request');
  end if;
  insert into public.progress(member_id,item_id,status,updated_at,recorded_by)
   select m.id,i.id,target_status,clock_timestamp(),null
   from public.members m
   join public.items i on i.id=target_item and not i.hidden
   join public.categories c on c.id=i.category_id
   where m.id=target_member and m.training_area in ('UNASSIGNED','BOTH',c.department)
  on conflict(member_id,item_id) do update set
   status=excluded.status,updated_at=excluded.updated_at,recorded_by=null;
  if not found then return jsonb_build_object('error', 'wrong_department'); end if;
 elsif p_action = 'save_overall' then
  if target_status is null or target_status not in ('In Training','Trained')
     or target_department is null or target_department not in ('BOH','FOH') then
   return jsonb_build_object('error', 'invalid_request');
  end if;
  if target_department = 'BOH' then
   update public.members set status_boh=target_status
    where id=target_member and training_area in ('UNASSIGNED','BOTH','BOH');
  else
   update public.members set status_foh=target_status
    where id=target_member and training_area in ('UNASSIGNED','BOTH','FOH');
  end if;
  if not found then return jsonb_build_object('error', 'wrong_department'); end if;
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

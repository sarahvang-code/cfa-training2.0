alter function public.training_role() security invoker;
create schema if not exists training_private;
revoke all on schema training_private from public,anon,authenticated;
create table training_private.invitations (
 email text primary key check (email=lower(trim(email))),
 role text not null check (role in ('owner','trainer','member'))
);
alter table training_private.invitations enable row level security;
revoke all on training_private.invitations from public,anon,authenticated;
create function training_private.grant_invited_training_access() returns trigger
language plpgsql security definer set search_path = '' as $$
declare invitation_role text;
begin
 if new.email_confirmed_at is null or new.email is null then return new; end if;
 select role into invitation_role from training_private.invitations where email=lower(trim(new.email));
 if invitation_role is not null then
  insert into public.access_users(user_id,role) values (new.id,invitation_role) on conflict (user_id) do nothing;
 end if;
 return new;
end;
$$;
revoke all on function training_private.grant_invited_training_access() from public,anon,authenticated;
create trigger grant_invited_training_access after insert or update of email_confirmed_at,last_sign_in_at
on auth.users for each row execute function training_private.grant_invited_training_access();

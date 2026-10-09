-- Restaurant Training: one restaurant per Supabase project.
-- Run once in the Supabase SQL Editor. No public signup access is granted.
begin;
create table public.categories (
 id text primary key default gen_random_uuid()::text,
 title text not null check (length(trim(title)) > 0),
 description text not null default '',
 department text not null check (department in ('BOH','FOH')),
 position integer not null default 0
);
create table public.items (
 id text primary key default gen_random_uuid()::text,
 category_id text not null references public.categories(id) on delete cascade,
 section text not null default 'Training checklist',
 title text not null check (length(trim(title)) > 0),
 notes text not null default '', link text not null default '',
 hidden boolean not null default false,
 position integer not null default 0,
 check (link = '' or link ~ '^https://')
);
create table public.members (
 id text primary key default gen_random_uuid()::text,
 name text not null check (length(trim(name)) > 0), role text not null default 'Team member',
 auth_user_id uuid unique references auth.users(id) on delete set null,
 status_boh text not null default 'In Training' check (status_boh in ('In Training','Trained')),
 status_foh text not null default 'In Training' check (status_foh in ('In Training','Trained'))
);
create table public.access_users (
 user_id uuid primary key references auth.users(id) on delete cascade,
 role text not null check (role in ('owner','trainer','member'))
);
create table public.progress (
 member_id text not null references public.members(id) on delete cascade,
 item_id text not null references public.items(id) on delete cascade,
 status text not null check (status in ('Not started','In Training','Trained')),
 updated_at timestamptz not null default now(),
 recorded_by uuid not null references auth.users(id),
 primary key (member_id,item_id)
);
create table public.settings (id integer primary key check(id=1), name text not null);
insert into public.settings values (1,'Restaurant Training');
create index items_category_idx on public.items(category_id);
create index members_auth_idx on public.members(auth_user_id);
create index progress_item_idx on public.progress(item_id);

create function public.training_role() returns text language sql stable security invoker
 set search_path = '' as $$
 select role from public.access_users where user_id = (select auth.uid());
$$;
revoke all on function public.training_role() from public, anon;
grant execute on function public.training_role() to authenticated;

alter table public.categories enable row level security;
alter table public.items enable row level security;
alter table public.members enable row level security;
alter table public.access_users enable row level security;
alter table public.progress enable row level security;
alter table public.settings enable row level security;
revoke all on public.categories,public.items,public.members,public.access_users,public.progress,public.settings from anon;
revoke all on public.access_users from authenticated;
grant select on public.access_users to authenticated;
grant select,insert,update,delete on public.categories,public.items,public.members,public.progress,public.settings to authenticated;

create policy own_access on public.access_users for select to authenticated using (user_id=(select auth.uid()));
create policy categories_read on public.categories for select to authenticated using ((select public.training_role()) is not null);
create policy categories_write on public.categories for all to authenticated using ((select public.training_role())='owner') with check ((select public.training_role())='owner');
create policy items_read on public.items for select to authenticated using ((select public.training_role()) is not null);
create policy items_write on public.items for all to authenticated using ((select public.training_role())='owner') with check ((select public.training_role())='owner');
create policy settings_read on public.settings for select to authenticated using ((select public.training_role()) is not null);
create policy settings_write on public.settings for all to authenticated using ((select public.training_role())='owner') with check ((select public.training_role())='owner');
create policy members_read on public.members for select to authenticated using (
 (select public.training_role()) in ('owner','trainer') or ((select public.training_role())='member' and auth_user_id=(select auth.uid()))
);
create policy members_write on public.members for all to authenticated using ((select public.training_role()) in ('owner','trainer')) with check ((select public.training_role()) in ('owner','trainer'));
create policy progress_read on public.progress for select to authenticated using (
 (select public.training_role()) in ('owner','trainer') or ((select public.training_role())='member' and exists(select 1 from public.members m where m.id=member_id and m.auth_user_id=(select auth.uid())))
);
create policy progress_insert on public.progress for insert to authenticated with check ((select public.training_role()) in ('owner','trainer') and recorded_by=(select auth.uid()));
create policy progress_update on public.progress for update to authenticated using ((select public.training_role()) in ('owner','trainer')) with check ((select public.training_role()) in ('owner','trainer') and recorded_by=(select auth.uid()));
create policy progress_delete on public.progress for delete to authenticated using ((select public.training_role()) in ('owner','trainer'));
commit;

-- Starter content is appended below. Add actual Pathway links in Edit Training.

begin;
insert into public.categories(id,title,description,department,position) values ('c0','Welcome & Restaurant Tour','A great first day starts here.','BOH',0);
insert into public.categories(id,title,description,department,position) values ('c1','BOH Food Safety','Practice the essentials with your trainer.','BOH',1);
insert into public.categories(id,title,description,department,position) values ('c2','Primary','Practice the essentials with your trainer.','BOH',2);
insert into public.categories(id,title,description,department,position) values ('c3','Secondary','Practice the essentials with your trainer.','BOH',3);
insert into public.categories(id,title,description,department,position) values ('c4','Machines','Practice the essentials with your trainer.','BOH',4);
insert into public.categories(id,title,description,department,position) values ('c5','Breading','Practice the essentials with your trainer.','BOH',5);
insert into public.categories(id,title,description,department,position) values ('c6','Fries','Practice the essentials with your trainer.','BOH',6);
insert into public.categories(id,title,description,department,position) values ('c7','RSA Assessment','Practice the essentials with your trainer.','BOH',7);
insert into public.categories(id,title,description,department,position) values ('c8','Closing','Practice the essentials with your trainer.','BOH',8);
insert into public.categories(id,title,description,department,position) values ('foh-0','Welcome & Restaurant Tour','Select a team member in Trainer View to record training status.','FOH',0);
insert into public.categories(id,title,description,department,position) values ('foh-1','FOH Food Safety','Select a team member in Trainer View to record training status.','FOH',1);
insert into public.categories(id,title,description,department,position) values ('foh-2','Winning Hearts Everyday','Select a team member in Trainer View to record training status.','FOH',2);
insert into public.categories(id,title,description,department,position) values ('foh-3','FOH Basic Training','Select a team member in Trainer View to record training status.','FOH',3);
insert into public.categories(id,title,description,department,position) values ('foh-4','Bagger Training','Select a team member in Trainer View to record training status.','FOH',4);
insert into public.categories(id,title,description,department,position) values ('foh-5','FSA Assessments','Select a team member in Trainer View to record training status.','FOH',5);
insert into public.categories(id,title,description,department,position) values ('foh-6','RSA Assessments','Select a team member in Trainer View to record training status.','FOH',6);
insert into public.categories(id,title,description,department,position) values ('foh-7','Closing','Select a team member in Trainer View to record training status.','FOH',7);
insert into public.items(id,category_id,section,title,notes,link,hidden,position) values ('i4-0','c4','Station essentials','Equipment overview','Example checklist item. Replace with your restaurant’s approved training.','',false,0);
insert into public.items(id,category_id,section,title,notes,link,hidden,position) values ('i4-1','c4','Station essentials','Safe operation and cleaning','Example checklist item. Replace with your restaurant’s approved training.','',false,1);
insert into public.items(id,category_id,section,title,notes,link,hidden,position) values ('i6-0','c6','Station essentials','Prepare the fry station','Example checklist item. Replace with your restaurant’s approved training.','',false,0);
insert into public.items(id,category_id,section,title,notes,link,hidden,position) values ('i6-1','c6','Station essentials','Review timers and holding procedures','Example checklist item. Replace with your restaurant’s approved training.','',false,1);
insert into public.items(id,category_id,section,title,notes,link,hidden,position) values ('i7-0','c7','Station essentials','Review restaurant safety expectations','Example checklist item. Replace with your restaurant’s approved training.','',false,0);
insert into public.items(id,category_id,section,title,notes,link,hidden,position) values ('i7-1','c7','Station essentials','Complete the trainer assessment','Example checklist item. Replace with your restaurant’s approved training.','',false,1);
insert into public.items(id,category_id,section,title,notes,link,hidden,position) values ('c0-ref-0','c0','Welcome','Clock In','','',false,0);
insert into public.items(id,category_id,section,title,notes,link,hidden,position) values ('c0-ref-1','c0','Welcome','Restaurant Tour','','',false,1);
insert into public.items(id,category_id,section,title,notes,link,hidden,position) values ('c0-ref-2','c0','What makes Chick-fil-A Unique?','How Truett Cathy Built a Good Name','','',false,2);
insert into public.items(id,category_id,section,title,notes,link,hidden,position) values ('c1-ref-0','c1','Food Safety Basics','Handwashing before food handling','','',false,0);
insert into public.items(id,category_id,section,title,notes,link,hidden,position) values ('c1-ref-1','c1','Food Safety Basics','Understand cross-contamination','','',false,1);
insert into public.items(id,category_id,section,title,notes,link,hidden,position) values ('c1-ref-2','c1','Food Safety Basics','Review approved food temperature procedures','','',false,2);
insert into public.items(id,category_id,section,title,notes,link,hidden,position) values ('c2-ref-0','c2','Station Setup','Prepare the primary station','','',false,0);
insert into public.items(id,category_id,section,title,notes,link,hidden,position) values ('c2-ref-1','c2','Orders','Build sandwiches','','',false,1);
insert into public.items(id,category_id,section,title,notes,link,hidden,position) values ('c2-ref-2','c2','Orders','Follow special-order instructions','','',false,2);
insert into public.items(id,category_id,section,title,notes,link,hidden,position) values ('c2-ref-3','c2','AHA + Communication','Communicate with bagger and breader','','',false,3);
insert into public.items(id,category_id,section,title,notes,link,hidden,position) values ('c2-ref-4','c2','AHA + Communication','Follow the PAN system','','',false,4);
insert into public.items(id,category_id,section,title,notes,link,hidden,position) values ('c2-ref-5','c2','AHA + Communication','Use AHA tracking','','',false,5);
insert into public.items(id,category_id,section,title,notes,link,hidden,position) values ('c3-ref-0','c3','Orders','Use nugget/strip box tabs and labels correctly','','',false,0);
insert into public.items(id,category_id,section,title,notes,link,hidden,position) values ('c3-ref-1','c3','Orders','Cobb/customized salads','','',false,1);
insert into public.items(id,category_id,section,title,notes,link,hidden,position) values ('c3-ref-2','c3','Orders','Place items in correct chutes','','',false,2);
insert into public.items(id,category_id,section,title,notes,link,hidden,position) values ('c3-ref-3','c3','Orders','Bake and bag cookies','','',false,3);
insert into public.items(id,category_id,section,title,notes,link,hidden,position) values ('c3-ref-4','c3','AHA + Communication','Communicate with bagger and breader','','',false,4);
insert into public.items(id,category_id,section,title,notes,link,hidden,position) values ('c3-ref-5','c3','AHA + Communication','Follow the PAN system','','',false,5);
insert into public.items(id,category_id,section,title,notes,link,hidden,position) values ('c3-ref-6','c3','AHA + Communication','Use AHA tracking','','',false,6);
insert into public.items(id,category_id,section,title,notes,link,hidden,position) values ('c5-ref-0','c5','Breading','Bread filets','','',false,0);
insert into public.items(id,category_id,section,title,notes,link,hidden,position) values ('c5-ref-1','c5','Breading','Bread nuggets','','',false,1);
insert into public.items(id,category_id,section,title,notes,link,hidden,position) values ('c5-ref-2','c5','Breading','Bread strips','','',false,2);
insert into public.items(id,category_id,section,title,notes,link,hidden,position) values ('c5-ref-3','c5','Coater + Milkwash','Follow chicken load amounts','','',false,3);
insert into public.items(id,category_id,section,title,notes,link,hidden,position) values ('c5-ref-4','c5','Coater + Milkwash','Add new coater when needed','','',false,4);
insert into public.items(id,category_id,section,title,notes,link,hidden,position) values ('c5-ref-5','c5','Coater + Milkwash','Properly sift coater','','',false,5);
insert into public.items(id,category_id,section,title,notes,link,hidden,position) values ('c5-ref-6','c5','Coater + Milkwash','Prepare milkwash','','',false,6);
insert into public.items(id,category_id,section,title,notes,link,hidden,position) values ('c5-ref-7','c5','Grilled + Rotation','Drop grilled filets/nuggets','','',false,7);
insert into public.items(id,category_id,section,title,notes,link,hidden,position) values ('c5-ref-8','c5','Grilled + Rotation','Review rotation with the trainer','','',false,8);
insert into public.items(id,category_id,section,title,notes,link,hidden,position) values ('c8-ref-0','c8','Closing Boards','Clean and sanitize boards','','',false,0);
insert into public.items(id,category_id,section,title,notes,link,hidden,position) values ('c8-ref-1','c8','Closing Boards','Restock the station','','',false,1);
insert into public.items(id,category_id,section,title,notes,link,hidden,position) values ('c8-ref-2','c8','Closing Machines','Complete machine cleaning procedures','','',false,2);
insert into public.items(id,category_id,section,title,notes,link,hidden,position) values ('c8-ref-3','c8','Closing Breading Table','Clean and sanitize the breading table','','',false,3);
insert into public.items(id,category_id,section,title,notes,link,hidden,position) values ('c8-ref-4','c8','Closing Dishes','Wash and organize dishes','','',false,4);
insert into public.items(id,category_id,section,title,notes,link,hidden,position) values ('foh-0-0','foh-0','Welcome','Clock In','','',false,0);
insert into public.items(id,category_id,section,title,notes,link,hidden,position) values ('foh-0-1','foh-0','Welcome','Restaurant Tour','','',false,1);
insert into public.items(id,category_id,section,title,notes,link,hidden,position) values ('foh-0-2','foh-0','What makes Chick-fil-A Unique?','How Truett Cathy Built a Good Name','','',false,2);
insert into public.items(id,category_id,section,title,notes,link,hidden,position) values ('foh-1-0','foh-1','Food Safety Basics','Handwashing before food handling','','',false,0);
insert into public.items(id,category_id,section,title,notes,link,hidden,position) values ('foh-1-1','foh-1','Food Safety Basics','Prevent cross-contamination','','',false,1);
insert into public.items(id,category_id,section,title,notes,link,hidden,position) values ('foh-1-2','foh-1','Food Safety Basics','Review approved cleaning and sanitizing procedures','','',false,2);
insert into public.items(id,category_id,section,title,notes,link,hidden,position) values ('foh-2-0','foh-2','Second-Mile Service','Understands the second-mile service portion of Winning Hearts Everyday','','',false,0);
insert into public.items(id,category_id,section,title,notes,link,hidden,position) values ('foh-2-1','foh-2','Second-Mile Service','Language of Hospitality','','',false,1);
insert into public.items(id,category_id,section,title,notes,link,hidden,position) values ('foh-2-2','foh-2','Second-Mile Service','Proactive','','',false,2);
insert into public.items(id,category_id,section,title,notes,link,hidden,position) values ('foh-2-3','foh-2','Second-Mile Service','Personal','','',false,3);
insert into public.items(id,category_id,section,title,notes,link,hidden,position) values ('foh-2-4','foh-2','Second-Mile Service','Generous','','',false,4);
insert into public.items(id,category_id,section,title,notes,link,hidden,position) values ('foh-2-5','foh-2','Second-Mile Service','Attentive and Friendly','','',false,5);
insert into public.items(id,category_id,section,title,notes,link,hidden,position) values ('foh-2-6','foh-2','Second-Mile Service','Above and Beyond','','',false,6);
insert into public.items(id,category_id,section,title,notes,link,hidden,position) values ('foh-2-7','foh-2','Second-Mile Service','Emotional Connections','','',false,7);
insert into public.items(id,category_id,section,title,notes,link,hidden,position) values ('foh-2-8','foh-2','Second-Mile Service','Service Recovery','','',false,8);
insert into public.items(id,category_id,section,title,notes,link,hidden,position) values ('foh-3-0','foh-3','Guest Experience','Uses CORE 4 with guests','','',false,0);
insert into public.items(id,category_id,section,title,notes,link,hidden,position) values ('foh-3-1','foh-3','Guest Experience','Practice order taking','','',false,1);
insert into public.items(id,category_id,section,title,notes,link,hidden,position) values ('foh-3-2','foh-3','Guest Experience','Practice payment handling','','',false,2);
insert into public.items(id,category_id,section,title,notes,link,hidden,position) values ('foh-3-3','foh-3','Guest Experience','Review restaurant service expectations','','',false,3);
insert into public.items(id,category_id,section,title,notes,link,hidden,position) values ('foh-4-0','foh-4','Bagging','Bags all food items with reasonable speed and excellent accuracy','','',false,0);
insert into public.items(id,category_id,section,title,notes,link,hidden,position) values ('foh-4-1','foh-4','Bagging','Understands what bags to use and when','','',false,1);
insert into public.items(id,category_id,section,title,notes,link,hidden,position) values ('foh-4-2','foh-4','Bagging','Proficient communication with the BOH team','','',false,2);
insert into public.items(id,category_id,section,title,notes,link,hidden,position) values ('foh-4-3','foh-4','Bagging','Basic understanding of the bagging matrix and dine-ready meals','','',false,3);
insert into public.items(id,category_id,section,title,notes,link,hidden,position) values ('foh-4-4','foh-4','Bagging','Understands Prep Kanban system','','',false,4);
insert into public.items(id,category_id,section,title,notes,link,hidden,position) values ('foh-4-5','foh-4','Bagging','Understands the KPS and bump bar system','','',false,5);
insert into public.items(id,category_id,section,title,notes,link,hidden,position) values ('foh-4-6','foh-4','Bagging','Proficient communication with the saucer/stuffer position when applicable','','',false,6);
insert into public.items(id,category_id,section,title,notes,link,hidden,position) values ('foh-4-7','foh-4','Bagging','Utilizes CORE 4 when handing out food to guests','','',false,7);
insert into public.items(id,category_id,section,title,notes,link,hidden,position) values ('foh-4-8','foh-4','Bagging','Awareness of mobile and third-party beverage screen and prepares items when applicable','','',false,8);
insert into public.items(id,category_id,section,title,notes,link,hidden,position) values ('foh-4-9','foh-4','Bagging','Sanitizes the chutes and other food prep surfaces every 4 hours','','',false,9);
insert into public.items(id,category_id,section,title,notes,link,hidden,position) values ('foh-5-0','foh-5','Assessment Check','Complete the trainer assessment','','',false,0);
insert into public.items(id,category_id,section,title,notes,link,hidden,position) values ('foh-5-1','foh-5','Assessment Check','Review areas for continued practice','','',false,1);
insert into public.items(id,category_id,section,title,notes,link,hidden,position) values ('foh-6-0','foh-6','Assessment Check','Complete the restaurant safety assessment','','',false,0);
insert into public.items(id,category_id,section,title,notes,link,hidden,position) values ('foh-6-1','foh-6','Assessment Check','Review areas for continued practice','','',false,1);
insert into public.items(id,category_id,section,title,notes,link,hidden,position) values ('foh-7-0','foh-7','FOH Closing','Lowboy fridge is cleaned and polished','','',false,0);
insert into public.items(id,category_id,section,title,notes,link,hidden,position) values ('foh-7-1','foh-7','FOH Closing','Sauce wall is stocked and surrounding countertop is clean','','',false,1);
insert into public.items(id,category_id,section,title,notes,link,hidden,position) values ('foh-7-2','foh-7','FOH Closing','Tea brewer parts are emptied, cleaned, and returned to the correct location','','',false,2);
insert into public.items(id,category_id,section,title,notes,link,hidden,position) values ('foh-7-3','foh-7','FOH Closing','Dry storage items are stocked and organized appropriately','','',false,3);
insert into public.items(id,category_id,section,title,notes,link,hidden,position) values ('foh-7-4','foh-7','FOH Closing','All countertops are cleaned and sanitized with no residue','','',false,4);
insert into public.items(id,category_id,section,title,notes,link,hidden,position) values ('foh-7-5','foh-7','FOH Closing','Line stanchions are separated and stowed away','','',false,5);
insert into public.items(id,category_id,section,title,notes,link,hidden,position) values ('foh-7-6','foh-7','FOH Closing','Floor is swept, scrubbed, squeegeed, and mopped','','',false,6);
insert into public.items(id,category_id,section,title,notes,link,hidden,position) values ('foh-7-7','foh-7','FOH Closing','FOH closet floor is swept underneath shelving','','',false,7);
commit;

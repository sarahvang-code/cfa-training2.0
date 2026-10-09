grant select on public.categories, public.items, public.settings to anon;
create policy public_training_categories on public.categories for select to anon using (true);
create policy public_training_items on public.items for select to anon using (not hidden);
create policy public_training_settings on public.settings for select to anon using (true);
alter policy items_read on public.items using (not hidden or (select public.training_role())='owner');

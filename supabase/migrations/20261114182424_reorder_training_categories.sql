-- Save one department's complete category order atomically. Existing row-level
-- security continues to authorize all reads and writes.
create function public.reorder_training_categories(
 p_department text,
 p_previous_ids text[],
 p_ordered_ids text[]
) returns void
language plpgsql security invoker set search_path = '' as $$
declare
 current_ids text[];
begin
 if public.training_role() is distinct from 'owner' then
  raise exception using errcode='42501', message='Only the owner can reorder training categories.';
 end if;
 if p_department is null or p_department not in ('FOH','BOH')
    or p_previous_ids is null or p_ordered_ids is null then
  raise exception using errcode='22023', message='Choose one department and its category order.';
 end if;

 -- Serialize saves with other category writes, including add or delete, while
 -- leaving ordinary reads available.
 lock table public.categories in share row exclusive mode;
 select coalesce(array_agg(id order by position, id collate "C"), '{}'::text[])
  into current_ids from public.categories where department=p_department;
 if p_ordered_ids is not distinct from current_ids then return; end if;
 if p_previous_ids is distinct from current_ids then
  raise exception using errcode='PT409',
   message='Categories changed on another device. Refresh the list and try again.';
 end if;
 if cardinality(p_ordered_ids) is distinct from cardinality(current_ids)
    or not (current_ids <@ p_ordered_ids) then
  raise exception using errcode='22023', message='Include every category in this department exactly once.';
 end if;

 update public.categories as c
 set position=(new_order.ordinal - 1)::integer
 from unnest(p_ordered_ids) with ordinality as new_order(id, ordinal)
 where c.department=p_department and c.id=new_order.id
   and c.position is distinct from (new_order.ordinal - 1)::integer;
end
$$;
revoke all on function public.reorder_training_categories(text,text[],text[]) from public, anon, authenticated;
grant execute on function public.reorder_training_categories(text,text[],text[]) to authenticated;

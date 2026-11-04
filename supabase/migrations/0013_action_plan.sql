-- v8 (VTech, 2026-11-04): Pending page column "Action plan" (sheet tab "Pending Page", row 3).
-- Free text per pending item, edited inline by the PM; covered by the existing project-access policy on dependency_items.
alter table public.dependency_items
  add column action_plan text check (length(action_plan) <= 1000),
  add column action_plan_updated_at timestamptz,
  add column action_plan_updated_by uuid references public.profiles (id);

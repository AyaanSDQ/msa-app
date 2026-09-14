-- Public attribution lookup: reader/exec UIs need to show "posted by which
-- exec" (spec §12/§15, shown on every post in design-reference) but the
-- `executives` RLS policy only lets an exec read their own row. This view
-- runs with the privileges of its owner (postgres), so it can select across
-- all of `executives` regardless of that policy, while only ever exposing
-- id + display_name for active execs — never the full executives table.

create view public.exec_directory as
  select user_id, display_name
  from public.executives
  where active = true;

grant select on public.exec_directory to anon, authenticated;

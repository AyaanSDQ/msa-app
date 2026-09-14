-- Supabase Realtime enforces RLS against the NEW row on UPDATE: once a
-- post's status flips to 'deleted', the row no longer satisfies the old
-- anon policy (status <> 'deleted'), so the deletion UPDATE event is never
-- delivered to reader-page subscribers at all -- not filtered, just silently
-- dropped. That makes the reader page's live "grey-out then remove" delete
-- animation (spec step 4) impossible under the original policy.
--
-- Fix: drop the deleted-status clause from the anon SELECT policy so the
-- transition event reaches anon subscribers; the client is responsible for
-- never rendering status='deleted' rows except mid-removal-animation. The
-- exec_meeting confidentiality clause is untouched. This only affects posts
-- that were already fully public moments before being soft-deleted -- no
-- previously-confidential data becomes newly readable.

drop policy "anon can read public updates" on public.updates;

create policy "anon can read public updates"
  on public.updates for select
  to anon
  using (type <> 'exec_meeting');

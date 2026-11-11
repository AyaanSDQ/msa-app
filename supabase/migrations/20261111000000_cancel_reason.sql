-- Optional reason shown to readers when a post is cancelled. Kept under 100
-- characters (the exec form also limits the input to 99).

alter table public.updates
  add column if not exists cancel_reason text
    check (cancel_reason is null or char_length(cancel_reason) < 100);

-- Executives are identified by a username, not an email address.
--
-- Supabase Auth cannot sign in without an email-shaped identifier, so every
-- login still has a placeholder address in auth.users: `<username>@ummah.example.com`
-- (example.com is reserved and can never receive mail, and the app never sends
-- anything to it). No real email address is stored or used anywhere. The
-- username lives here, on the roster, and the login screen derives the
-- placeholder from it (see assets/js/exec.js).

alter table public.executives add column if not exists username text;

-- Backfill from the existing account(s): the part of the old address before the @.
update public.executives e
set username = lower(split_part(u.email, '@', 1))
from auth.users u
where u.id = e.user_id
  and e.username is null;

alter table public.executives alter column username set not null;

alter table public.executives
  add constraint executives_username_format
  check (username ~ '^[a-z0-9][a-z0-9._-]{1,30}$');

create unique index executives_username_key on public.executives (username);

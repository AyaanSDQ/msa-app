# Creating an administrative login

The login screen takes a **username** and password. Supabase signs in with an
email under the hood, so a username such as `msa` is turned into
`msa@ummah.example.com` (see `USERNAME_EMAIL_DOMAIN` in `assets/js/exec.js`).
Typing a full email address on the login screen also still works.

Accounts are created by hand. There is no public sign-up.

## 1. Create the user

Supabase dashboard → **Authentication → Users → Add user → Create new user**

- **Email:** `<username>@ummah.example.com` (for username `msa`: `msa@ummah.example.com`)
- **Password:** choose a long, unique password
- Tick **Auto Confirm User** (no confirmation email is ever sent to this address)

## 2. Give it admin rights

Being a Supabase user is not enough. The user must also be listed in the
`executives` table. In **SQL Editor**, run (replace the values):

```sql
insert into public.executives (user_id, display_name, active)
select id, 'Admin', true
from auth.users
where email = 'msa@ummah.example.com';
```

To switch someone off later, set `active = false` on their row.

## Notes

- Use a strong password. This login can post, cancel and delete updates for everyone.
- Never put a password in the app's code or in this repository.

# Creating an administrative login

Admins sign in with a **username** and password. No email address is collected,
stored or used anywhere in this project.

Supabase Auth can only sign in with an email-shaped identifier, so each account
has a **placeholder** address built from the username:
`<username>@ummah.example.com` (for username `msa`: `msa@ummah.example.com`).
`example.com` is reserved and can never receive mail, and nothing is ever sent
to it. The login screen builds the placeholder for you (see
`assets/js/exec.js`); admins only ever type the username. A real email address
typed into the login screen is rejected before it reaches Supabase.

Accounts are created by hand. There is no public sign-up.

Usernames are lowercase letters, numbers, `.`, `_` and `-`, 2 to 31 characters,
starting with a letter or number.

## 1. Create the user

Supabase dashboard → **Authentication → Users → Add user → Create new user**

- **Email:** `<username>@ummah.example.com` (the placeholder, not a real address)
- **Password:** choose a long, unique password
- Tick **Auto Confirm User** (no confirmation email is ever sent to this address)

## 2. Give it admin rights

Being a Supabase user is not enough. The user must also be on the
`executives` roster, which is where the username is recorded. In **SQL Editor**,
run (replace the values):

```sql
insert into public.executives (user_id, username, display_name, active)
select id, 'msa', 'Admin', true
from auth.users
where email = 'msa@ummah.example.com';
```

To switch someone off later, set `active = false` on their row.

## Notes

- Keep **Authentication → Sign In / Providers → "Allow new users to sign up"
  turned off**. Otherwise anyone could create an account with a real email
  address, which would then be stored in Supabase.
- Use a strong password. This login can post, cancel and delete updates for everyone.
- Never put a password in the app's code or in this repository.

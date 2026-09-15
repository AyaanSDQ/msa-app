-- Calls the notify-post Edge Function (supabase/functions/notify-post)
-- whenever a post is created, or cancelled, so subscribed readers get a
-- OneSignal push. Skips exec_meeting entirely (readers never see it) and
-- skips every other status transition (delete, restore, edits) -- per
-- product decision, only new posts and cancellations are notification-
-- worthy; deletions/restores are not.
--
-- Auth: the trigger calls the function with the project's service_role key,
-- stored in Supabase Vault under the name 'trigger_service_role_key' (set
-- via `supabase db query`, never committed here in plaintext) rather than
-- embedding a secret in this migration file.

create extension if not exists pg_net with schema extensions;

create or replace function public.notify_on_post_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  service_key text;
  event_name text;
begin
  if NEW.type = 'exec_meeting' then
    return NEW;
  end if;

  if TG_OP = 'INSERT' and NEW.status = 'active' then
    event_name := 'new_post';
  elsif TG_OP = 'UPDATE' and NEW.status = 'cancelled' and OLD.status is distinct from 'cancelled' then
    event_name := 'cancelled';
  else
    return NEW;
  end if;

  select decrypted_secret into service_key
  from vault.decrypted_secrets
  where name = 'trigger_service_role_key';

  if service_key is null then
    -- Secret not configured yet -- don't block the write, just skip the push.
    return NEW;
  end if;

  perform net.http_post(
    url := 'https://pympzzwlaveyhnzwfomb.supabase.co/functions/v1/notify-post',
    body := jsonb_build_object(
      'event', event_name,
      'id', NEW.id,
      'type', NEW.type,
      'title', NEW.title,
      'body', NEW.body,
      'location', NEW.location
    ),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || service_key
    ),
    timeout_milliseconds := 5000
  );

  return NEW;
end;
$$;

drop trigger if exists updates_notify_on_change on public.updates;
create trigger updates_notify_on_change
  after insert or update on public.updates
  for each row execute function public.notify_on_post_change();

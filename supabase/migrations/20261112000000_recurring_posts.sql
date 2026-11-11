-- Recurring posts.
--
-- A repeating post is one row in public.updates. `recurrence` holds the rule (how often,
-- which days, start / end, time of day, "from this date on" changes) and
-- `occurrence_overrides` holds the few dates an admin changed (cancelled, deleted or
-- re-worded). Individual occurrences are never stored: the app works them out from the rule.
-- See docs/recurring-events-concept.md and assets/js/recurrence.js for the exact shapes.
--
-- Existing RLS already covers the new columns (anyone can read non-deleted posts,
-- active executives can write), and realtime already publishes the table.

alter table public.updates
  add column if not exists recurrence jsonb,
  add column if not exists occurrence_overrides jsonb not null default '{}'::jsonb;

alter table public.updates drop constraint if exists updates_recurrence_is_object;
alter table public.updates
  add constraint updates_recurrence_is_object
    check (recurrence is null or jsonb_typeof(recurrence) = 'object');

alter table public.updates drop constraint if exists updates_overrides_is_object;
alter table public.updates
  add constraint updates_overrides_is_object
    check (jsonb_typeof(occurrence_overrides) = 'object');

-- Push notifications: a new repeating post sends one "new post" push (the existing INSERT
-- branch). Cancelling a single occurrence of a repeating post also sends the existing
-- "cancelled" push, with the date added to the title. Everything else is unchanged.
create or replace function public.notify_on_post_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  service_key text;
  event_name text;
  msg_title text := NEW.title;
  new_cancel text;
begin
  if NEW.type = 'exec_meeting' then
    return NEW;
  end if;

  if TG_OP = 'INSERT' and NEW.status = 'active' then
    event_name := 'new_post';
  elsif TG_OP = 'UPDATE' and NEW.status = 'cancelled' and OLD.status is distinct from 'cancelled' then
    event_name := 'cancelled';
  elsif TG_OP = 'UPDATE' and NEW.status = 'active' and NEW.recurrence is not null then
    -- a single occurrence of a repeating post was just cancelled
    select e.key into new_cancel
    from jsonb_each(coalesce(NEW.occurrence_overrides, '{}'::jsonb)) e
    where e.value ->> 'status' = 'cancelled'
      and coalesce(OLD.occurrence_overrides -> e.key ->> 'status', '') <> 'cancelled'
    order by e.key
    limit 1;
    if new_cancel is null then
      return NEW;
    end if;
    event_name := 'cancelled';
    msg_title := NEW.title || ' (' ||
      case when new_cancel ~ '^\d{4}-\d{2}-\d{2}$' then to_char(new_cancel::date, 'Mon FMDD') else new_cancel end
      || ')';
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
      'title', msg_title,
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

# Recurring events: concept

Status: proposal only. Nothing in this document is built yet.

## The idea in one paragraph

An admin writes a post once and says how often it repeats. The app keeps **one series** (the rule) and shows **one occurrence per date** wherever dates matter: the calendar, "Today", "Coming up" and the hero card. Occurrences are never stored in bulk. They are worked out from the rule when a page loads, and only the occurrences an admin changes (cancelled, moved, re-worded) are stored, as small **exceptions**. This keeps the admin workflow almost identical to today: the New post form gains one extra control, and the rest of the app treats a recurring post like any other post.

## What the admin sees

### Creating or editing a post

The New post form keeps every field it has now. Under **Time** there is one new control, a single row:

```
Repeat   [ Does not repeat  v ]
```

Choosing anything other than "Does not repeat" reveals a short, inline panel (no modal, no new page):

| Option | Extra fields | Meaning |
|---|---|---|
| Does not repeat | none | Today's behaviour. |
| Daily | none | Every day at the post's time. |
| Weekly | day-of-week chips (S M T W T F S), the weekday of the first date is pre-selected | Every selected weekday. |
| Monthly | "On day 14" (default: the first date's day) or "On the second Friday" | The same date, or the same weekday slot, each month. A day that does not exist in a short month (the 31st) uses the last day of that month. |
| Custom | "Every [ 2 ] [ weeks v ]" plus the weekday chips when the unit is weeks | Any interval of days, weeks or months. |

Below the repeat choice, two more fields appear:

- **Starts** is the date of the first occurrence. It is the post's existing date field, so there is nothing new to learn.
- **Ends** has three choices: *Never* (the default), *On a date*, or *After N times*.

A one-line summary updates as the admin changes things, for example "Every Mon, Wed, Fri from Nov 17. Ends Dec 19." This is the confirmation, so no extra review screen is needed.

The 100-character and room-number rules are unchanged. Priority and Pin apply to the whole series.

### The admin list stays one row per series

The admin list does **not** fill up with 40 copies of the same prayer. A recurring post appears once, in the position of its next upcoming occurrence, with two small additions:

- a repeat glyph next to the time, and
- a short rule in the meta line: `Weekly · Mon, Wed, Fri` in place of a single date.

Cancelled or edited single occurrences are hidden by default. A series with exceptions shows a small count ("2 changes"), and opening the series shows them.

### Opening a recurring post

The detail page already has Pin, Cancel and Delete. For a recurring post, a **scope** question is asked only at the moment it matters:

- **Edit notes / Cancel / Delete** on a recurring post opens a small two-option sheet:
  - **This occurrence** (the default, with its date shown: "Mon, Nov 17")
  - **This and all future occurrences**
  - A third choice, **All occurrences**, appears only for Edit and Delete, never for Cancel, because cancelling "everything" is the same as deleting.
- Occurrences are reached from the detail page through a compact "Upcoming dates" strip, which shows the next five occurrences as chips. Tapping a chip opens that one occurrence. This avoids a second list and keeps the detail page as the single place for actions.

A one-off post never shows the scope sheet, so today's workflow is unchanged.

## What readers see

- **Calendar:** each occurrence sits on its own date, with the same colour bar and card as any event. Recurring ones carry the same small repeat glyph, so readers can tell "this happens every week" at a glance.
- **Updates page:** the hero card, "More today" and "Coming up" show the occurrence that falls on that day, using the existing rules (prayers become the hero, and so on). A series never shows twice on the same day.
- **Cancelling one occurrence:** it becomes a cancelled hero card for that date only, with the reason, exactly as now. The next week's occurrence is unaffected.
- **Pinning a series:** the pinned hero card shows the next upcoming occurrence.
- **Past occurrences:** appear in "Earlier" as normal posts for their date, so history is accurate.

## How it fits the data model

Two small additions, both backwards compatible (a post with no series behaves exactly as today).

**`recurrence_rules`** (one row per series, owned by the first post):

| column | purpose |
|---|---|
| `id` | primary key |
| `update_id` | the "template" post (title, type, room, notes, time of day, priority) |
| `freq` | `daily`, `weekly`, `monthly` |
| `interval` | 1 for the plain options, N for Custom |
| `by_weekday` | integer array (0 to 6) for weekly rules |
| `by_month_day` / `by_nth_weekday` | monthly rules |
| `starts_on`, `ends_on`, `max_count` | the start date and the optional end (a date or a count) |
| `timezone` | the club's timezone, so "7:00 PM" stays 7:00 PM across daylight saving changes |

**`recurrence_exceptions`** (one row per changed occurrence):

| column | purpose |
|---|---|
| `rule_id`, `occurrence_date` | which occurrence (the original date, never changes) |
| `status` | `cancelled` or `deleted` (deleted occurrences are simply skipped) |
| `cancel_reason` | the same 100-character reason as today |
| `override_*` | optional per-occurrence title, room, notes or time (for "this week only, room 214") |

Why not simply insert 52 rows for a year? Because editing "all future" would then mean rewriting every row, a deleted series would leave debris, and the row count would grow forever. Computing occurrences from the rule keeps the database tiny and the edit rules trivial. A rolling window (the next 90 days) is generated in the browser for the calendar and lists.

Editing "this and all future occurrences" splits the series: the old rule gets an `ends_on` the day before, and a new rule starts on that date with the changes. This is the standard approach, and it keeps history intact without special cases.

## Notifications

- Creating a series sends one notification ("New weekly post: Dhuhr prayer"), not one per occurrence.
- Cancelling a single occurrence sends the existing cancellation notification, with the date.
- Editing "all future" sends one change notification.

## Edge cases to decide up front

1. **Time zones and daylight saving:** the rule stores a local time and a timezone, never a fixed UTC time.
2. **A series with no end:** the calendar only ever looks 90 days ahead, so "Never" is safe.
3. **Deleting a series:** the same soft delete as posts today (`status = deleted`), with the same slide-out, and every occurrence disappears everywhere at once.
4. **Pin and priority:** apply to the series. An occurrence override can change them for one date if ever needed, but v1 leaves that out.
5. **Date edge cases:** monthly on the 29th to 31st falls back to the last day of shorter months.
6. **Row-level security:** exactly the same as `updates`: readers can select, active executives can write.

## Suggested build order

1. **Phase 1, repeat rules only:** Daily, Weekly and "ends on / never". The form control, the rule table, expansion on the calendar and Updates page, delete whole series. This alone covers daily prayers and weekly socials.
2. **Phase 2, exceptions:** cancel or delete a single occurrence, with the scope sheet and the "Upcoming dates" strip.
3. **Phase 3, the rest:** Monthly, Custom intervals, "After N times", "This and all future" splits, per-occurrence overrides, notification wording.

Each phase ships something useful on its own, and none of them changes how one-off posts work.

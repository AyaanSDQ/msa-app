# Recurring events: concept

Status: built (all three phases). The design notes below describe what the app does and why.

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

## How it is built

All three phases are built. The final design is simpler than the two-table proposal first sketched here: **a repeating post is one row in `updates`** with two extra `jsonb` columns (migration `20261112000000_recurring_posts.sql`). A post with no rule is untouched.

| column | holds |
|---|---|
| `recurrence` | the rule: `freq` (daily or weekly), `interval` (always 1 from the form), `weekdays` (weekly), `start`, `time`, `ends` (`never`, `on` a date, or `count`), and `changes` (the "this and all future" edits, each with a `from` date) |
| `occurrence_overrides` | the few single dates an admin changed, keyed `"YYYY-MM-DD"`: `status` (`cancelled` or `deleted`), `cancel_reason`, and optional `title`, `location`, `body`, `time` |

Dates are local calendar dates and times are local `HH:MM`, so "7:00 PM" stays 7:00 PM across daylight saving. The series row's own `event_time` is its first date, which keeps it sortable and keeps old code paths working. Pin and priority belong to the series.

**Expansion happens in the browser** (`assets/js/recurrence.js`, unit tested). Each page asks for the dates it needs and gets post-shaped objects with the id `<series id>@<date>`, so every occurrence is unique on a page. The calendar expands the visible month, the Updates page expands today, the next occurrence, cancelled dates and history, and the admin detail page expands a short strip of dates. A "never ends" rule is safe because every call is bounded.

**Edit scopes** follow the proposal:

- *This occurrence* writes one override.
- *This and all future* adds a `changes` entry (edit), sets `ends` to the day before (delete) or to that date plus a cancelled override (cancel). It is not offered on the first date, where it would equal the whole series.
- *All occurrences* rewrites the series row and drops overrides that the wider edit makes pointless. It is offered for Edit and Delete, never for Cancel.

Why not insert 52 rows for a year? Editing "all future" would mean rewriting every row, a deleted series would leave debris, and the row count would grow forever. One row per series keeps the database tiny and the edit rules short.

## Where it shows

- **Admin:** the New post form has the Repeat control (Daily or Weekly with day chips; Ends never, on a date, or after N times) with a live one-line summary. The list shows one card per series with a small "Repeats" mark, the rule, the next date and a "N changes" count. The detail page has a Dates strip (the last two and the next eight dates), and Edit, Cancel and Delete ask which dates they apply to.
- **Readers:** the calendar, Updates page and history show each occurrence on its own date with a small repeat mark. A cancelled date becomes a cancelled hero card for that date only. A pinned series shows its next date.

## Notifications

- Creating a series sends one notification, the same as any new post, not one per occurrence.
- Cancelling a single occurrence sends the usual cancellation notification with the date added to the title ("Study circle (Nov 11)"). The database trigger `notify_on_post_change` detects the newly cancelled override.
- Cancelling "this and all future" is a cancel of that date plus an end date, so it sends the same single notification.
- Editing a series (any scope) does not notify. That matches one-off posts, where edits are silent.

## Edge cases to decide up front

1. **Time zones and daylight saving:** the rule stores a local date and time, never a fixed UTC time, so it follows the viewer's own clock (fine for a single campus).
2. **A series with no end:** every expansion is bounded (a month, 180 days ahead, a year of history), so "Never" is safe.
3. **Deleting a series:** the same soft delete as posts today (`status = deleted`), with the same slide-out; every occurrence disappears everywhere at once.
4. **Pin and priority:** apply to the series. Overrides cover title, room, notes and time only.
5. **Monthly and custom intervals:** deliberately not offered. The weekly and daily options cover the club's real schedule.
6. **Row-level security:** unchanged. The new columns sit on `updates`, so readers can select and active executives can write.

## Build order (all done)

1. **Phase 1, repeat rules:** Daily, Weekly, "ends on / never"; the form control, expansion on the calendar and Updates page, delete whole series.
2. **Phase 2, exceptions:** cancel or delete a single occurrence, the scope choices and the Dates strip.
3. **Phase 3, the rest:** "After N times", "This and all future", per-occurrence overrides, notification wording. (Monthly and Custom repeats were built, then removed because they will not be used.)

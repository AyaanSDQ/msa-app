# Ummah — design critique and redesign spec

Mobile-first. Primary device: a phone held in one hand, 375–430 px wide.

## 1. Critique of the current design (unfiltered)

1. **There is no identity.** The header is a 34 px tile and two words. Nothing says "community", "Islamic" or "NCHS". Take the logo away and this could be any to-do app.
2. **Two empty states stacked on the same screen.** "No other updates posted yet for today" followed by "No past updates yet", each with the same inbox icon, is the loudest thing on the page when the feed is quiet. It reads as a broken app, not a calm one. This is the single worst screen.
3. **Every post looks the same.** An announcement, a prayer, a social event and a cancelled post share one card. Nothing signals importance, urgency or "this is an event with a date".
4. **The hero is not a hero.** It is a white card on a near-white page. The title is large but nothing else carries weight, there is no image slot, no badge, and no sense of "pinned".
5. **Contrast is too low.** Secondary text (`#7a7388` on `#f7f3fc`) is about 3.6:1, which fails WCAG AA for the 11–13 px text used for dates and labels.
6. **Uppercase tracked micro-labels everywhere** (type, section names, header). Used everywhere they stop signalling anything and become noise.
7. **Glass with nothing behind it.** Translucent panels over a flat tint show no depth. The blur effect is invisible, so the cost is paid and the benefit is not.
8. **Underline tabs** look like a 2015 settings screen, and the 10 px vertical padding gives a touch target under 44 px.
9. **Density is wrong.** Big gaps between sections plus empty states mean a phone screen shows one card and a lot of lavender.
10. **The data model cannot express a good announcement.** No image, no pinned flag, no priority. The UI has nothing to be expressive with.
11. **Purple is only a garnish.** It shows up as a 6 px dot and a few labels. The brand colour should own the first screen.

## 2. Direction

*"Quiet confidence."* One strong purple surface per screen (the featured card), layered translucent panels over an **Islamic geometric** lattice of interlocking eight-pointed stars (the Ummah motif), calm neutral type, and real, friendly empty states. Think Linear's restraint, Notion's friendliness, Apple's depth.

## 3. Design tokens

### Colour

| Token | Hex | Use |
|---|---|---|
| `purple-900` | `#2D1450` | Deepest shadow tint, text on tint |
| `purple-700` | `#4C2579` | Pressed state |
| `purple-600` | `#5B2E91` | **Primary**: buttons, active pill, hero |
| `purple-500` | `#7A49B8` | Gradient end, links |
| `purple-300` | `#C3A6E8` | Illustration mid-tone |
| `purple-200` | `#E2D6F2` | Tints, chips |
| `purple-50` | `#F8F4FD` | Page tint |
| `ink` | `#1B1626` | Primary text (15:1 on page) |
| `ink-2` | `#4B4458` | Secondary text (8.4:1) |
| `ink-3` | `#6B6478` | Tertiary text (4.9:1, passes AA) |
| `line` | `#E7DEF2` | Hairlines |
| `urgent` | `#D6334A` | Urgent badge and edge |
| Post types | prayer `#5B2E91`, social `#B0348F`, announcement `#7A4BD0`, exec `#34205C` | Dots, date tiles, glows |

### Typography (Plus Jakarta Sans)

| Role | Size / line | Weight | Tracking |
|---|---|---|---|
| Display (hero title) | 28 / 32 | 750 | -0.03em |
| Section | 18 / 24 | 700 | -0.02em |
| Card title | 17 / 22 | 700 | -0.015em |
| Body | 15 / 22 | 500 | 0 |
| Meta | 13 / 18 | 600 | 0 |
| Caption / badge | 11.5 / 14 | 700 | +0.06em, caps **only** on badges |

### Spacing (4-pt grid)

`4, 8, 12, 16, 20, 24, 32`. Page gutter 16. Card padding 16 (20 on the hero). Gap between cards 10. Gap between sections 20. Minimum touch target 44.

### Radius and elevation

Radius: chip 10, card 18, hero and masthead 24, pill 999.

- `elev-1`: `inset 0 1px 0 rgba(255,255,255,.7), 0 1px 2px rgba(45,20,80,.06)`
- `elev-2` (cards, panels): `inset 0 1px 0 rgba(255,255,255,.7), 0 10px 24px -14px rgba(45,20,80,.28)`
- `elev-3` (hero): `inset 0 1px 0 rgba(255,255,255,.6), 0 28px 48px -26px rgba(76,37,121,.6)`

## 4. Components

**Masthead.** A glass panel with the geometric star lattice fading in from the right, holding the logo lockup (logo 44 px, "Ummah", fading divider, stacked "NCHS / MSA") and a row of three stat tiles: *Announcements*, *Upcoming events*, *New this week*. Stats are live counts from the database. (A "Members" tile is intentionally not shown, because the app does not store members. Add it by supplying a number.)

**Pill navigation.** A 4 px-padded glass capsule containing two 44 px pills. The active pill is a purple gradient with a soft shadow. Between pages the active pill morphs to its new position (View Transitions) so the tab feels like one control.

**Featured card (hero).** 24 px radius, elevation 3.
- *Banner (120 px).* If the post has `image_url`, the image fills it. Otherwise a purple gradient in the post colour with a white geometric star lattice and the type icon, so even imageless posts look designed.
- *Badges on the banner:* **Pinned**, **Important**, **Urgent**, or **Up next** for the soonest event.
- *Body:* type label with colour dot, 28 px title, date + time + room as pill chips, notes, footer (updated time, Feedback).

**Standard announcement card.** Icon tile (frosted), title, meta, notes, optional 64 px thumbnail on the right. Urgent posts get a red left edge and badge. Important posts get a purple left edge.

**Event card.** A calendar-style **date tile** replaces the icon: coloured month strip over a bold day number. Title, time and room beside it. This makes events scannable by date.

**Badges.** Pill, 11.5 px bold. Pinned (purple tint, pin icon), Important (purple gradient, star), Urgent (red tint, alert icon).

**Empty states.** A small illustration (a crescent over a mosque skyline: dome, minarets and a band of geometric diamonds), one friendly sentence, one helpful line. Rules: never show two empty states at once; hide a section that has nothing to show; if the whole feed is empty, show one illustrated welcome.

## 5. Mobile wireframe

```
┌──────────────────────────────┐
│ ✦ geometric star lattice ✦   │
│ [☾] Ummah │ NCHS             │  masthead (glass)
│            │ MSA             │
│ ┌────┐ ┌────┐ ┌────┐         │
│ │ 12 │ │  4 │ │  3 │         │  stat tiles
│ │Ann.│ │Evts│ │Wk  │         │
│ └────┘ └────┘ └────┘         │
├──────────────────────────────┤
│ ( Updates )  Calendar        │  pill nav, 44 px
├──────────────────────────────┤
│ ┌──────────────────────────┐ │
│ │ [banner / pattern]       │ │
│ │ ★ Important   📌 Pinned  │ │  featured card
│ ├──────────────────────────┤ │
│ │ ● ANNOUNCEMENT           │ │
│ │ Shirts will be here      │ │
│ │ by next Monday           │ │
│ │ (📅 Sun, Nov 15)(🕒 3 PM)│ │
│ │ Updated 1h ago  Feedback │ │
│ └──────────────────────────┘ │
│ More today               2   │
│ ┌─┬────────────────────────┐ │
│ │15│ Open mic night        │ │  event card
│ │NOV│ 7:00 PM · Room 2105  │ │
│ └─┴────────────────────────┘ │
│ Earlier                      │
│ …                            │
└──────────────────────────────┘
```

## 6. Inspiration and what we borrowed

- **Apple:** layered translucency with a bright top edge, large rounded corners, the calendar date tile, spring-free short animations.
- **Linear:** restraint. One accent, tight type scale, no decorative noise, status as small badges.
- **Notion:** friendly empty states with illustration and a helpful sentence.
- **Stripe:** confident gradients used once (hero) and soft layered shadows for depth.
- **Modern iOS:** 44 pt targets, pill segmented control, content-first density.

## 7. Data additions

`supabase/migrations/20261108000000_post_media_priority.sql` adds three optional columns to `updates`: `image_url`, `pinned`, `priority` (`normal | important | urgent`). The reader reads them when present and ignores them when absent. The admin form only sends them when set, so posting keeps working before the migration is applied.

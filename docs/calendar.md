# Calendar & Scheduling (V1)

The Calendar is an operational view over the CRM's own records — not a second
scheduling system. It answers *where do I need to be, what's scheduled, what
happens next, what could stop an inspection going smoothly, and which
deadlines are coming up*, following **scan → preview → act → open the full
record**.

## Architecture

```
/calendar (server page)          first range rendered on the server
  └─ CalendarApp (client)         view/date/layers/inspector/search state,
       │                          fetches only the visible range
       ├─ getCalendarEvents ─────► lib/calendar/events.ts   (read side)
       ├─ getInspectionPreview ──► lib/calendar/preview.ts
       └─ schedule/reschedule/  ─► lib/scheduling/service.ts (write side)
          cancel actions               ├─ conflicts.ts (overlap + advisory lock)
                                       ├─ activity log (existing ActivityLog)
                                       └─ email automation hooks (existing)
```

| Module | Role |
| --- | --- |
| `lib/calendar/time.ts` | Business-time-zone date math, shared by server and browser |
| `lib/calendar/config.ts` | Business settings from the environment (hours, week start, default duration, report turnaround, payment rule) |
| `lib/calendar/layers.ts` | Layer list, defaults, per-user preferences |
| `lib/calendar/events.ts` | Aggregation: one range-bounded query per enabled layer → `CalendarEvent[]` |
| `lib/calendar/readiness.ts` | What could derail an inspection (warnings) + the preview checklist |
| `lib/calendar/preview.ts` | What the preview drawer shows for one inspection / task / realtor |
| `lib/scheduling/service.ts` | The only write path for schedule changes (UI and inspection pages alike) |
| `lib/scheduling/conflicts.ts` | Overlap query and the per-inspector lock |
| `lib/scheduling/records.ts` | Server-backed typeahead and duplicate protection |
| `app/(app)/calendar/_components/*` | Time grid (Day/Week), month grid, agenda (Day on phones), drawer, dialogs |

**Library choice:** built in-house (Tailwind + pointer events), no calendar
dependency. FullCalendar and react-big-calendar lay grids out in the
*browser's* time zone and bring their own date model; this app needs one
business time zone on server and client, SSR, and the CRM's own styling and
accessibility patterns. Day/Week/Month grids are small, and owning them keeps
drag-and-drop tied to a confirmation step instead of a library's instant move.

## Events are derived, never stored

`CalendarEvent` (`lib/calendar/types.ts`) is an application type:
`id, type, layer, sourceType, sourceId, title, subtitle, start, end, allDay, day,
inspectorId, inspectorName, status, priority, warnings, href, searchText, movable`.

| Layer | Default | Source | Notes |
| --- | --- | --- | --- |
| Inspections | on | `Inspection` (SCHEDULED / IN_PROGRESS / COMPLETED) | end = `scheduledAt + durationMinutes`; cancelled ones stay in the record, off the calendar |
| Blocked time & appointments | on | `Appointment` (`kind` BLOCK / APPOINTMENT) | an inspector's BLOCK counts as a conflict |
| Tasks | on | open `Task` with a due date, no realtor | all-day on the due day |
| Report deadlines | on | `Inspection` date + `CALENDAR_REPORT_DUE_DAYS` | only until a report is delivered; links to the report |
| Transaction dates | off | `Transaction.inspectionDeadline`, `closingDate` (`@db.Date`) | all-day, never time-converted |
| Realtor events | off | follow-up `Task`s with a realtor; `Realtor` birthday / career / working-together dates | missing dates produce nothing; Feb 29 → Feb 28 in non-leap years |
| Billing | off | collectible `Invoice` by `dueAt` | `financial:read` only |

Every query is bounded by the visible range (a month grid is at most 42 days;
the server rejects wider requests). Inspections look back 12 hours (the
longest allowed appointment) so one that started before the range and is
still running shows. Related data is loaded with `include`/`select` in the
same query — no N+1.

## Scheduling model

- **Duration:** `Inspection.durationMinutes` (default 180). The end is always
  derived. `Service.defaultDurationMinutes` suggests a length; the longest
  among an inspection's services wins (General 3h + Radon 30m = 3h), and every
  appointment can override it (15 min – 12 h, 5-minute steps).
- **Schedule:** property required; customer, realtor, inspector, services,
  time all optional (§7 non-blocking data). The inspection joins the
  property's open transaction for that customer, or a new one is started.
- **Reschedule / reassign / change duration:** one `rescheduleInspection`.
  A new time bumps `scheduleVersion`; reassignment and duration changes are
  audited but send no reschedule email.
- **Cancel:** status → CANCELLED, version bumped, record kept (never deleted).
- **Create while scheduling:** customers (name required; email/phone
  optional) and properties can be created from the scheduling dialog. Likely
  duplicates are shown first — customers by exact email, exact phone
  (digits, even if stored formatted), or same name; properties by normalized
  street (e.g. "123 N. Main Street" = "123 north main st") in the same
  ZIP/city. Nothing is merged; "Use this" or "Create anyway". *This adds a
  second way to create a Customer — previously only Lead conversion did.*
- **Agreement:** there is no e-signature system; `Inspection.agreementSignedAt`
  is set by staff ("Mark signed") and audited.

## Conflict detection

`findInspectorConflicts` returns the inspector's active inspections whose
interval overlaps the proposed one — computed in SQL as
`scheduledAt < end AND scheduledAt + durationMinutes > start` (touching ends
don't conflict) — plus their blocked time. The scheduling service runs it
inside the write transaction after taking `pg_advisory_xact_lock` keyed by
inspector, so two people booking the same slot at once can't both succeed.
The browser's live warning is only a preview; a conflicting save is refused
with the list of conflicts regardless of what the client sent.

## Email automation integration

No calendar-specific email code. After each committed change the service
calls the existing hooks through `runAutomationSafely` (an email failure is
logged, never a scheduling failure):

| Change | Hook | Effect |
| --- | --- | --- |
| Scheduled with a time | `onInspectionScheduled` | confirmation + reminder, per automation config |
| New time | `onInspectionRescheduled(previousTime, { notify })` | withdraws everything queued for the old version, change notice (if notify), new reminder for the new time |
| Cancelled | `onInspectionCancelled({ notify })` | withdraws reminders, cancellation notice (if notify) |

The automation system still decides recipients, templates, automatic vs.
review, suppression, and delivery. Unticking "Notify" only skips the notice —
stale reminders are always withdrawn and the reminder is always re-created,
and each queued email's guard re-checks `scheduleVersion` at send time, so an
old date/time can never be emailed.

## Time zones

- One business zone: `APP_TIMEZONE` (default America/New_York), shared with
  the email system.
- Instants are stored in UTC. A typed date + time is wall time in the
  business zone (`zonedDateTimeToUtc`): the skipped spring hour moves
  forward; the repeated fall hour takes the first occurrence.
- Grids, labels, and "which day" are computed in the business zone on server
  *and* browser — the browser's own zone is never used.
- Date-only fields (`closingDate`, `inspectionDeadline`, realtor dates) are
  `@db.Date`, travel as `YYYY-MM-DD`, and are never converted through a zone.
- This also fixed the inspection page, which previously parsed
  `datetime-local` input in the *server's* zone.

## RBAC

| Permission | Roles |
| --- | --- |
| `calendar:view` | all staff |
| `inspection:schedule` | owner, office |
| `inspection:reschedule` | owner, office (also inspector reassignment) |
| `inspection:cancel` | owner, office, inspector (inspectors could already cancel) |
| `calendar:block_time` | owner, office; inspectors for their own time only |
| `task:update` | owner, office (unchanged roles for complete/reschedule) |

All enforced in server actions; the UI hides what a role can't do.
Audited: `inspection.scheduled / rescheduled / duration_changed /
inspector_reassigned / cancelled / agreement_signed`, `calendar.block_created
/ block_removed`, `task.created / completed / rescheduled`,
`transaction.dates_updated`, `customer.created`, `property.created`.

## Indexes

Added: `inspections(inspectorId, scheduledAt)` (conflicts, inspector filter),
`appointments(userId, startAt)`, `inspection_reports(inspectionId)`,
`invoices(dueAt)`, `transactions(closingDate)`, `transactions(inspectionDeadline)`.
Already present and used: `inspections(scheduledAt)`, `appointments(startAt)`,
`tasks(dueAt)`, `tasks(realtorId, completedAt)`. Realtor birthdays are matched
by month/day over a small table; add `realtors(birthdayMonth, birthdayDay)` if
that table grows large.

## Settings

Environment (see `.env.example`): `CALENDAR_DAY_START_HOUR`,
`CALENDAR_DAY_END_HOUR`, `CALENDAR_WEEK_STARTS_ON`,
`CALENDAR_DEFAULT_DURATION_MINUTES`, `CALENDAR_REPORT_DUE_DAYS`,
`CALENDAR_REQUIRE_PAYMENT`. Per user (`User.calendarPreferences`, saved
automatically): default view, visible layers, inspector filter.

## Mobile

Below 768px the Calendar is a Day agenda: full-width cards, swipe or
prev/next/date picker to change day, the preview drawer as a full-screen
sheet, and Reschedule through date/time controls. Drag-and-drop is a desktop
convenience — every drag has a button/keyboard equivalent.

## Known limitations (V1)

- No e-signature; agreement status is a staff toggle.
- No per-inspector working hours or recurring blocks; blocks are single-day.
- "Business hours" and report turnaround are deployment settings, not a
  settings screen.
- Report due date is a fixed turnaround from the inspection date (no
  business-day calendar).
- Calendar search covers the loaded range only (it isn't global search).
- Tasks have date-only due dates, so they appear as all-day items.
- Inspector filter applies to inspections and blocked time, not tasks.
- No travel-time checks or route optimization (see below).
- No external calendar sync (see below).

## Future: travel time and routing

The model already has what a travel check needs: each inspection has a
start, a derived end, an inspector, and a property address. A future check
can compare the previous inspection's end + estimated drive time with the
next start (`findInspectorConflicts` is the natural home). Geocoding and
routing were deliberately not added in V1.

## Future: Google Calendar / Microsoft 365

The CRM stays the source of truth; sync would be one-way, CRM → external.

1. Per-user OAuth connection (Google / Microsoft Graph) with minimal scopes,
   tokens encrypted at rest.
2. A `CalendarSyncLink` table: `(inspectionId | appointmentId, provider,
   externalEventId, etag, lastSyncedAt)`.
3. Sync jobs enqueued from the same places the email hooks fire
   (scheduled / rescheduled / cancelled) into an outbox, processed by the
   existing worker pattern (`npm run worker`), idempotent by `scheduleVersion`.
4. External events carry only what an inspector needs — "Home inspection",
   address, time, a link back to the CRM — never financials, notes, or
   customer contact data beyond what's required.
5. Optional free/busy import to create BLOCK appointments, so personal
   commitments count as conflicts.

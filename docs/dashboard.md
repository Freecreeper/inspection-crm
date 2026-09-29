# Dashboard (V1) — Hybrid Command Center

The Dashboard is the CRM's operational starting point. It answers *what is
happening today, what needs my attention, what should I do next, how is the
business doing at a glance, and what just happened* — in that order of
visual priority — following **scan → preview → act → open the full record**.
It is a view over the CRM's own records, not a second copy of them, and not
a reporting tool (Reports stays the place for analysis).

## Architecture

```
/dashboard (server page, rendered per request)
  ├─ resolvePreferences(user.dashboardPreferences, role)   lib/dashboard/preferences.ts
  ├─ loadDashboard(viewer, prefs)                          lib/dashboard/service.ts
  │    └─ one DashboardContext per request                 lib/dashboard/sources.ts
  │         shared, lazily loaded records (each at most once, only if a
  │         visible widget needs it): inspections today→+14 days (via the
  │         Calendar's loadCalendarEvents), unfinished reports, collectible
  │         invoices, open tasks due within a week
  │    ├─ loadAttention      lib/dashboard/attention.ts   (Needs Attention rules)
  │    ├─ loadKpis           lib/dashboard/metrics.ts     (Business Snapshot)
  │    └─ loadRecentActivity lib/dashboard/activity.ts    (Recent Activity)
  └─ DashboardApp (client)   customization, drawers, dialogs
       ├─ saveDashboardPreferences / restoreDashboardDefaults   (server actions)
       ├─ searchEverything → lib/search/global.ts
       └─ Calendar's PreviewDrawer, ScheduleDialog, Reschedule/Cancel/AddTask dialogs (reused)
```

| Module | Role |
| --- | --- |
| `lib/dashboard/registry.ts` | The controlled catalog: widgets, KPIs, attention categories, role defaults — each naming its required permissions (pure, client-safe) |
| `lib/dashboard/preferences.ts` | Reading (lenient, always valid and permission-safe) and saving (strict validation) of the per-user document |
| `lib/dashboard/sources.ts` | The per-request context and the shared, bounded queries |
| `lib/dashboard/service.ts` | `loadWidget` / `loadDashboard` — one loader per widget, errors contained per card |
| `lib/dashboard/attention.ts` | Needs Attention rules as pure functions + sorting + loader |
| `lib/dashboard/metrics.ts` | KPI calculations and periods |
| `lib/dashboard/activity.ts` | Recent Activity feed |
| `lib/dashboard/layout.ts` | Row layout (pairs half-width widgets) and Shown/Hidden reorder helpers (pure) |
| `lib/search/global.ts`, `kinds.ts` | Global record search |

Everything the browser receives is derived on the request from authoritative
records. The page reads the session, so it is rendered per request — a
newly scheduled inspection, a paid invoice, a completed task, or a resolved
delivery failure shows on the next load, and after any change made from the
Dashboard itself (it refreshes). There is no Dashboard cache.

## Widgets

| Key | Widget | Needs | Span | Options |
| --- | --- | --- | --- | --- |
| `today` | Today | `calendar:view` | full | My inspections / All inspections |
| `needsAttention` | Needs Attention | `dashboard:view` (+ per category) | full | My items / All items; optional categories |
| `actionQueue` | Email & Task Actions | `dashboard:view` (emails: `email:view`) | full | My tasks / All tasks |
| `snapshot` | Business Snapshot | `dashboard:view` (+ per KPI) | full | KPI selection |
| `upcoming` | Upcoming | `calendar:view` | half | My schedule / All inspectors; next 7 / 14 days |
| `recentActivity` | Recent Activity | `activity:view` | half | — |
| `myTasks` | Tasks ("My Tasks" / "Open Tasks") | `dashboard:view` | half | My / All |
| `reportsPending` | Reports Needing Completion | `dashboard:view` | half | My / All |
| `outstandingInvoices` | Outstanding Invoices | `financial:read` | half | — |
| `realtorFollowUps` | Realtor Follow-Ups | `dashboard:view` | half | My / All |
| `leadActivity` | Lead Activity | `dashboard:view` | half | This week / This month |

Two consecutive half-width widgets share a row on wide screens; a lone one
takes the whole row. Phones and tablets stack widgets in the user's order.

**Today** reuses the Calendar's events for the day (inspections, tasks,
report deadlines, Realtor follow-ups and dates). Inspections show time,
address, services, inspector, and readiness (✓ Ready or the first warning).
Every item opens the Calendar's own preview drawer (Call, Email, Mark
signed, Reschedule, Cancel, Open inspection — as the role allows).

**Email & Task Actions** is the work queue, with the actions in the card:

- *Emails* (roles with `email:view`; business-wide): recent failed or
  bounced email first (non-campaign, last 14 days), then drafts waiting for
  review (the same queue as Email → Review), 6 shown with the total.
  **Retry** re-runs the email's rules on the server and says what happened
  (e.g. "Customer email not provided"); **Review & send** opens the draft in
  the standard composer — nothing is sent without opening it; **Discard**
  asks first; a bounced email links to the message (the address needs
  fixing, not a retry). Sending actions need `email:send`.
- *Tasks* due this week or overdue (My / All): **Complete**, **Reschedule**
  (inline date), and for Realtor follow-ups **Call** and **Email** (with the
  follow-up template). Task actions need `task:update`; **Add task** opens
  the shared task dialog.

**Upcoming** counts inspections per day after today, with how many need
attention, linking to the Calendar day.

## Needs Attention rules

Deterministic rules over the records (no AI). Each is a pure function, so an
item disappears as soon as its record changes — nothing is stored.

| Category | Rule | Severity | Required | Action |
| --- | --- | --- | --- | --- |
| `conflict` | Scheduled/in-progress inspection, today → +14 days, overlapping another for the same inspector (the Calendar's conflict check) | critical | yes | Review (drawer) |
| `deliveryFailed` | A `ReportDelivery` is FAILED and nothing for that report has been SENT/VIEWED since (report not delivered) | critical | yes | Review |
| `emailFailed` | Transactional email FAILED/BOUNCED in the last 14 days (failed report emails are covered by the delivery rule) | warning | yes | Review |
| `noInspector` | Scheduled inspection, today → +14 days, no inspector | warning | yes | Assign (drawer) |
| `agreementUnsigned` | Scheduled inspection, today → +7 days, `agreementSignedAt` empty | warning if today/tomorrow, else action | yes | Review (drawer) |
| `reportUnfinished` | Completed inspection whose latest report isn't FINALIZED/DELIVERED/ARCHIVED ("not started", "awaiting review", "not finalized") | warning once past the report turnaround, else action | yes | Start/Open report |
| `invoiceOverdue` | Issued invoice (sent/partly paid/overdue) past `dueAt` with a balance | action | yes | View invoice |
| `taskOverdue` | Open task (no Realtor) whose due day has passed | action | optional | Open (drawer) |
| `realtorFollowUp` | Open task linked to a Realtor, due today or earlier | action (overdue) / info (today) | optional | Contact (drawer) |
| `emailReview` | Automation drafts waiting in the review queue | info | optional | Review |

Required categories can't be hidden (they risk a missed inspection, an
undelivered report, lost operational mail, or unpaid work). Each category
also needs its own permission (`financial:read` for invoices, `email:view` /
`email:send` for email). "My items" limits inspection/report/task items to
those assigned to the viewer and leaves out business-wide queues (invoices,
the email review queue).

**Ordering:** immediate impact (critical, then problems with today's
inspections) → overdue → due date/time → severity → recency.

## Business Snapshot KPIs

At most **6** at a time (`KPI_LIMIT`); "View Business Analytics" links to
Reports. Every card links to the list behind the number.

| KPI | Definition | Needs |
| --- | --- | --- |
| Inspections this month / week | Inspections SCHEDULED, IN_PROGRESS, or COMPLETED with `scheduledAt` in the business-time-zone month/week (cancelled excluded) | — |
| Revenue this month | **Billed revenue**: sum of `InvoiceItem.amount` on invoices with status SENT, PARTIALLY_PAID, PAID, or OVERDUE whose invoice date (`issuedAt`, or `createdAt` if never issued) is in the month. Drafts and voids excluded. Billed, not collected — the same basis as Realtor revenue. | `financial:read` |
| Avg inspection value | That same revenue ÷ the number of those same invoices (one invoice per inspection job); "—" when nothing is billed | `financial:read` |
| Referrals this month | Transactions created this month with a `referralSourceId`. Only a Referral Source attributes a referral — being the agent on a deal (`TransactionRealtor`) never does. | — |
| Realtor referrals this month | As above, where the referral source is a Realtor | — |
| Outstanding balance / Unpaid invoices | Balance (items − payments) on SENT/PARTIALLY_PAID/OVERDUE invoices, and how many have a balance | `financial:read` |
| Reports awaiting completion | Completed inspections without a finalized/delivered report | — |
| Unsigned agreements | Scheduled inspections in the next 14 days without a signed agreement | — |
| New leads this month | Leads created this month | — |
| Overdue tasks | Open tasks whose due date has passed | — |

`/invoices` (financial roles) lists outstanding invoices and this month's
billed invoices using exactly these definitions; `/inspections` gains
`?filter=report-pending` and `?filter=agreement-unsigned`.

## Recent Activity

Merged by time from what's already recorded, last 7 days, 8 shown (up to 25):
`ActivityLog` (inspection scheduled/rescheduled/cancelled, agreement signed or
marked unsigned,
task and Realtor follow-up completed, payment received — financial roles
only — customer/Realtor added, transaction started), `ReportVersion`
(finalized/amended), successful `ReportDelivery`, and sent/delivered
automation email (`email:view`). Entities are described with one batched
query per type — no N+1.

## Customization

**Customize Dashboard** opens a panel (a side panel on wide screens, so the
Dashboard updates beside it; a full-screen sheet on phones):

- **Shown, in order** — untick to hide; reorder by dragging a row or with
  **Move up / Move down** buttons (keyboard-accessible, announced to screen
  readers). **Hidden — tick to add** — ticking adds the widget to the end.
  Reordering only happens among shown widgets, so every move is visible.
- Approved per-widget filters/timeframes (see the widget table).
- **Business Snapshot KPIs** — checkboxes, disabled at the limit.
- **Needs Attention** — required categories listed (locked); optional ones
  switchable.
- **Restore Default Dashboard** — asks first if it would discard changes.

Changes apply immediately and **save automatically** (debounced). The panel
says "Saving…", then "All changes saved" only after the server confirms;
on failure it says what went wrong and offers *Try again* / *Undo my
changes*. After a save the page refreshes so newly shown widgets/KPIs load.

### Preference storage

One versioned JSON document on `User.dashboardPreferences` (the same pattern
as `calendarPreferences` and the Realtor layouts), rather than a row per
widget: the layout is always read and written whole, and a single document
keeps order, visibility, KPIs, and options consistent.

```json
{ "version": 1,
  "widgets": [{ "key": "today", "visible": true }, …],   // display order
  "kpis": ["inspectionsMonth", "revenueMonth", …],       // ≤ 6
  "options": { "upcoming": { "scope": "mine", "timeframe": "next14" } },
  "hiddenAttention": ["realtorFollowUp"] }
```

- **Saving** (`validatePreferences`, strict): unknown keys or fields,
  duplicates, more than 6 KPIs, options a widget doesn't offer, required
  attention categories, or any widget/KPI the role can't use → rejected,
  nothing written. The user id comes from the session only.
- **Reading** (`resolvePreferences`, lenient): `null`, malformed, or other
  versions → the role default; unknown keys dropped; widgets/KPIs the role
  can no longer use removed; widgets missing from the document (added to the
  catalog later) appended hidden. It never throws.
- **Restore** stores `NULL`, so the role default — including future changes
  to it — applies.
- No executable content and no queries are ever stored: only catalog keys
  and enumerated option values.

### Role defaults

| Role | Widgets (in order) | KPIs |
| --- | --- | --- |
| Owner/Admin (and Reporting Analyst) | Today, Needs Attention, Email & Task Actions, Business Snapshot, Upcoming, Recent Activity | Inspections this month, Revenue this month, Avg inspection value, Referrals this month |
| Office staff | Today, Needs Attention, Email & Task Actions (all tasks), Business Snapshot, Upcoming, Recent Activity | Inspections this week, Unsigned agreements, Outstanding balance, Reports awaiting completion |
| Inspector | Today, Needs Attention, My Tasks, Reports Needing Completion, Upcoming — all "My" (Email & Task Actions available, set to "My tasks") | Inspections this week, Inspections this month, Reports awaiting completion, Overdue tasks |

Users who have already saved a layout keep it: widgets added later (such as
Email & Task Actions) appear in Customize → Hidden, one tick away, rather
than being forced onto their Dashboard. Defaults are filtered by the user's current permissions; if a default KPI
isn't allowed, the snapshot is topped up from a non-financial fallback list.

## RBAC — customization never grants access

- New permissions: `dashboard:view`, `activity:view`, `search:global` (all
  staff roles). Widgets, KPIs, and attention categories each name the
  existing permissions they need (`calendar:view`, `financial:read`,
  `email:view`, `email:send`, …).
- The server decides availability: the page resolves preferences against
  the role, `loadWidget` re-checks before loading, `loadKpis` skips any KPI
  the role can't see, and the shared invoice loader asserts
  `financial:read` itself. A stored or tampered preference naming a
  restricted widget/KPI is ignored on read and rejected on save.
- If a permission is removed, previously configured restricted widgets and
  KPIs simply disappear.
- *Note:* per the business owner, `financial:read` currently includes every
  staff role, so today every role *may* add financial widgets (the Inspector
  default just doesn't). Narrowing `financial:read` in `rbac.ts` removes
  them everywhere with no other change — verified in acceptance testing.

## Global search and + New

Search (header; `/` focuses it) is server-backed: debounced (200 ms), at
least 2 characters, 5 results per type across Customers, Realtors,
Brokerages, Properties (opens the latest transaction), Transactions (by
address or customer name), and Inspections. Keyboard: ↑/↓, Enter, Escape.

**+ New** shows only what the role may do: Schedule inspection and New task
(the Calendar's dialogs), New customer (duplicate-checked quick create), New
realtor, New transaction, New lead. No "New invoice" — there's no invoice
creation workflow yet.

## Performance

- Only visible widgets are loaded; hidden widgets cost nothing.
- Shared records are loaded once per request and shared across widgets
  (one inspection query serves Today, Upcoming, and the scheduling rules).
- Every query is bounded: date windows (today → +14 days, last 7/14 days,
  this month/week) and `take` limits (8 rows per list, 50 unfinished
  reports, 20 failures, 25 activity rows, 500 collectible invoices).
- Counts and sums are done in the database (`count`, `aggregate`).
- Activity descriptions are batched per entity type (no N+1).
- Indexes added: `leads(createdAt)`, `report_deliveries(status)`. Already
  used: `inspections(scheduledAt)`, `inspections(inspectorId, scheduledAt)`,
  `inspection_reports(inspectionId)`, `tasks(dueAt)`, `tasks(assigneeId)`,
  `tasks(realtorId, completedAt)`, `invoices(status)`, `invoices(dueAt)`,
  `activity_logs(createdAt)`, `email_messages(status, …)`,
  `transactions(createdAt)`.

## Future: AI morning brief

The Dashboard's facts come from deterministic services (`loadAttention`,
`loadKpis`, the Today/Upcoming loaders). A future brief ("Today you have
three inspections; one has an unsigned agreement…") can summarize those
outputs; it must not decide what needs attention or compute figures.

## Known limitations (V1)

- Widget sizes are fixed per widget (full or half); no user resizing.
- KPIs appear in the order they were chosen; no separate KPI reordering.
- "View all" for Needs Attention expands in place (no separate page), and
  Recent Activity shows up to 25 entries (no full activity-history page).
- Tasks have date-only due dates, so overdue/due-today is by business day.
- Global search lives in the Dashboard header, not yet in the app shell.
- `financial:read` covers all staff roles today (see RBAC).
- Revenue is billed revenue; a collected-cash KPI would need its own
  definition (payments by `paidAt`).

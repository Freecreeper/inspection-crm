# Email & communication (V1)

One central email engine used by the whole CRM. No module talks to an email provider directly.

```
CRM event (inspection scheduled, rescheduled, cancelled, completed; report delivered; invoice due;
           realtor birthday/anniversary; staff composes; campaign approved)
  → automation rule (Automation row: on/off, send mode, settings)
  → conditions + recipient resolution (server-side)
  → template (EmailTemplate) → render (allow-listed {{fields}} only)
  → EmailMessage row  (= the queue: DRAFT / SCHEDULED / QUEUED / SKIPPED / SUPPRESSED)
  → worker claims → re-checks guard + eligibility → provider adapter
  → SENT (+ Communication row in CRM history) → webhook → DELIVERED / BOUNCED
```

Code lives in `src/lib/email/`:

| File | Responsibility |
| --- | --- |
| `config.ts` | Environment config and the secret-free `describeEmailDelivery()` shown in the UI |
| `providers/` | `EmailProvider` interface, Postmark adapter (REST, no SDK), log (simulated) provider |
| `variables.ts`, `render.ts` | Allow-listed template fields; renderer; text→safe HTML |
| `context.ts` | Builds field values from real CRM records only |
| `eligibility.ts` | Who may receive which category (suppression + realtor preferences) |
| `queue.ts` | `enqueueEmail()` — the single way an email is created; `cancelPendingEmails()` |
| `guards.ts` | Conditions re-checked immediately before sending |
| `worker.ts` | Claim/send/retry/record; secure report links minted at send time |
| `system.ts` | `ensureEmailSystem()` (defaults) and `runEmailTick()` (one worker pass) |
| `automations/` | Registry + the six automation categories |
| `campaigns.ts` | Audience rules, preview, materialization |
| `webhooks.ts` | Postmark webhook verification + processing |
| `unsubscribe.ts`, `preferences.ts` | Signed preference links; opt-out handling |

## Provider: Postmark

Chosen because the architecture proposal (§27) and `.env.example` already named it, it is built for transactional mail,
and its **message streams** map directly onto the operational vs. bulk distinction: operational and 1:1 relationship mail
uses the transactional stream; campaigns and marketing use the broadcast stream. It supports Basic-auth webhooks and
account-level suppression.

**Setup**

1. Create a Postmark server. Note its **Server API token** → `POSTMARK_API_TOKEN`.
2. Verify your sending domain (DKIM + Return-Path) or at least a Sender Signature for `EMAIL_FROM`.
3. Create a **Broadcast** message stream (name it `broadcast`, or set `POSTMARK_BROADCAST_STREAM`).
4. Webhooks (on both streams): URL `https://USER:PASS@your-host/api/webhooks/postmark` with events Delivery, Bounce,
   Spam Complaint, Subscription Change. Put the same USER/PASS in `POSTMARK_WEBHOOK_USERNAME` / `POSTMARK_WEBHOOK_PASSWORD`.
5. Set `APP_BASE_URL` to the public URL (used in report and preference links).
6. Set `EMAIL_DELIVERY_MODE=live` only when you are ready for real recipients.

### Adding another provider

Implement `EmailProvider` (`providers/types.ts`): `send(OutboundEmail) → SendResult`. Map its errors onto
`retryable` (definitely not accepted, safe to retry), `ambiguous` (may have been accepted — never auto-retried), and
`suppressed` (recipient refused). Return it from `getEmailProvider()`, and add a webhook route that normalizes its events
into `parsePostmarkEvent`'s `ParsedEvent` shape. No business module changes.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `EMAIL_DELIVERY_MODE` | `log` (default: simulate, deliver nothing), `redirect` (deliver everything to `EMAIL_REDIRECT_TO`), `live` |
| `EMAIL_REDIRECT_TO` | Test inbox for `redirect` mode |
| `EMAIL_FROM` | Default From address (overridable in Email → Settings) |
| `POSTMARK_API_TOKEN` | Server API token (server-only, never shown in UI or logs) |
| `POSTMARK_TRANSACTIONAL_STREAM` / `POSTMARK_BROADCAST_STREAM` | Stream IDs (default `outbound` / `broadcast`) |
| `POSTMARK_WEBHOOK_USERNAME` / `POSTMARK_WEBHOOK_PASSWORD` | Webhook Basic-auth credentials; webhook is rejected if unset |
| `APP_BASE_URL` | Public base URL for links (falls back to `NEXTAUTH_URL`) |
| `APP_TIMEZONE` | Time zone for dates/times in email and for birthday/anniversary days |
| `EMAIL_WORKER_SECRET` | Bearer secret enabling `POST /api/cron/email`; endpoint disabled when empty |
| `EMAIL_WORKER_INTERVAL_MS`, `EMAIL_WORKER_BATCH` | Worker tick interval and per-tick batch size |
| `AUTH_SECRET` | Also signs unsubscribe/preference links |

## Development & test behavior

- Default mode is **`log`**: every email goes through the whole pipeline (templates, eligibility, guards, history) but
  the log provider delivers nothing. Messages are recorded as SENT with `simulated = true` and labeled
  **"simulated — not delivered"** everywhere they appear; a banner on every Email page states the mode.
- `redirect` sends real email, but only to `EMAIL_REDIRECT_TO`, with the real recipient in the subject.
- Under Vitest the mode is forced to `log`, and tests inject a fake provider (`setEmailProviderForTesting` or the
  `provider` argument). No test can reach Postmark.
- The worker isn't running by default in development. Run `npm run worker`, or use **Process queue now** on Email → Messages.

## Queue & worker

`email_messages` is a **transactional outbox**: rows are created alongside the CRM change and the worker sends them.
Redis/BullMQ was deliberately not introduced: Redis is provisioned but unused, an outbox row can't be lost the way a
separately-enqueued job can, and V1 volumes are small. Each tick (`runEmailTick`):

1. Fails rows stuck in SENDING > 10 min (**not** resent — the provider may have accepted them).
2. Promotes SCHEDULED rows whose time has come to QUEUED.
3. Every 10 min: runs the time-based sweeps (inspection catch-up, invoice reminders, birthdays, anniversaries).
4. Starts approved campaigns whose time has come (SCHEDULED → RUNNING → materialize recipients); completes finished ones.
5. Claims a batch with `UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED)` and processes each row.

Run it with `npm run worker` (long-running; safe to run more than one) or call `POST /api/cron/email` with
`Authorization: Bearer $EMAIL_WORKER_SECRET` every minute from a scheduler.

### Retries, idempotency, failure handling

- **Idempotency keys** (`EmailMessage.idempotencyKey`, unique): e.g. `inspection:<id>:confirmation:customer:<id>`,
  `inspection:<id>:reminder:v<scheduleVersion>:customer:<id>`, `invoice:<id>:reminder:<stage>`,
  `thank-you:inspection:<id>:realtor:<id>`, `birthday:<realtorId>:<year>`, `campaign:<id>:realtor:<id>`.
  A repeated event returns the existing row.
- **Guards** re-checked at send time: the inspection is still SCHEDULED at the same `scheduleVersion`; the invoice still
  has a balance; the campaign wasn't cancelled. A failed guard → CANCELLED with the reason.
- **Retries**: only when the provider definitely didn't accept the email (network refused, 429, 5xx) — backoff
  1, 5, 15, 60 min, up to 5 attempts, then FAILED. Timeouts and interrupted sends are FAILED immediately with a message
  telling staff to check before retrying, so a customer is never emailed twice.
- An email problem **never** fails the CRM action that triggered it: hooks run after the change is saved, through
  `runAutomationSafely`, which records a FAILED automation event instead of throwing.
- Nothing fails silently: every automation decision is an `AutomationEvent`, and every email has a status and a
  plain-language `statusReason` (Email → Messages, Email → Automations → activity).

## Webhooks

`POST /api/webhooks/postmark` → Basic auth (timing-safe) → `processPostmarkPayload`:

- Each event gets a deterministic `eventKey` stored uniquely in `email_events`; duplicates are acknowledged and ignored.
- Statuses only move forward: Delivery sets DELIVERED only from SENT/SENDING; a hard bounce sets BOUNCED.
- Hard bounce → address suppressed for **all** email. Spam complaint → suppressed for relationship + marketing.
  Subscription changes mirror Postmark's suppressions. Soft bounces are noted only.
- No message content is stored from payloads.

## Templates & variables

Templates (Email → Templates) are plain text with `{{field}}` placeholders from a fixed allow-list
(`src/lib/email/variables.ts`): `recipient.*`, `customer.*`, `realtor.*` (incl. `yearsInCareer`, `yearsWorkingTogether`),
`brokerage.name`, `property.*`, `inspection.date/time/type/previousDate/previousTime`, `inspector.name`,
`transaction.number`, `invoice.number/total/balanceDue/dueDate`, `report.number/version/secureLink`, `company.*`.

- Unknown fields are rejected when saving a template and never resolved.
- A missing value is **never invented**. Authors may give an explicit fallback: `{{inspector.name | "our inspector"}}`.
  Without one, an automatic email with a missing value is SKIPPED ("Missing information: Inspection time"), and the
  composer won't send until the person fills it in.
- `report.secureLink` is filled only at send time and redacted in the stored copy.
- Preview uses clearly-labeled `[sample]` values; the composer previews against the real record.

## Automations

| Automation | Trigger | Default | Recipients |
| --- | --- | --- | --- |
| Inspection confirmation | Inspection saved with a date/time (or reinstated) | On, automatic | Customers on the transaction (all or primary); realtors only if enabled |
| Inspection reminder | `hoursBefore` (24) before the time | On, automatic | Same |
| Appointment changed / cancelled | Date/time change or cancellation (never other edits) | On, automatic | Same |
| Payment reminder | Issued invoice with balance, `daysBeforeDue` and every `overdueRepeatDays` (max N) | **Off**, automatic | Transaction's primary customer |
| Report ready | Staff deliver a finalized version to an explicitly chosen recipient and choose "email" | On, automatic | That recipient only |
| Realtor thank-you | Inspection COMPLETED | On, review | Realtors on the transaction in the configured roles |
| Realtor birthday | `daysBefore` a stored birthday (month/day, no year) | On, review | That realtor |
| Realtor anniversaries | Career-start or working-together anniversary (≥1 year) | On, review | That realtor |

Each is toggled and configured in Email → Automations (no code). **Review** prepares a DRAFT in Email → Needs review
(and in the realtor's preview drawer); nothing sends until a person reviews and clicks Send. Marketing is never an
automation — it's a campaign.

Realtors never receive a report because they're on a transaction: report emails go only to the ReportDelivery
recipient staff chose, and the link is bound to that delivery's immutable `ReportVersion`.

### Adding an automation

1. Add an entry to `AUTOMATIONS` in `automations/registry.ts` (name, trigger, category, default mode, zod config).
2. Add a default template in `defaults.ts` if needed.
3. Write a handler that resolves recipients and calls `enqueueEmail` with an idempotency key and a guard; call it from
   the CRM action via `runAutomationSafely`, or from `runEmailTick` if it's time-based.

## Transactional vs. relationship vs. marketing

`EmailCategory` is set by the template and can't be switched to dodge preferences (a marketing template can't run as a
relationship campaign).

- **Transactional (operational)**: confirmations, reminders, changes, invoices, reports. Blocked only by an ALL-scope
  suppression (dead address).
- **Relationship**: 1:1, non-promotional realtor mail. Respects `Realtor.relationshipEmailsEnabled` and NON_TRANSACTIONAL
  suppression; includes a "manage preferences" link.
- **Marketing**: announcements, promotions, educational content. Requires marketing eligibility — by default an explicit
  opt-in (`marketingOptIn` with a recorded source/date; configurable in Settings) and no unsubscribe/suppression;
  always includes an unsubscribe link, the company mailing address, and RFC 8058 one-click `List-Unsubscribe` headers;
  sent on the broadcast stream.

A marketing unsubscribe never blocks operational email. Recipients manage both switches at `/u/<signed token>`.
**Assumption to confirm with counsel:** B2B realtor marketing is treated as opt-in by default (stricter than
CAN-SPAM's opt-out model); the setting exists for the business to change.

## Campaigns

Email → Campaigns: Draft (template, subject, body, audience rules: brokerages, brokerage cities, activity in last N
months, or hand-picked realtors) → **Preview audience** (eligible count, excluded count by reason, full lists) →
Submit for review → **Owner approves** (now or at a time) → worker materializes one EmailMessage per realtor
(excluded ones recorded as SKIPPED with the reason; duplicate addresses collapsed) → rate-limited sending
(`campaignSendsPerMinute`) → Completed. Cancelling withdraws everything not yet sent. Editing after submission returns
it to draft, so approval always covers exactly what was reviewed. Nothing — including AI — can choose an audience or
send a campaign without that approval.

## RBAC

| Permission | Roles |
| --- | --- |
| `email:view` | All staff |
| `email:send` | Owner/Admin, Office Staff |
| `email:template_manage` | Owner/Admin |
| `email:automation_manage` | Owner/Admin (also settings and Process queue now) |
| `email:campaign_create` | Owner/Admin, Office Staff |
| `email:campaign_approve` | Owner/Admin — approval is what authorizes sending (so there's no separate `campaign_send`) |
| `email:preferences_manage` | Owner/Admin, Office Staff |

All enforced in server actions. Audited in `ActivityLog`: template created/updated, automation enabled/disabled/updated,
settings updated, campaign created/updated/submitted/approved/cancelled, manual email sent, reviewed draft sent, email
cancelled/retried/discarded, suppression added/removed, realtor email preferences and unsubscribes.

## AI

The V1 engine doesn't use AI. Future AI drafting would produce DRAFT (review) messages through `enqueueEmail` like any
other preparer; it can't send, change preferences, pick recipients, or touch financial values.

## Known V1 limitations

- No invoice creation UI (invoices come from elsewhere or seed data); payments can be recorded.
- Plain-text templates rendered to simple HTML; no rich/HTML editor or attachments.
- No open/click tracking (deliberately off).
- Reminders/sweeps rely on the worker running; without it emails stay QUEUED/SCHEDULED (visible in the UI).
- Inspection emails use `Inspection.scheduledAt`; standalone Calendar appointments don't send email.
- Report emails can't be switched to review mode (the recipient decision is the review).
- Customer marketing isn't supported (customers only receive operational email).
- The composer offers recipients related to the record it was opened from; there's no free-form "To".

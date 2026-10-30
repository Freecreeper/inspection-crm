# Inspection CRM

Home inspection CRM. The product has four equally-important pillars sharing one relational data
model: (1) CRM/operations, (2) relationship management, (3) inspection report generation, and
(4) business intelligence/custom reporting.

## Status

**IMPLEMENTED**
- **Pillar 1/2 — CRM & relationships**: Leads → Customers → Transactions, with multiple independent
  Customers per Transaction (`TransactionCustomer`, at most one primary contact); Properties;
  Realtors/Brokerages with brokerage-change history; Referral sources; Calendar scheduling (see below),
  Tasks, Communications, Documents (upload + session/RBAC-gated download, local-disk storage)
- **Pillar 3 — Inspection Report Builder**: Inspection scheduling and conditions-on-site capture;
  report creation from a `ReportTemplate` (sections/components copied, never linked); per-component
  inspection status with a non-blocking limitation note; Findings (custom or inserted from the
  Narrative library, always editable afterward without touching the shared library entry); photo
  upload on findings (session/RBAC-gated inline-served, image-only upload validation); a deterministic
  Report Summary derived from inspector-approved findings; non-blocking Report Validation (warnings
  vs. genuine blockers); Finalization that snapshots the report and renders a real PDF
  (`@react-pdf/renderer`), creating an immutable `ReportVersion`; Amendment (reopens editing,
  preserves every prior version); Delivery via a signed, hashed, expiring token
  (`/r/[token]`, no staff auth) — recipients are always explicit, never auto-selected from
  transaction participants; staff can email the link to that recipient (minted at send time) or copy it
  to send themselves
- **Pillar 4 — Business Intelligence**: a Reporting Query Service (`src/lib/reporting.ts`) that
  validates every field/filter/group/aggregation against `ReportFieldCatalogEntry` (a DB-seeded
  allow-list) before building a safe, typed Prisma query — no raw SQL, no arbitrary field names; a
  Custom Report Builder (entity → columns → filters → group/aggregate → run/save/export, all via
  plain GET forms, no client JS); four Standard Reports; CSV export; saved reports (private or
  shared); grouped totals always reconcile against unfiltered NULL/"Unknown" buckets, never silently
  dropped
- **Email & communication (V1)** — see [docs/email.md](docs/email.md): one central engine (Postmark adapter,
  Postgres outbox + worker, verified webhooks), templates, composer, operational automations (confirmation,
  reminder, appointment change, payment reminder, report ready), realtor relationship automations (thank-you,
  birthday, anniversaries) with review-before-send, lightweight realtor campaigns with owner approval, and
  category-aware preferences/suppression. Delivery is simulated unless `EMAIL_DELIVERY_MODE=live`.
- **Calendar & scheduling (V1)** — see [docs/calendar.md](docs/calendar.md): Day / Week / Month views built
  from the authoritative records (inspections with duration, blocked time, tasks, report deadlines, date-only
  transaction dates, realtor follow-ups/birthdays/anniversaries, billing) via range-bounded queries; a preview
  drawer with readiness; click-to-schedule with server-backed typeahead and duplicate-checked create-while-
  scheduling; drag-or-button rescheduling with confirmation; server-side inspector conflict detection under a
  lock; one business time zone everywhere; and the existing email automations for confirm/change/cancel.
- **Dashboard (V1)** — see [docs/dashboard.md](docs/dashboard.md): the operational starting point — Today,
  Needs Attention (deterministic rules), Business Snapshot KPIs with written definitions, Upcoming, Recent
  Activity, Email & Task Actions (retry / review-and-send / discard email; complete / reschedule / email tasks),
  plus optional Tasks / Reports / Invoices / Follow-ups / Leads widgets; global record search and
  "+ New"; per-user customization (show/hide, reorder, up to 6 KPIs, approved filters, restore default)
  saved server-side and always filtered by RBAC.
- Staff auth (Auth.js, credentials + JWT) and RBAC (`src/lib/rbac.ts`), enforced in every mutating
  server action across all four pillars — not just hidden in the UI

**PARTIALLY IMPLEMENTED**
- Invoices: balances, payment recording, and reminders on the transaction page, and a read-only
  `/invoices` list (outstanding / billed this month); no invoice creation UI yet
  (`Service`/`InspectionService` remain data-model only)
- `CustomFieldDefinition`/`CustomFieldValue`, `ReportDefinition` (saved custom reports use this —
  the schema's other intended purpose, business-user-defined custom fields on core entities, is
  still unbuilt)

**DEFERRED**
- Invoice creation UI
- Custom fields UI
- Object storage (S3/R2) — see "Local filesystem storage is a production blocker" below

## Known limitations & production readiness

**Local filesystem storage is a production blocker, not a dev convenience.** Documents, media
(finding photos), and generated report PDFs are all written to `storage/` on local disk
(`src/lib/documents.ts`, `src/lib/media.ts`, `finalizeReport` in
`src/app/(app)/inspections/report-actions.ts`). This is fine for local dev and CI, but it does
**not** survive redeployment on ephemeral/stateless hosting (containers, serverless, most PaaS
targets redeploy onto a fresh filesystem) and is not itself a durable, backed-up store. Do not
deploy this application to production without first replacing it with durable private object
storage (e.g. S3/R2). The replacement needs to support everything the current local-disk
implementation already provides, so none of it can be dropped in the migration:
- private storage for media and finalized PDFs (never a public bucket — everything here is
  gated by session/RBAC or a signed delivery token)
- secure access to each object (signed URLs or an equivalent proxy, not direct public links)
- expiring access where the current code already expires it (the 30-day `ReportDelivery` access
  token in `src/lib/delivery.ts` must still gate PDF access the same way after migration)
- the file validation already in place (`validateUpload`/`validateMediaUpload`'s MIME/extension
  allow-lists and size caps) applied before any object is written, not after
- object deletion/retention policies (`deleteMedia` currently unlinks the local file directly —
  its replacement needs the equivalent object-store delete, plus a real retention policy for
  everything that isn't explicitly deleted)
- a migration path for whatever is already sitting in `storage/` in any environment that has to
  move off local disk

**Custom reporting cannot currently group or aggregate across a relation.** The Reporting Query
Service (`src/lib/reporting.ts`) restricts `groupBy`/aggregation to fields that belong directly to
the report's primary entity (see the `ReportValidationError("Grouping is only supported on the
entity's own fields.")` check). Related-entity fields (anything with a `joinPath` in
`ReportFieldCatalogEntry`) can be displayed and filtered on, but never used as a group/aggregation
dimension, because Prisma's `groupBy` cannot aggregate across a relation without dropping to raw
SQL — and this service's entire security model is "every field is allow-listed before it reaches
a typed Prisma call," which raw, string-built SQL would undermine. This is a real, currently-open
gap: it blocks cross-entity business questions the product should eventually answer, such as
revenue by Realtor, revenue by Brokerage, revenue by Referral Source, inspections by Realtor or
Brokerage, conversion by Referral Source, or anything aggregating Transaction-relationship data
(Service/Invoice/Payment) across a related entity. Do not close this gap by hand-building dynamic
SQL from user-controlled field names. The safe path is one of:
- a small set of **purpose-built, hand-written cross-entity queries** (the same pattern already
  used for `inspections-by-city`, which groups by a joined field outside the generic service
  because the generic service deliberately disallows it) for the specific cross-entity questions
  the product actually needs, each reviewed and parameterized individually; or
- a **materialized/denormalized reporting table** (e.g. a nightly or triggered rollup that flattens
  Transaction → Realtor/Brokerage/ReferralSource/Invoice into one row per fact), queried by the
  existing allow-listed service against that flat table instead of joining live relations; or
- extending `ReportFieldCatalogEntry` with an explicit, curated list of safe cross-entity
  group keys (not arbitrary joins) once the specific relations to support are chosen, each backed
  by a hand-reviewed Prisma query rather than dynamic SQL.

Whichever of these is chosen should be proposed and reviewed before implementation — this section
exists so the limitation isn't silently rediscovered later, not to prescribe the final design.

The first path now covers the most-asked questions: **Revenue by Realtor**, **Revenue by Brokerage**
and **Revenue by Referral Source** (with lead conversion) are fixed Standard Reports
(`src/lib/reports/crossEntity.ts` for the attribution rules, `crossEntityData.ts` for the typed
queries), with a period picker and CSV export. The generic builder still can't group across a relation.

## Stack

Next.js (App Router) + TypeScript, PostgreSQL via Prisma, Auth.js (credentials + JWT sessions),
Tailwind CSS. See the architecture proposal §1 for the full stack and rationale.

## Local setup

```bash
docker compose up -d        # Postgres + Redis
cp .env.example .env        # then set AUTH_SECRET: npx auth secret (required; the app won't start without it)
npm install
npx prisma migrate dev      # apply the schema
npx prisma db seed          # admin@example.com / inspector@example.com, password "changeme123"
npm run dev
npm run worker              # optional: sends queued email (simulated unless EMAIL_DELIVERY_MODE=live)
```

Open http://localhost:3000 and sign in with the seeded admin account.

## Testing & CI

```bash
npm run typecheck   # tsc --noEmit
npm run lint
npm test            # vitest run
npm run build
```

CI (`.github/workflows/ci.yml`) runs all of the above against an ephemeral Postgres service
container on every push/PR, using `npm ci` against the committed `package-lock.json`, plus
`prisma validate`, `prisma migrate deploy`, and a seed smoke test.

## Production (crm.n3rdlabs.dev)

Deploys are run by hand from a laptop: `npm run ship` (`deploy/ship.sh`) on a clean `master` that
matches `origin/master`. It runs lint, typecheck and the tests, then SSHes to the netcup box
(`crm-server` alias for `genesisadmin@152.53.89.254`, override with `CRM_SSH_HOST`) and runs
`~/inspection-crm/bin/autodeploy --force` (a copy of `deploy/autodeploy.sh`). That fetches `master`,
exports it to `~/inspection-crm/releases/<time>-<sha>` and runs `deploy/deploy.sh`: build the image,
apply migrations, re-run the (create-only) seed, then swap the app and email-worker containers.
`ship` then confirms the box's live revision and the login page.

A failed build or migration leaves the running version up. Every deploy is logged in
`~/inspection-crm/deploy.log`. Without `--force`, `autodeploy` ships only a commit whose CI passed;
its every-minute crontab entry is commented out (not deleted) in genesisadmin's crontab, and
uncommenting it turns push-to-deploy back on. The box hosts other live projects, so the deploy
touches only the `inspection-crm` Compose project and prunes only that project's images.

On the box (`~/inspection-crm`):

- `source/` — a clone of this repo; only ever fetched, never checked out over.
- `shared/.env` — `POSTGRES_PASSWORD` and `AUTH_SECRET` (mode 600, not in git). It is also passed
  to the app and worker whole, so `APP_TIMEZONE`, `EMAIL_DELIVERY_MODE`, `POSTMARK_*` and the
  `CALENDAR_*` settings from `.env.example` go here (then redeploy). Email is simulated until
  `EMAIL_DELIVERY_MODE=live`. Password-reset email is the exception (docs/email.md, "Account email"):
  `ACCOUNT_EMAIL_FROM` is `Inspection CRM <no-reply@n3rdlabs.dev>`, and `RESEND_API_KEY` (a
  sending-only key for n3rdlabs.dev in the n3rdlabs Resend team) is set with
  `~/inspection-crm/bin/set-resend-key`, which reads it at a hidden prompt and restarts the app.
- `current` — symlink to the live release.
- Docker Compose project `inspection-crm` (`deploy/compose.yml`): Postgres in the
  `inspection-crm_db-data` volume, `storage/` (uploads, photos, PDFs) in `inspection-crm_storage`,
  and the app on `127.0.0.1:3400`, which Caddy serves as crm.n3rdlabs.dev. Both volumes survive
  redeploys but live only on that box; nothing backs them up off it yet (see "Local filesystem
  storage" above).

Production never gets the demo logins. To add an owner-admin login, or reset its password:

```bash
cd ~/inspection-crm && CRM_ENV_FILE=$PWD/shared/.env docker compose --project-name inspection-crm \
  --env-file shared/.env -f current/deploy/compose.yml run --rm --no-deps app \
  npx tsx scripts/create-admin.ts you@example.com "Your Name"
```

If `deploy/autodeploy.sh` changes, copy it to `~/inspection-crm/bin/autodeploy` by hand. Deploys run
that fixed copy, so a bad edit to it cannot stop the deploy that would fix it.

## Project layout

- `prisma/schema.prisma` — the full data model (§3–§8 of the architecture proposal).
- `src/lib/auth.ts` — staff authentication (§13).
- `src/lib/rbac.ts` — the role/permission matrix (§14), enforced in every mutating server action.
- `src/lib/validation.ts` — the non-blocking, action-specific readiness pattern (§7).
- `src/lib/documents.ts` — upload validation (MIME/extension allow-list, size cap), safe file
  naming, and hardened `Content-Disposition` handling for the document download route.
- `src/lib/transactions.ts` — `getPrimaryCustomer`, since Transaction has no primary-customer
  scalar FK (see the schema comment on `Transaction` for why).
- `src/lib/reportEngine.ts` — report number generation, the editable-status list, the deterministic
  summary-sync (`syncReportSummary`), and the `ReportSnapshot` type shared by finalization and the
  PDF renderer.
- `src/lib/media.ts` — photo upload validation (image-only allow-list, size cap), separate from
  `documents.ts` since the two resource types are served differently (inline vs. forced download).
- `src/lib/pdf/` — the `@react-pdf/renderer` report template (`ReportDocument.tsx`) and the function
  that embeds finding photos as data URIs and renders it to a `Buffer` (`renderReportPdf.ts`).
- `src/lib/delivery.ts` — signed-token lookup/expiry/viewed-tracking shared by the staff-side
  delivery-creation action and the public `/r/[token]` routes.
- `src/lib/reporting.ts` — the Reporting Query Service (Pillar 4): the allow-list-validated query
  builder, and the query-string codec the (client-JS-free) Custom Report Builder UI uses to encode
  its whole config into a GET request.
- `src/proxy.ts` — route protection (Next.js 16's `proxy` convention; runs on the Node.js runtime
  so it can safely use the Prisma-backed auth config). `/r/` (report delivery) is the one public path.
- `src/app/(app)/` — the authenticated CRM and reporting screens.
- `src/app/r/[token]/` — the public, unauthenticated report-delivery view and PDF download.

## Minimum data required to create a Transaction

None. `Transaction` has no required foreign keys — not a customer, not a property, not a referral
source. All of it can be attached afterward without blocking the record from existing; only the
id/status/timestamps are non-optional, and those are all defaulted. This mirrors the non-blocking,
action-specific readiness pattern in `src/lib/validation.ts`: only the specific action that
genuinely needs a piece of information (e.g. emailing a report needs a customer email) should be
gated on it, never record creation as a whole.

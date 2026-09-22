# Inspection CRM

Home inspection CRM. The product has four equally-important pillars sharing one relational data
model: (1) CRM/operations, (2) relationship management, (3) inspection report generation, and
(4) business intelligence/custom reporting.

## Status

**IMPLEMENTED**
- Leads → Customers → Transactions, with multiple independent Customers per Transaction
  (`TransactionCustomer`, one marked primary contact)
- Properties
- Realtors/Brokerages, including brokerage-change history (`RealtorBrokerageHistory`), seeded on
  Realtor creation and updated on every brokerage change
- Realtor participation on a Transaction (`TransactionRealtor`), with the realtor's brokerage
  snapshotted at the moment they're attached — not a live lookup, since a transaction has no single
  instant to resolve a date-range history lookup against
- Referral sources
- Scheduling (`Appointment`), Tasks, Communications (append-only log), Documents (upload + a
  session/RBAC-gated download route, local-disk storage)
- Staff auth (Auth.js, credentials + JWT) and RBAC (`src/lib/rbac.ts`), enforced in every mutating
  server action listed above — not just hidden in the UI

**PARTIALLY IMPLEMENTED**
- Data model only, no UI/logic: `Inspection`, `Service`/`InspectionService`, `Invoice` (now anchored
  to Transaction rather than a 1:1 with Inspection — supports multiple invoices per transaction,
  e.g. a reinspection charge or an adjustment), `InvoiceItem`, `Payment`
- Inspection report engine tables (`InspectionReport`, `ReportTemplate`, `ReportSection`,
  `ReportComponent`, `Finding`, `FindingCategory`, `Narrative`, `Media`, `ReportSummaryItem`,
  `ReportVersion`, `ReportDelivery`) exist in the schema; none have UI, PDF generation, or
  versioning/delivery logic yet
- `CustomFieldDefinition`/`CustomFieldValue`, `ReportDefinition`/`ReportFieldCatalogEntry` (a
  reporting query-builder allow-list), `Automation`/`AutomationEvent` — tables only

**DEFERRED**
- Inspection workflow and inspection scheduling (Pillar 3)
- Inspection Report Builder, PDF generation, report versioning/delivery (Pillar 3)
- Invoicing/payments UI (blocked on the Inspection entity above)
- Custom fields UI (Pillar 1/4)
- Business Intelligence / custom reporting engine (Pillar 4)
- Automations engine

## Stack

Next.js (App Router) + TypeScript, PostgreSQL via Prisma, Auth.js (credentials + JWT sessions),
Tailwind CSS. See the architecture proposal §1 for the full stack and rationale.

## Local setup

```bash
docker compose up -d        # Postgres + Redis
cp .env.example .env        # then fill in AUTH_SECRET (npx auth secret) if not already set
npm install
npx prisma migrate dev      # apply the schema
npx prisma db seed          # admin@example.com / inspector@example.com, password "changeme123"
npm run dev
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
container on every push/PR, plus `prisma validate`, `prisma migrate deploy`, and a seed smoke test.
It currently runs `npm install` rather than `npm ci` — `package-lock.json` couldn't be regenerated
in the sandbox this was built in (no local Node available there); run `npm install` once in a real
environment and commit the refreshed lockfile, then switch CI to `npm ci`.

## Project layout

- `prisma/schema.prisma` — the full data model (§3–§8 of the architecture proposal).
- `src/lib/auth.ts` — staff authentication (§13).
- `src/lib/rbac.ts` — the role/permission matrix (§14), enforced in every mutating server action.
- `src/lib/validation.ts` — the non-blocking, action-specific readiness pattern (§7).
- `src/lib/documents.ts` — upload validation (MIME/extension allow-list, size cap), safe file
  naming, and hardened `Content-Disposition` handling for the document download route.
- `src/lib/transactions.ts` — `getPrimaryCustomer`, since Transaction has no primary-customer
  scalar FK (see the schema comment on `Transaction` for why).
- `src/proxy.ts` — route protection (Next.js 16's `proxy` convention; runs on the Node.js runtime
  so it can safely use the Prisma-backed auth config).
- `src/app/(app)/` — the authenticated CRM screens.

## Minimum data required to create a Transaction

None. `Transaction` has no required foreign keys — not a customer, not a property, not a referral
source. All of it can be attached afterward without blocking the record from existing; only the
id/status/timestamps are non-optional, and those are all defaulted. This mirrors the non-blocking,
action-specific readiness pattern in `src/lib/validation.ts`: only the specific action that
genuinely needs a piece of information (e.g. emailing a report needs a customer email) should be
gated on it, never record creation as a whole.

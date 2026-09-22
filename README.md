# Inspection CRM

Home inspection CRM. The product has four equally-important pillars sharing one relational data
model: (1) CRM/operations, (2) relationship management, (3) inspection report generation, and
(4) business intelligence/custom reporting.

## Status

**IMPLEMENTED**
- **Pillar 1/2 — CRM & relationships**: Leads → Customers → Transactions, with multiple independent
  Customers per Transaction (`TransactionCustomer`, at most one primary contact); Properties;
  Realtors/Brokerages with brokerage-change history; Referral sources; Scheduling (`Appointment`),
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
  transaction participants; email sending itself isn't wired to a real provider yet (no SMTP/Postmark
  credentials configured), so delivery produces a shareable link for staff to send manually,
  and says so in the UI
- **Pillar 4 — Business Intelligence**: a Reporting Query Service (`src/lib/reporting.ts`) that
  validates every field/filter/group/aggregation against `ReportFieldCatalogEntry` (a DB-seeded
  allow-list) before building a safe, typed Prisma query — no raw SQL, no arbitrary field names; a
  Custom Report Builder (entity → columns → filters → group/aggregate → run/save/export, all via
  plain GET forms, no client JS); four Standard Reports; CSV export; saved reports (private or
  shared); grouped totals always reconcile against unfiltered NULL/"Unknown" buckets, never silently
  dropped
- Staff auth (Auth.js, credentials + JWT) and RBAC (`src/lib/rbac.ts`), enforced in every mutating
  server action across all four pillars — not just hidden in the UI

**PARTIALLY IMPLEMENTED**
- Data model only, no UI/logic: `Service`/`InspectionService`, `Invoice` (anchored to Transaction,
  not a 1:1 with Inspection — supports multiple invoices per transaction), `InvoiceItem`, `Payment`
- `CustomFieldDefinition`/`CustomFieldValue`, `ReportDefinition` (saved custom reports use this —
  the schema's other intended purpose, business-user-defined custom fields on core entities, is
  still unbuilt), `Automation`/`AutomationEvent` — tables only

**DEFERRED**
- Invoicing/payments UI (blocked on Invoice's relationship to real billing workflow, not on the
  Inspection entity anymore — that now exists)
- Custom fields UI
- Automations engine
- Actual email delivery (SMTP/Postmark integration) for report delivery
- Object storage (S3/R2) — uploads (documents, media, report PDFs) are local-disk only, explicitly
  flagged dev-only in this codebase

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
container on every push/PR, using `npm ci` against the committed `package-lock.json`, plus
`prisma validate`, `prisma migrate deploy`, and a seed smoke test.

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

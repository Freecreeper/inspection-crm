# Inspection CRM

Home inspection CRM. The product has four equally-important pillars sharing one relational data
model: (1) CRM/operations, (2) relationship management, (3) inspection report generation, and
(4) business intelligence/custom reporting.

Pillars 1 and 2 are built: leads, customers, transactions, properties, realtors/brokerages (with
brokerage-change history), referral sources, scheduling (appointments), tasks, communications, and
documents (session-gated download, local-disk storage as a dev-only stand-in for object storage).

Pillars 3 (Inspection Report Builder) and 4 (Business Intelligence) are not built yet. Invoicing
and payments are part of Pillar 1 but are blocked on the Inspection entity, which Pillar 3
introduces — see "What's not built yet" below.

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

## Project layout

- `prisma/schema.prisma` — the full data model (§3–§8 of the architecture proposal).
- `src/lib/auth.ts` — staff authentication (§13).
- `src/lib/rbac.ts` — the role/permission matrix (§14).
- `src/lib/validation.ts` — the non-blocking, action-specific readiness pattern (§7).
- `src/proxy.ts` — route protection (Next.js 16's `proxy` convention; runs on the Node.js runtime
  so it can safely use the Prisma-backed auth config).
- `src/app/(app)/` — the authenticated CRM screens.

## What's not built yet

The Inspection entity itself (and thus inspection scheduling), the Inspection Report Builder,
media/PDF pipeline, invoicing/payments, custom fields, the business reporting engine, and
automations — see the architecture proposal's milestones (§26) for the planned order.

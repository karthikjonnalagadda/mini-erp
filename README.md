# Mini ERP + CRM Operations Portal

A production-grade ERP and CRM for a wholesale/distribution business: customer
relationship management, product catalogue, real-time inventory with an
append-only stock ledger, and sales challans with transactional stock deduction.

Built as a TypeScript monorepo — Express + Prisma + PostgreSQL on the back,
React + Vite + Tailwind on the front — with clean architecture, role-based access
control and a complete audit trail.

<p align="center">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white">
  <img alt="Node" src="https://img.shields.io/badge/Node-20+-339933?logo=node.js&logoColor=white">
  <img alt="Express" src="https://img.shields.io/badge/Express-4.21-000000?logo=express&logoColor=white">
  <img alt="Prisma" src="https://img.shields.io/badge/Prisma-6-2D3748?logo=prisma&logoColor=white">
  <img alt="PostgreSQL" src="https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white">
  <img alt="React" src="https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black">
  <img alt="License" src="https://img.shields.io/badge/license-MIT-green">
</p>

---

## Table of contents

- [What this is](#what-this-is)
- [Feature overview](#feature-overview)
- [Tech stack](#tech-stack)
- [Architecture](#architecture)
- [Folder structure](#folder-structure)
- [Quick start](#quick-start)
- [Environment variables](#environment-variables)
- [Database migrations and seeding](#database-migrations-and-seeding)
- [Running the applications](#running-the-applications)
- [API documentation](#api-documentation)
- [Business rules that matter](#business-rules-that-matter)
- [Security](#security)
- [Testing](#testing)
- [Deployment](#deployment)
- [Screenshots](#screenshots)
- [Known limitations](#known-limitations)
- [Future improvements](#future-improvements)
- [Documentation index](#documentation-index)

---

## What this is

Most portfolio ERP projects are CRUD with an inventory table. The parts that make
a real ERP hard are concurrency, atomicity and auditability — and those are what
this project is actually about:

- **Stock cannot go negative or drift.** Every quantity change goes through one
  service, takes a row lock in a deterministic order, validates all lines before
  writing any, and produces exactly one ledger row. A CHECK constraint enforces
  the same invariant below the application, so even a future code path that
  bypasses the service cannot corrupt the data.
- **Confirming a challan is atomic across four writes.** Deduct stock, append
  ledger rows, flip the document status, update the customer balance — all or
  nothing. A partial application means physical stock and the system disagree,
  which is the worst failure an ERP has.
- **History does not change.** Line items snapshot the product's SKU, name,
  price and tax rate at the moment they are written. Repricing the catalogue does
  not rewrite last quarter's documents.
- **Money is never a float.** All arithmetic happens in integer paise and is
  converted once at the boundary.

---

## Feature overview

### CRM

Customer accounts with contact details, GSTIN, addresses and credit terms.
Sequential customer codes (`CUST-000042`). Follow-up scheduling with types, due
tracking and outcome capture. A merged activity timeline that interleaves CRM
activities with audit events, so "who called them" and "who changed their credit
limit" appear in one chronology.

### Catalogue and inventory

Products with SKU, category, pricing, GST rate, unit of measure and reorder
level. Two-level category tree. Live stock levels with derived
`IN_STOCK`/`LOW_STOCK`/`OUT_OF_STOCK` status. Manual adjustments (signed delta)
and stock takes (absolute counted quantity) — two genuinely different operations,
both producing ledger entries. Stock valuation at cost and at selling price.

### Sales challans

Draft → Confirmed → Cancelled state machine. Multi-line documents with per-line
discounts and server-computed totals. Confirmation deducts stock atomically and
rejects over-selling with a per-SKU shortage list. Cancelling a confirmed challan
returns the stock and reverses the customer's balance. PDF export.

### Platform

JWT auth with rotating refresh tokens and reuse detection. Four roles with
separation of duties. Complete audit trail with redacted before/after diffs.
Role-scoped dashboard with charts. OpenAPI documentation. Health probes.

---

## Tech stack

| Layer | Choice | Notes |
|---|---|---|
| Language | TypeScript 5.7 | `strict`, plus `noUncheckedIndexedAccess` and `noImplicitReturns` |
| Runtime | Node 20 | |
| API | Express 4.21 | |
| ORM | Prisma 6 | |
| Database | PostgreSQL 16 | Neon in production |
| Validation | Zod 3 | Same library both sides of the wire |
| Auth | jsonwebtoken + bcryptjs | See [trade-offs](docs/ARCHITECTURE.md#trade-offs) for bcryptjs |
| Docs | OpenAPI 3 + Swagger UI | |
| PDF | PDFKit | Streamed, flat memory profile |
| Frontend | React 18 + Vite 6 | |
| Routing | React Router 6 | |
| Server state | TanStack Query 5 | |
| Forms | React Hook Form + Zod | |
| Styling | Tailwind 3 + Radix primitives | |
| Charts | Recharts | Palette validated for CVD and contrast |
| Tests | Vitest | |

---

## Architecture

```
Routes  →  Controllers  →  Services  →  Repositories  →  Prisma  →  PostgreSQL
   │            │              │              │
   │            │              │              └─ the ONLY layer that touches Prisma
   │            │              └─ ALL business rules; no Express, no Prisma
   │            └─ HTTP ⇄ DTO translation only
   └─ rate limit → authenticate → authorize → validate
```

Three rules, enforced without exception:

1. **Controllers contain no business logic.** A rule cannot then be implemented
   twice, differently, in two endpoints.
2. **Services never import Prisma and never see `req`/`res`.** They are unit
   testable with plain objects and reusable from a CLI or a queue worker.
3. **Repositories are the only Prisma consumers.** Soft-delete filtering,
   pagination clamping and lock ordering are enforced in one place.

Full detail — including the concurrency model, the SOLID rationale behind
specific files, and every significant trade-off — is in
**[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

---

## Folder structure

```
mini-erp-crm/
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma              # 13 models, explicit referential actions
│   │   ├── migrations/                # init + hand-written integrity constraints
│   │   └── seed.ts                    # idempotent; stock posted via the ledger
│   ├── src/
│   │   ├── config/                    # env (Zod-validated), prisma, swagger
│   │   ├── constants/                 # http status, error codes, messages
│   │   ├── controllers/               # HTTP ⇄ DTO
│   │   ├── dto/                       # request/response contracts + mappers
│   │   ├── interfaces/                # repository abstractions
│   │   ├── middleware/                # auth, rbac, validate, sanitize, errors
│   │   ├── repositories/              # the only Prisma consumers
│   │   ├── routes/                    # the security manifest of the app
│   │   ├── services/                  # all business rules
│   │   ├── types/                     # shared types, Express augmentation
│   │   ├── utils/                     # errors, logger, money, jwt, pagination
│   │   ├── validators/                # Zod schemas
│   │   ├── app.ts                     # middleware assembly
│   │   └── server.ts                  # bootstrap, graceful shutdown
│   ├── tests/                         # unit tests (62)
│   └── Dockerfile
│
├── frontend/
│   ├── src/
│   │   ├── api/                       # axios client, endpoints, query client
│   │   ├── components/
│   │   │   ├── ui/                    # design-system primitives
│   │   │   ├── common/                # page header, toolbar, dialogs, tiles
│   │   │   ├── charts/                # validated palette + chart components
│   │   │   ├── customers/ products/   # feature dialogs
│   │   ├── context/                   # auth, theme
│   │   ├── hooks/                     # useListParams, useToast
│   │   ├── layouts/                   # sidebar, navbar, shell
│   │   ├── pages/                     # 13 screens
│   │   ├── routes/                    # route table, guards, nav manifest
│   │   ├── services/                  # typed API wrappers
│   │   ├── types/                     # API contract types
│   │   └── utils/                     # formatting, cn
│   ├── nginx.conf
│   ├── vercel.json
│   └── Dockerfile
│
├── docs/
│   ├── ARCHITECTURE.md                # layering, concurrency, SOLID, trade-offs
│   ├── DATABASE.md                    # ER diagram, schema decisions, constraints
│   ├── DEPLOYMENT.md                  # Neon + Render + Vercel, troubleshooting
│   ├── API_TESTING.md                 # Swagger, curl and Newman recipes
│   └── postman/                       # collection + environment
│
├── .github/workflows/ci.yml
├── docker-compose.yml
└── render.yaml
```

---

## Quick start

### Prerequisites

- Node.js 20+
- PostgreSQL 16 — locally, via Docker, or a Neon connection string

### Option A — Docker (everything at once)

```bash
git clone <repository-url>
cd mini-erp-crm

docker compose up -d --build
docker compose exec api npx prisma migrate deploy
docker compose exec api npm run db:seed
```

Open **http://localhost:5173**.

### Option B — local

```bash
git clone <repository-url>
cd mini-erp-crm

# 1. Backend
cd backend
npm install
cp .env.example .env          # then edit DATABASE_URL and the JWT secrets
npx prisma migrate deploy
npm run db:seed
npm run dev                   # http://localhost:4000

# 2. Frontend (in a second terminal)
cd frontend
npm install
npm run dev                   # http://localhost:5173
```

No frontend `.env` is needed in development: requests go to `/api/v1`, which the
Vite dev server proxies to the backend — keeping them same-origin so the
httpOnly refresh cookie works without HTTPS.

### Seeded accounts

All four share the password **`Admin@12345`**.

| Email | Role | Can do |
|---|---|---|
| `admin@erpportal.io` | ADMIN | Everything, including user management |
| `sales@erpportal.io` | SALES | CRM, create and edit challans |
| `warehouse@erpportal.io` | WAREHOUSE | Catalogue, stock, confirm challans |
| `accounts@erpportal.io` | ACCOUNTS | Read-only operations, cancel challans, audit logs |

Sign in as more than one to see role separation in action: SALES cannot confirm
a challan, WAREHOUSE cannot cancel one.

The seed creates 5 users, 5 categories, 16 products (deliberately including
low-stock and out-of-stock items), 10 customers, 12 follow-ups and 15 challans
across all three states.

---

## Environment variables

### Backend (`backend/.env`)

Every variable is validated by Zod at boot; the process refuses to start with a
readable report if anything is missing or malformed.

| Variable | Required | Default | Notes |
|---|---|---|---|
| `NODE_ENV` | | `development` | `development` \| `test` \| `production` |
| `PORT` | | `4000` | |
| `API_PREFIX` | | `/api/v1` | Must start with `/` |
| `DATABASE_URL` | ✅ | — | PostgreSQL connection string |
| `JWT_ACCESS_SECRET` | ✅ | — | ≥32 chars |
| `JWT_REFRESH_SECRET` | ✅ | — | ≥32 chars, **must differ from the access secret** |
| `JWT_ACCESS_EXPIRES_IN` | | `15m` | |
| `JWT_REFRESH_EXPIRES_IN` | | `7d` | |
| `BCRYPT_SALT_ROUNDS` | | `12` | Lower only for tests |
| `CORS_ORIGINS` | | `http://localhost:5173` | Comma-separated, no trailing slash |
| `RATE_LIMIT_WINDOW_MS` | | `900000` | |
| `RATE_LIMIT_MAX` | | `300` | |
| `AUTH_RATE_LIMIT_MAX` | | `10` | Per IP+email |
| `LOG_LEVEL` | | `info` | `error` \| `warn` \| `info` \| `http` \| `debug` |
| `SEED_ADMIN_EMAIL` | | `admin@erpportal.io` | |
| `SEED_ADMIN_PASSWORD` | | `Admin@12345` | |

Generate secrets:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

### Frontend (`frontend/.env`)

| Variable | Required | Notes |
|---|---|---|
| `VITE_API_BASE_URL` | Production only | **Build-time.** Vite inlines it; changing it requires a redeploy. Leave unset locally to use the dev proxy. |
| `VITE_DEV_API_TARGET` | | Overrides the dev proxy target |

> Only `VITE_`-prefixed variables reach the browser. That prefix is a security
> boundary: anything exposed is compiled into the bundle and readable in
> devtools. Never put a secret there.

---

## Database migrations and seeding

```bash
cd backend

npx prisma migrate dev --name <description>   # create a migration (development)
npx prisma migrate deploy                     # apply pending migrations (CI/production)
npx prisma migrate reset --force              # drop, re-apply, re-seed (destructive)
npx prisma studio                             # browse the data
npm run db:seed                               # idempotent
```

Two migrations ship with the project:

1. `20260729000000_init` — generated from `schema.prisma`.
2. `20260729000100_integrity_constraints` — hand-written CHECK constraints,
   partial unique indexes and composite indexes that Prisma's schema language
   cannot express. See [docs/DATABASE.md](docs/DATABASE.md#constraints-prisma-cannot-express).

---

## Running the applications

From the repository root:

```bash
npm run install:all      # install both packages
npm run dev:backend      # API with hot reload
npm run dev:frontend     # SPA with HMR
npm run build            # build both
npm run typecheck        # typecheck both
npm run lint             # lint both
```

Backend-specific:

```bash
cd backend
npm run dev              # tsx watch
npm test                 # vitest
npm run test:watch
npm run build            # prisma generate + tsc
npm start                # node dist/server.js
```

---

## API documentation

Interactive Swagger UI, with the backend running:

```
http://localhost:4000/api/v1/docs
```

Raw specification: `http://localhost:4000/api/v1/openapi.json`

### Response envelope

Every response — success or failure — has the same shape, so a client writes one
interceptor and one error handler:

```jsonc
// Success
{
  "success": true,
  "message": "Request completed successfully",
  "data": { },
  "meta": { "page": 1, "limit": 20, "totalItems": 137, "totalPages": 7,
            "hasNextPage": true, "hasPreviousPage": false },
  "timestamp": "2026-07-29T09:14:22.517Z",
  "requestId": "4f2c…"
}

// Failure
{
  "success": false,
  "message": "The submitted data failed validation",
  "error": {
    "code": "VALIDATION_ERROR",
    "details": [{ "field": "mobile", "message": "Enter a valid 10-digit Indian mobile number" }]
  },
  "timestamp": "2026-07-29T09:14:22.517Z",
  "requestId": "4f2c…"
}
```

Clients switch on `error.code`, which is stable. `message` is human-facing and
free to change.

### Endpoints

| Method | Path | Roles | Description |
|---|---|---|---|
| `POST` | `/auth/login` | public | Sign in |
| `POST` | `/auth/refresh` | public | Rotate the refresh token |
| `POST` | `/auth/logout` | public | Revoke the current session |
| `GET` | `/auth/me` | any | Current profile |
| `PATCH` | `/auth/me` | any | Update own profile |
| `POST` | `/auth/change-password` | any | Change password (revokes all sessions) |
| `POST` | `/auth/logout-all` | any | Sign out everywhere |
| `GET` | `/auth/roles` | any | List roles |
| `GET`/`POST` | `/auth/users` | ADMIN | List / provision users |
| `PATCH` | `/auth/users/:id/status` | ADMIN | Activate, deactivate, suspend |
| `DELETE` | `/auth/users/:id` | ADMIN | Soft-delete a user |
| `GET` | `/customers` | all | Search, filter, sort, paginate |
| `POST` | `/customers` | ADMIN, SALES | Create |
| `GET` | `/customers/:id` | all | Detail |
| `PUT` | `/customers/:id` | ADMIN, SALES | Update |
| `DELETE` | `/customers/:id` | ADMIN | Soft-delete (409 if challans exist) |
| `GET` | `/customers/:id/timeline` | all | Merged activity feed |
| `GET`/`POST` | `/customers/:id/follow-ups` | all / ADMIN, SALES | Activities |
| `POST` | `/customers/follow-ups/:id/complete` | ADMIN, SALES | Record an outcome |
| `GET` | `/categories`, `/categories/options` | all | Categories |
| `POST`/`PUT` | `/categories`, `/categories/:id` | ADMIN, WAREHOUSE | Manage |
| `GET` | `/products` | all | Search, filter, low-stock, paginate |
| `POST`/`PUT` | `/products`, `/products/:id` | ADMIN, WAREHOUSE | Manage |
| `DELETE` | `/products/:id` | ADMIN | Soft-delete (409 if stock or history) |
| `GET` | `/products/:id/movements` | all | Per-product ledger |
| `GET` | `/inventory/summary` | all | Dashboard aggregates |
| `POST` | `/inventory/:id/adjust` | ADMIN, WAREHOUSE | Signed adjustment |
| `POST` | `/inventory/:id/stock-take` | ADMIN, WAREHOUSE | Absolute reconciliation |
| `GET` | `/stock-movements` | all | Ledger, filtered |
| `GET` | `/challans` | all | List |
| `POST` | `/challans` | ADMIN, SALES | Create a DRAFT |
| `PUT` | `/challans/:id` | ADMIN, SALES | Edit a DRAFT |
| `DELETE` | `/challans/:id` | ADMIN, SALES | Delete a DRAFT |
| `POST` | `/challans/:id/confirm` | ADMIN, WAREHOUSE | **Deduct stock** |
| `POST` | `/challans/:id/cancel` | ADMIN, ACCOUNTS | **Restore stock** |
| `GET` | `/challans/:id/pdf` | all | Download the document |
| `GET` | `/dashboard` | any | Role-scoped metrics |
| `GET` | `/audit-logs` | ADMIN, ACCOUNTS | Compliance trail |
| `GET` | `/health`, `/health/ready` | public | Liveness, readiness |

Every list endpoint supports `page`, `limit` (capped at 100), `search`, `sortBy`
(allow-listed per resource) and `sortOrder`, plus resource-specific filters.

---

## Business rules that matter

### The challan state machine

```
                confirm                        cancel
   DRAFT ──────────────────────► CONFIRMED ────────────────► CANCELLED
     │                            (stock −N)                  (stock +N)
     │  cancel
     └──────────────────────────────────────────────────────► CANCELLED
                                (no stock effect)
```

- A **draft** may be edited, deleted, and may even exceed available stock — it is
  a proposal, and creating it moves nothing.
- **Confirming** atomically deducts stock, writes one ledger row per line, stamps
  who and when, and increases the customer's outstanding balance. If any line is
  short, the whole transaction rolls back and the response names every shortage:

  ```json
  {
    "error": {
      "code": "INSUFFICIENT_STOCK",
      "details": { "shortages": [
        { "sku": "ELE-WIR-25SQ", "name": "Copper Wire 2.5 sq mm", "requested": 50, "available": 12 }
      ]}
    }
  }
  ```

- A **confirmed** challan is immutable. There is no path back to draft: it is a
  financial record, and "un-confirming" one would let someone rewrite history.
  Cancel and re-issue instead.
- **Cancelling** a confirmed challan returns the stock and reverses the balance.
  Cancelling a draft does neither — crediting stock that was never deducted would
  invent inventory out of nothing.

### Separation of duties

The person who raises a document is not the person who releases the goods:

| Action | Roles |
|---|---|
| Create / edit a challan | ADMIN, SALES |
| Confirm and dispatch | ADMIN, WAREHOUSE |
| Cancel | ADMIN, ACCOUNTS |
| Adjust stock | ADMIN, WAREHOUSE |

### Other enforced invariants

- Stock can never go negative — in the service, and again as a database CHECK.
- A product may appear only once per challan (validated, and a DB unique index).
- A customer with issued challans cannot be deleted; a product holding stock or
  appearing on a challan cannot be deleted.
- Mobile, email and GSTIN are unique among **live** customers; soft-deleting one
  releases the value for reuse.
- Prices, SKUs and tax rates are read from the database when a line is created —
  a client may propose a negotiated `unitPrice`, but never a tax rate.
- Blacklisted customers cannot be issued challans.

---

## Security

| Area | Implementation |
|---|---|
| Headers | Helmet — CSP, HSTS, nosniff, frame-deny, referrer policy |
| CORS | Explicit origin allow-list with credentials |
| Rate limiting | Global; stricter on auth (keyed IP+email); tighter on PDF |
| Tokens | HS256 with pinned issuer, audience and algorithm |
| Sessions | 15-min access token; 7-day refresh, rotated with reuse detection |
| Refresh storage | SHA-256 hashes only — a DB dump is not replayable |
| Passwords | bcrypt cost 12; 72-byte cap (bcrypt truncates silently past it) |
| Enumeration | Identical response and timing for unknown-account vs wrong-password |
| Authorisation | Named role policies on every route |
| Input | Zod with unknown-key stripping (mass assignment impossible), recursive sanitisation, prototype-pollution guard |
| Injection | Prisma parameterises everything; raw SQL uses tagged templates |
| Output | Explicit DTO mappers — a new column is invisible until deliberately exposed |
| Audit | Every mutation logged with actor, IP, request id and a redacted diff |

Two decisions worth calling out:

**The auth middleware re-reads the user on every request.** Trusting the JWT
alone means a deactivated employee keeps access until their token expires. In a
system that controls stock and pricing, a 15-minute window is not acceptable. The
cost is one indexed primary-key lookup.

**The access token lives in memory, not `localStorage`.** An XSS payload can read
`localStorage`; it cannot read a module closure without already having deeper
access. A page refresh loses the access token, and the httpOnly refresh cookie
silently restores the session.

---

## Testing

```bash
cd backend
npm test            # 62 unit tests
npm run test:watch
```

Unit tests cover the pure domain logic where a silent bug is most expensive:

- **Money** — discount-before-tax ordering, half-up rounding on values like
  `8.475` that binary floating point stores as `8.474999…`, and the invariant
  that a document total equals the sum of its printed line totals.
- **Pagination** — limit clamping (`?limit=100000` → 100) and `sortBy`
  allow-listing, which is the security boundary preventing a caller from
  ordering by arbitrary columns.
- **Validation** — GSTIN, Indian mobile, SKU and password rules; the sanitiser's
  prototype-pollution guard; that legitimate text like `"Rate < 10%"` survives.
- **Errors** — the status-code and `error.code` contract the frontend depends on,
  particularly `TOKEN_EXPIRED`, which drives silent refresh.

API-level testing is covered by the Postman collection, whose **Business Rules**
folder asserts the full challan lifecycle including the over-sell rollback. See
**[docs/API_TESTING.md](docs/API_TESTING.md)**.

CI runs lint, typecheck, unit tests, `prisma migrate deploy` against a real
Postgres service container, the seed **twice** (proving idempotency), and both
Docker builds.

---

## Deployment

| Component | Platform |
|---|---|
| Frontend | Vercel |
| Backend | Render (`render.yaml` blueprint included) |
| Database | Neon PostgreSQL |

Step-by-step instructions, including the pooled-vs-direct connection distinction
for migrations, the cross-site cookie requirements, and a troubleshooting table,
are in **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**.

---

## Screenshots

> Placeholders — capture from a seeded local instance and drop the images into
> `docs/screenshots/`.

| Screen | Image |
|---|---|
| Login | `docs/screenshots/01-login.png` |
| Dashboard | `docs/screenshots/02-dashboard.png` |
| Customers | `docs/screenshots/03-customers.png` |
| Customer detail & timeline | `docs/screenshots/04-customer-detail.png` |
| Products | `docs/screenshots/05-products.png` |
| Inventory & stock adjustment | `docs/screenshots/06-inventory.png` |
| Challan form | `docs/screenshots/07-challan-form.png` |
| Challan detail | `docs/screenshots/08-challan-detail.png` |
| Stock movement ledger | `docs/screenshots/09-stock-movements.png` |
| Audit logs | `docs/screenshots/10-audit-logs.png` |
| Dark mode | `docs/screenshots/11-dark-mode.png` |
| Swagger UI | `docs/screenshots/12-api-docs.png` |

---

## Known limitations

Stated plainly, because a project that claims no limitations has not been looked
at closely enough.

1. **Rate limiting is in-memory, so limits are per-instance.** Correct on a
   single Render instance; behind a multi-instance deployment this must become
   the Redis store (`rate-limit-redis`) — a one-line change in
   `middleware/rate-limit.middleware.ts`.
2. **No integration test suite in CI.** The unit tests cover pure domain logic;
   the transactional paths are exercised through Postman rather than an automated
   `supertest` + testcontainers suite. `supertest` is already a dependency for
   this reason.
3. **Single warehouse.** `Inventory` has exactly one row per product. The schema
   carries `warehouseLocation`, but multi-warehouse stock would need the unique
   constraint to become `(productId, warehouseId)` plus a `Warehouse` entity.
4. **`quantityReserved` is modelled but not yet used.** Reservation on draft
   creation is a natural next step; today only confirmation moves stock.
5. **Offset pagination.** `LIMIT/OFFSET` degrades past roughly 100k rows because
   Postgres must still walk the skipped rows. Cursor pagination would be the fix
   at that scale.
6. **No file uploads.** `Product.imageUrl` accepts a URL; there is no S3 upload
   pipeline.
7. **Follow-up "overdue" is materialised by a sweep on read**, not a scheduled
   job. Fine at this scale; a cron job would be cleaner.
8. **No email/SMS.** Follow-up reminders exist in the UI only.
9. **Render's free tier cold-starts** — the first request after idle can take
   ~30 seconds.
10. **Audit log growth is unbounded.** A production deployment needs a retention
    policy or partitioning by month.

---

## Future improvements

**Near term**
- Redis-backed rate limiting and a cache in front of the auth user lookup
- Integration tests with testcontainers, wired into CI
- Stock reservation on draft creation, using `quantityReserved`
- CSV/Excel export for every list endpoint
- Cursor pagination on the stock ledger

**Medium term**
- Multi-warehouse inventory with transfers
- Purchase orders and goods-receipt notes, closing the procurement loop
- Payments and receipts against the outstanding balance
- S3 image uploads with presigned URLs
- Scheduled jobs (follow-up reminders, overdue sweeps, ledger reconciliation)
- WebSocket push so a confirmed challan updates other users' stock figures live

**Longer term**
- GST-compliant invoicing with e-invoice IRN generation
- Barcode scanning for stock takes
- Cohort and margin analytics
- Multi-tenancy with row-level security

---

## Documentation index

| Document | Contents |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Layering, request lifecycle, SOLID in practice, the concurrency model, security model, trade-offs |
| [docs/DATABASE.md](docs/DATABASE.md) | Mermaid ER diagram, schema decisions, referential actions, indexes, the constraints Prisma cannot express |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Neon + Render + Vercel, environment matrices, troubleshooting |
| [docs/API_TESTING.md](docs/API_TESTING.md) | Swagger, curl recipes for the full challan lifecycle, Newman |

---

## License

MIT

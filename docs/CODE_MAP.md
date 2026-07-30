# Code map

Where each capability actually lives, so a claim in the README can be checked
against the code without reading 156 files first.

The other documents explain *how* the system is built:
[ARCHITECTURE.md](ARCHITECTURE.md) for layering and concurrency,
[DATABASE.md](DATABASE.md) for the schema. This one is a lookup table: feature →
file.

Paths are repository-relative. Every path here was taken from the tracked file
list rather than written from memory.

---

## How a request flows

Read one vertical slice and the rest of the backend is the same shape. The layers
are strictly one-directional — a controller never touches Prisma, a service never
touches Express.

```
HTTP request
 │
 ├─ app.ts — applied to every request, in this order
 │    helmet / cors / compression / body parsers / cookie-parser
 │    request-context      attaches a requestId to the whole lifecycle
 │    sanitize             strips and normalises input
 │    rate limiter         per-IP, stricter on the auth routes
 │
 ├─ routes/*.routes.ts — per route, in this order
 │    authenticate         verifies the bearer token, loads the user
 │    rbac                 enforces the capability this route declares
 │    validate             Zod parse; 422 with per-field detail on failure
 │
 ├─ controllers/*.controller.ts   HTTP in, HTTP out. No business rules.
 ├─ services/*.service.ts        business rules and transaction boundaries.
 ├─ repositories/*.repository.ts the only place Prisma is called.
 └─ PostgreSQL                   last line of defence — constraints, not code.

 error paths ─▶ notFoundHandler, then errorHandler (app.ts, registered last)
```

The response envelope and error translation are centralised in
`middleware/error.middleware.ts`, which is why every endpoint returns the same
shape and every failure carries a `requestId`.

---

## Backend by feature

| Capability | Route | Service (rules live here) | Data access |
|---|---|---|---|
| Sign in, refresh, logout | `routes/auth.routes.ts` | `services/auth.service.ts` | `repositories/user.repository.ts`, `repositories/refresh-token.repository.ts` |
| Own profile, password change | `routes/auth.routes.ts` | `services/auth.service.ts` | `repositories/user.repository.ts` |
| User administration (ADMIN) | `routes/auth.routes.ts` | `services/auth.service.ts` | `repositories/user.repository.ts`, `repositories/role.repository.ts` |
| Customers CRUD + search | `routes/customer.routes.ts` | `services/customer.service.ts` | `repositories/customer.repository.ts` |
| Follow-ups and timeline | `routes/customer.routes.ts` | `services/customer.service.ts` | `repositories/customer.repository.ts` |
| Products, categories | `routes/product.routes.ts` | `services/product.service.ts` | `repositories/product.repository.ts`, `repositories/category.repository.ts` |
| Inventory, adjustments, stock takes | `routes/product.routes.ts` | `services/stock.service.ts` | `repositories/inventory.repository.ts` |
| Stock ledger | `routes/product.routes.ts` | `services/stock.service.ts` | `repositories/inventory.repository.ts` |
| Challans: draft, confirm, cancel | `routes/challan.routes.ts` | `services/challan.service.ts` | `repositories/challan.repository.ts` |
| Delivery-note PDF | `routes/challan.routes.ts` | `services/pdf.service.ts` | — |
| Dashboard (role-scoped) | `routes/dashboard.routes.ts` | `services/dashboard.service.ts` | aggregates across repositories |
| Audit trail | `routes/dashboard.routes.ts` | `services/audit.service.ts` | — |

Request validation schemas sit beside the routes they guard, in
`backend/src/validators/` — one file per module, plus `common.validators.ts` for
pagination, sorting and the shared id/money primitives.

---

## The invariants, and where each is enforced

These are the claims worth verifying, because they are what separates this from a
CRUD app. Each is enforced in more than one place on purpose: application code can
be bypassed by the next code path someone writes, a database constraint cannot.

| Invariant | Enforced in |
|---|---|
| **Stock cannot go negative** | the dialog disables submit and says why (`frontend/src/components/products/stock-adjust-dialog.tsx`); `services/stock.service.ts` re-checks against a locked row; a `CHECK` constraint in `prisma/migrations/20260729000100_integrity_constraints/migration.sql` makes the state unrepresentable |
| **Confirming a challan is atomic** — stock, ledger, status and customer balance all commit or none do | `services/challan.service.ts`, one transaction |
| **Concurrent confirmations cannot interleave** | `SELECT … FOR UPDATE` in `repositories/inventory.repository.ts` and `repositories/challan.repository.ts`, taken in deterministic product-id order to avoid deadlock |
| **A confirmed document is immutable** | `services/challan.service.ts` rejects the transition; the UI hides the action via server-provided permissions |
| **Cancellation compensates, never deletes** | `services/challan.service.ts` appends a reversing movement rather than mutating history |
| **The ledger is append-only** | no update or delete path exists in `repositories/inventory.repository.ts`, and none is exposed on any route |
| **Money is exact** | integer paise throughout; see `docs/DATABASE.md` for the rationale |
| **Separation of duties** — whoever raises a document cannot release the goods | the capability table in `middleware/rbac.middleware.ts`, declared per route |
| **Audit writes share the caller's transaction** | `services/audit.service.ts`, invoked inside the service transaction — an unauditable stock deduction does not commit |

---

## Frontend by screen

Every screen is one page component. Shared list behaviour — search, filters,
sorting, pagination, URL synchronisation, loading/empty/error states — is
centralised rather than repeated, which is why all seven list screens behave
identically.

| Screen | Route | Component |
|---|---|---|
| Sign in | `/login` | `pages/login-page.tsx` |
| Dashboard | `/dashboard` | `pages/dashboard-page.tsx` |
| Customers | `/customers` | `pages/customers-page.tsx` |
| Customer detail | `/customers/:id` | `pages/customer-detail-page.tsx` |
| Products | `/products` | `pages/products-page.tsx` |
| Inventory | `/inventory` | `pages/inventory-page.tsx` |
| Stock ledger | `/stock-movements` | `pages/stock-movements-page.tsx` |
| Challans | `/challans` | `pages/challans-page.tsx` |
| New / edit challan | `/challans/new`, `/challans/:id/edit` | `pages/challan-form-page.tsx` |
| Challan detail | `/challans/:id` | `pages/challan-detail-page.tsx` |
| Audit logs | `/audit-logs` | `pages/audit-logs-page.tsx` |
| Users | `/users` | `pages/users-page.tsx` |
| Profile & security | `/profile` | `pages/profile-page.tsx` |
| 403 / 404 / error | — | `pages/error-pages.tsx` |

Supporting layers: `frontend/src/api/` (typed client and endpoint map),
`frontend/src/routes/` (route manifest and guards — the sidebar is generated from
it, so a nav item and its route cannot disagree), `frontend/src/components/ui/`
(design-system primitives), `frontend/src/layouts/` (shell, navbar, sidebar).

---

## Where to start reading

Three files carry most of the interesting logic:

1. **`backend/src/services/challan.service.ts`** — the four-part atomic write, the
   state machine, and the compensation on cancel. This is the heart of the project.
2. **`backend/src/middleware/rbac.middleware.ts`** — the capability table. The whole
   permission model is one declarative structure rather than scattered checks.
3. **`backend/prisma/schema.prisma`** — the data model, with
   `prisma/migrations/20260729000100_integrity_constraints/` for the guarantees
   Prisma cannot express.

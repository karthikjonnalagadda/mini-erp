# Architecture

- [Layering](#layering)
- [Request lifecycle](#request-lifecycle)
- [SOLID in practice](#solid-in-practice)
- [Concurrency](#concurrency)
- [Security model](#security-model)
- [Frontend architecture](#frontend-architecture)
- [Trade-offs](#trade-offs)

---

## Layering

```
                    HTTP
                     │
        ┌────────────▼─────────────┐
        │        Middleware        │  request id · sanitise · rate limit
        │                          │  authenticate · authorize · validate
        └────────────┬─────────────┘
                     │
        ┌────────────▼─────────────┐
        │       Controllers        │  HTTP ⇄ DTO. No business logic.
        └────────────┬─────────────┘
                     │  DTO + ActorContext
        ┌────────────▼─────────────┐
        │        Services          │  ALL business rules live here.
        │                          │  No Express. No Prisma.
        └────────────┬─────────────┘
                     │  domain calls
        ┌────────────▼─────────────┐
        │      Repositories        │  The ONLY layer that touches Prisma.
        └────────────┬─────────────┘
                     │
                 PostgreSQL
```

The rules are absolute, and each one buys something concrete:

| Rule | What it buys |
|---|---|
| Controllers contain no business logic | A rule cannot be implemented twice, differently, in two endpoints |
| Services never import Prisma | Services are unit-testable with plain objects; no database needed |
| Services never see `req`/`res` | The same service is callable from a CLI, a queue worker or a GraphQL layer |
| Repositories are the only Prisma consumers | Soft-delete filtering, pagination clamping and lock ordering are enforced in one place |

A controller that grows an `if` encoding a policy has a bug: that policy belongs
in the service.

---

## Request lifecycle

Tracing `POST /api/v1/challans/:id/confirm`:

1. **`requestContext`** assigns a correlation id (or honours an inbound
   `X-Request-Id`) and starts a high-resolution timer. Every log line, audit row
   and error envelope from here on carries that id.
2. **`sanitizeRequest`** recursively trims strings, strips control and
   zero-width characters, neutralises tag openers, and drops `__proto__` keys.
   Runs *before* validation so Zod sees normalised input.
3. **`apiLimiter`** rejects abusive traffic before it costs a database
   round-trip.
4. **`authenticate`** verifies the JWT signature, issuer, audience and
   algorithm, then re-reads the user from the database. The extra lookup is
   deliberate — see [Security model](#security-model).
5. **`authorizePolicy(RolePolicy.CONFIRM_CHALLANS)`** checks the role against a
   named policy.
6. **`validate({ params, body })`** parses with Zod. Unknown keys are stripped,
   so mass-assignment is structurally impossible. All issues across body, query
   and params are collected into one 422.
7. **`challanController.confirm`** builds an `ActorContext` and delegates.
8. **`challanService.confirm`** opens a transaction and performs the four writes
   that must be atomic: deduct stock (with row locks), append ledger rows, flip
   the status, update the customer balance.
9. **`ApiResponse.ok`** wraps the result in the standard envelope.
10. On any throw, **`errorHandler`** maps Prisma/Zod/JWT errors onto our own
    hierarchy, decides what the client may see, and logs at the right severity.

---

## SOLID in practice

Not as a checklist — as the reason specific files look the way they do.

**Single responsibility.** `StockService` is the only writer of inventory
quantities. `ChallanService` owns the document state machine and calls
`StockService` for the stock half. Neither knows how the other persists.

**Open/closed.** `RolePolicy` is a table of named permissions
(`CONFIRM_CHALLANS: ['ADMIN', 'WAREHOUSE']`). Changing who may confirm a challan
is a one-line edit there, not a search-and-replace across route files.

**Liskov substitution.** Every repository accepts an optional `DbClient`, which
is either the root Prisma client or an active transaction. A repository method
behaves identically under both, which is what lets `ChallanService` compose five
repositories into one transaction.

**Interface segregation.** Services depend on `ActorContext` — five fields —
rather than on Express's `Request`. `jwtConfig` is exported separately from `env`
so token utilities do not import the whole environment.

**Dependency inversion.** `interfaces/repository.interface.ts` declares the
persistence contract; services depend on it, not on the Prisma-backed classes.
This is what makes a caching decorator or an in-memory test double a drop-in.

---

## Concurrency

Two warehouse operators confirming challans for the same SKU at the same moment
is not hypothetical — it is Tuesday.

### The failure being prevented

```
T1: read quantityOnHand = 10
T2: read quantityOnHand = 10
T1: 10 - 8 >= 0  ✓  write 2
T2: 10 - 8 >= 0  ✓  write 2
```

Sixteen units have left a warehouse holding ten.

### The fix

`SELECT … FOR UPDATE` inside the caller's transaction. T2 blocks at the SELECT
until T1 commits, then reads `2` and correctly fails its check.

```sql
SELECT "id", "productId", "quantityOnHand", "version"
FROM "inventory"
WHERE "productId" IN (…)
ORDER BY "productId"          -- deadlock avoidance
FOR UPDATE
```

`ORDER BY "productId"` is not cosmetic. Without a deterministic lock order, a
two-line challan can deadlock: A holds SKU-1 waiting for SKU-2 while B holds
SKU-2 waiting for SKU-1. Sorting means every transaction acquires locks in the
same sequence.

Every mutating method in `InventoryRepository` therefore takes a **required**
`tx` parameter — a lock released immediately is worthless, so the type system
enforces that the caller has a transaction.

### Validate-all-then-apply

`StockService.applyMovements` locks every affected row, validates **all** lines
against the locked values, and only then writes. Validating as it goes would
leave a half-applied challan when line 4 of 6 turns out to be short.

### Defence in depth

A CHECK constraint forbids negative `quantityOnHand` at the database level, so
even a future code path that bypasses `StockService` gets a database error rather
than corrupting the ledger.

---

## Security model

| Layer | Measure |
|---|---|
| Transport | Helmet (CSP, HSTS, nosniff, frame-deny), strict CORS allow-list |
| Rate limiting | Global bucket; a stricter one on auth keyed on IP+email; a tighter one on PDF generation |
| Authentication | HS256 JWT with pinned issuer, audience and algorithm |
| Sessions | 15-minute access token; 7-day refresh token, rotated on every use with reuse detection |
| Token storage | Refresh token stored as SHA-256 — a database dump is not replayable |
| Passwords | bcrypt cost 12, per-password salt, 72-byte input cap (bcrypt truncates silently past it) |
| Enumeration | Identical response and timing for unknown-account and wrong-password |
| Authorisation | Role checks on every route via named policies; separation of duties across roles |
| Input | Zod at the boundary with unknown-key stripping; recursive sanitisation; prototype-pollution guard |
| Injection | Prisma parameterises everything; raw SQL uses `Prisma.sql` tagged templates |
| Output | Explicit DTO mappers — a new column is invisible until deliberately exposed |
| Audit | Every mutation logged with actor, IP, request id and a redacted diff |

### Why the auth middleware hits the database

Trusting the JWT alone means a deactivated employee keeps full access until their
token expires. In a system that controls stock and pricing, "fired at 10:00,
still confirming challans at 10:12" is not acceptable. The cost is one indexed
primary-key lookup; if it ever becomes a bottleneck the fix is a short-TTL cache
in front of the repository, not weaker semantics.

### Why refresh tokens rotate

Every refresh revokes the presented token and issues a successor, recording the
link. Presenting an already-revoked token means two parties hold it — one stole
it. Since we cannot tell which, the entire token family is revoked and both must
sign in again.

This is also why the frontend's Axios interceptor uses **single-flight**
refresh: without it, five concurrent 401s would fire five refresh calls, four of
which present an already-consumed token and trip the theft detection on a user
who did nothing wrong.

---

## Frontend architecture

```
main.tsx
  └─ ErrorBoundary          catches render crashes; the shell survives
     └─ QueryClientProvider server state
        └─ ThemeProvider
           └─ BrowserRouter
              └─ AuthProvider  silent session restore on boot
                 └─ AppRoutes
                    ├─ RequireGuest  → /login
                    └─ RequireAuth   → DashboardLayout → pages
```

**State split.** React Query owns everything the server knows. React Context owns
the two things it does not: the authenticated user and the theme. Redux Toolkit
would add a store, slices, typed hooks and middleware to manage less state than a
single form holds.

**URL as state.** Page, search, sort and filters live in the query string. The
back button works, a filtered view is a shareable link, a refresh preserves the
user's filters, and React Query caches per-URL so navigating back is instant.

**Server-computed permissions.** `challan.permissions.canConfirm` comes from the
API. The UI does not re-implement the state machine; if it did, the two would
drift and users would see buttons that always fail.

**Client guards are UX, not security.** Every rule in `RoleGuard` is also
enforced by the API. Bypassing the bundle gets you a screen whose every request
returns 403.

---

## Trade-offs

Decisions where a reasonable engineer might choose differently.

| Decision | Alternative | Why this one |
|---|---|---|
| `bcryptjs` over native `bcrypt` | Native is ~30% faster | Native needs node-gyp and a matching prebuilt per platform/ABI; it breaks Render builds and Windows dev machines. At cost 12 the difference is ~250ms vs ~180ms on a login path. Hashes are interchangeable, so switching back is a one-line change. |
| Hand-written OpenAPI spec | Decorator generation (tsoa, nest) | Decorators mean restructuring the app around a framework; JSDoc scanning puts the contract in comments that drift. One reviewed document is honest about being the contract. |
| Custom logger | Winston / Pino | The requirement is level filtering, structured metadata, redaction and NDJSON in production — about 100 lines. Everything imports the `logger` object, so swapping in Pino later touches one file. |
| React Context over Redux Toolkit | RTK with slices | The global state is one user object and a theme. RTK would be more machinery than state. |
| Hand-maintained API types | Generated from OpenAPI | The packages deploy independently; a client that silently changes shape on `npm install` is worse than one that changes in a reviewable commit. |
| PDFKit over headless Chrome | Puppeteer renders nicer HTML | Puppeteer adds ~300MB of Chromium per deploy and 500MB+ RAM per render — disproportionate for a one-page delivery note, and it does not fit Render's free tier. |
| In-memory rate-limit store | Redis | Correct for a single instance. Behind multiple instances this must become the Redis store — a one-line change, listed under Known Limitations. |
| Dashboard aggregation in one endpoint | Eight resource endpoints | Rendering one screen should not cost eight round-trips, eight auth checks and eight connection acquisitions. |

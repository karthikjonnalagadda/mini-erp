# API testing guide

Three ways to exercise the API, in increasing order of automation.

- [1. Swagger UI](#1-swagger-ui-fastest)
- [2. curl](#2-curl)
- [3. Postman / Newman](#3-postman--newman)
- [What the suite proves](#what-the-suite-proves)

---

## 1. Swagger UI (fastest)

With the backend running, open:

```
http://localhost:4000/api/v1/docs
```

1. Expand **Auth › POST /auth/login**, click **Try it out**, and send the seeded
   admin credentials (`admin@erpportal.io` / `Admin@12345`).
2. Copy `data.tokens.accessToken` from the response.
3. Click **Authorize** (top right), paste the token, and every subsequent
   "Try it out" is authenticated.

The raw specification is at `/api/v1/openapi.json` and can be imported into
Postman, Insomnia or any client generator.

---

## 2. curl

Set up a shell session:

```bash
BASE=http://localhost:4000/api/v1

# Sign in and capture the access token. `-c` stores the httpOnly refresh cookie.
TOKEN=$(curl -s -c cookies.txt -X POST "$BASE/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@erpportal.io","password":"Admin@12345"}' \
  | jq -r '.data.tokens.accessToken')

AUTH="Authorization: Bearer $TOKEN"
```

### Reads

```bash
# Paginated, filtered, sorted list
curl -s -H "$AUTH" \
  "$BASE/customers?page=1&limit=10&status=ACTIVE&sortBy=name&sortOrder=asc" | jq

# Full-text search across name, business name, mobile, GST and code
curl -s -H "$AUTH" "$BASE/customers?search=patil" | jq '.data[].name'

# Products at or below their reorder level
curl -s -H "$AUTH" "$BASE/products?lowStock=true" | jq '.data[] | {sku, stock}'

# Whole dashboard in one call
curl -s -H "$AUTH" "$BASE/dashboard" | jq '.data.metrics'
```

### Writes

```bash
# Create a customer
curl -s -H "$AUTH" -H 'Content-Type: application/json' \
  -X POST "$BASE/customers" -d '{
    "name": "Ramesh Kulkarni",
    "businessName": "Kulkarni Electricals",
    "mobile": "9822014499",
    "gstNumber": "27AAPFU0939F1ZV",
    "customerType": "RETAILER",
    "status": "ACTIVE",
    "creditLimit": 150000
  }' | jq '.data | {id, code, availableCredit}'
```

### The three failure shapes worth knowing

```bash
# 422 — validation, with per-field detail
curl -s -H "$AUTH" -H 'Content-Type: application/json' \
  -X POST "$BASE/customers" -d '{"name":"X","mobile":"123"}' \
  | jq '.error.details'
# [ { "field": "mobile", "message": "Enter a valid 10-digit Indian mobile number", ... } ]

# 409 — duplicate, naming the conflicting field
curl -s -H "$AUTH" -H 'Content-Type: application/json' \
  -X POST "$BASE/customers" -d '{"name":"Dup","mobile":"9822014455","customerType":"RETAILER"}' \
  | jq '{message, code: .error.code, field: .error.details.field}'

# 403 — role denied, naming the roles that would be accepted
curl -s -X POST "$BASE/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"sales@erpportal.io","password":"Admin@12345"}' \
  | jq -r '.data.tokens.accessToken' > sales.token

curl -s -H "Authorization: Bearer $(cat sales.token)" \
  -X POST "$BASE/inventory/SOME_PRODUCT_ID/adjust" \
  -H 'Content-Type: application/json' -d '{"quantityDelta":10}' \
  | jq '.error'
# { "code": "FORBIDDEN", "details": { "requiredRoles": ["ADMIN","WAREHOUSE"], "actualRole": "SALES" } }
```

### The challan lifecycle end to end

```bash
CUSTOMER=$(curl -s -H "$AUTH" "$BASE/customers?limit=1&status=ACTIVE" | jq -r '.data[0].id')
PRODUCT=$(curl -s -H "$AUTH" "$BASE/products?limit=1" | jq -r '.data[0].id')

# 1. Create a DRAFT — no stock is touched
CHALLAN=$(curl -s -H "$AUTH" -H 'Content-Type: application/json' \
  -X POST "$BASE/challans" -d "{
    \"customerId\": \"$CUSTOMER\",
    \"items\": [{\"productId\": \"$PRODUCT\", \"quantity\": 5, \"discountPercent\": 5}]
  }" | jq -r '.data.id')

# Stock is unchanged at this point — verify:
curl -s -H "$AUTH" "$BASE/products/$PRODUCT" | jq '.data.stock.onHand'

# 2. Confirm — atomically deducts stock, writes ledger rows, updates the balance
curl -s -H "$AUTH" -X POST "$BASE/challans/$CHALLAN/confirm" \
  -H 'Content-Type: application/json' -d '{}' | jq '.data.status'

curl -s -H "$AUTH" "$BASE/products/$PRODUCT" | jq '.data.stock.onHand'   # now 5 lower

# 3. Cancel — returns the stock and reverses the balance
curl -s -H "$AUTH" -X POST "$BASE/challans/$CHALLAN/cancel" \
  -H 'Content-Type: application/json' \
  -d '{"reason":"Customer revised the order"}' | jq '.data.status'

curl -s -H "$AUTH" "$BASE/products/$PRODUCT" | jq '.data.stock.onHand'   # back to the original

# 4. The ledger explains both movements
curl -s -H "$AUTH" "$BASE/stock-movements?referenceId=$CHALLAN" \
  | jq '.data[] | {reason, movementType, quantity, quantityBefore, quantityAfter}'
```

### Over-selling

```bash
# A draft may exceed stock — drafts are proposals.
OVER=$(curl -s -H "$AUTH" -H 'Content-Type: application/json' \
  -X POST "$BASE/challans" -d "{
    \"customerId\": \"$CUSTOMER\",
    \"items\": [{\"productId\": \"$PRODUCT\", \"quantity\": 999999}]
  }" | jq -r '.data.id')

# Confirming it does not.
curl -s -H "$AUTH" -X POST "$BASE/challans/$OVER/confirm" \
  -H 'Content-Type: application/json' -d '{}' | jq '.error'
# {
#   "code": "INSUFFICIENT_STOCK",
#   "details": { "shortages": [ { "sku": "...", "requested": 999999, "available": 140 } ] }
# }

# And nothing was written — the transaction rolled back:
curl -s -H "$AUTH" "$BASE/challans/$OVER" | jq '.data.status'   # "DRAFT"
```

---

## 3. Postman / Newman

Import both files from `docs/postman/`:

- `Mini-ERP-CRM.postman_collection.json`
- `Local.postman_environment.json`

The collection is self-driving: the login request captures the access token into
a collection variable, and each create request stores its new id, so folders can
be run top to bottom without editing anything.

Run headlessly:

```bash
npm install -g newman

newman run docs/postman/Mini-ERP-CRM.postman_collection.json \
  -e docs/postman/Local.postman_environment.json \
  --reporters cli,json --reporter-json-export newman-report.json
```

Run one folder:

```bash
newman run docs/postman/Mini-ERP-CRM.postman_collection.json \
  -e docs/postman/Local.postman_environment.json \
  --folder "Business Rules"
```

---

## What the suite proves

Beyond "the endpoints respond", the assertions verify the properties that
distinguish this from a CRUD scaffold:

| Area | Asserted behaviour |
|---|---|
| Envelope | Every response — success or failure — has the same shape and carries `X-Request-Id` |
| Pagination | `meta` is complete; `?limit=100000` is clamped to 100 rather than honoured |
| Serialisation | `Decimal` columns arrive as JSON numbers, not `{"s":1,"e":3,…}` objects |
| Auth | Password hashes never appear in a response; wrong-password and unknown-account are indistinguishable |
| RBAC | SALES is refused challan confirmation and stock adjustment, and the 403 names the accepted roles |
| Drafts | A draft can be created that exceeds available stock, and creating it moves nothing |
| Confirmation | Deducts stock, stamps who/when, and flips the document to immutable |
| Over-sell | Rejected with a per-SKU `shortages` array, and the challan is verified still `DRAFT` afterwards — proving the rollback was complete |
| State machine | Double-confirm returns `INVALID_STATE_TRANSITION`; editing a confirmed document is refused |
| Cancellation | Requires a reason; a cancelled confirmed challan returns its stock, and both ledger rows are present |
| Ledger | Every row carries `quantityBefore`/`quantityAfter`, and `quantityAfter` is never negative |
| Audit | No secret ever reaches an audit payload |

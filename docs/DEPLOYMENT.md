# Deployment guide

Target topology:

```
   Browser
      │
      ├──────────────► Vercel        (static SPA, global CDN)
      │                   │
      │                   │ XHR, withCredentials
      │                   ▼
      └──────────────► Render        (Node API)
                          │
                          ▼
                        Neon         (serverless PostgreSQL)
```

- [1. Database — Neon](#1-database--neon)
- [2. Backend — Render](#2-backend--render)
- [3. Frontend — Vercel](#3-frontend--vercel)
- [4. Post-deployment checks](#4-post-deployment-checks)
- [Troubleshooting](#troubleshooting)
- [Docker alternative](#docker-alternative)

---

## 1. Database — Neon

1. Create a project at [neon.tech](https://neon.tech) and a database named
   `mini_erp`.
2. Copy the **pooled** connection string from the dashboard. It looks like:

   ```
   postgresql://USER:PASSWORD@ep-xxx-pooler.region.aws.neon.tech/mini_erp?sslmode=require
   ```

   `sslmode=require` is mandatory — Neon refuses unencrypted connections.

### Pooled vs direct connection

Neon offers both. Use them for different things:

| Connection | Use for | Why |
|---|---|---|
| **Pooled** (`-pooler` in the host) | `DATABASE_URL` at runtime | Render's free tier sleeps and wakes; PgBouncer absorbs the reconnect storm |
| **Direct** (no `-pooler`) | Running migrations | `prisma migrate deploy` uses advisory locks and DDL, which PgBouncer's transaction mode does not support |

If migrations hang or fail with a prepared-statement error, you are running them
through the pooler. Run them against the direct URL:

```bash
DATABASE_URL="postgresql://…@ep-xxx.region.aws.neon.tech/mini_erp?sslmode=require" \
  npx prisma migrate deploy
```

---

## 2. Backend — Render

### Option A: Blueprint (recommended)

The repository contains `render.yaml`. In Render: **New → Blueprint**, point it
at the repo, and it provisions the service with the build, pre-deploy and start
commands already set.

### Option B: manual

**New → Web Service**, then:

| Setting | Value |
|---|---|
| Root directory | `backend` |
| Runtime | Node |
| Build command | `npm ci && npx prisma generate && npm run build` |
| Pre-deploy command | `npx prisma migrate deploy` |
| Start command | `node dist/server.js` |
| Health check path | `/health` |

Setting migrations as a **pre-deploy** command rather than running them at boot
matters: a failed migration then aborts the release instead of crash-looping a
live instance.

### Environment variables

Generate the secrets first:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"   # run twice
```

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `PORT` | `4000` |
| `API_PREFIX` | `/api/v1` |
| `DATABASE_URL` | The Neon **pooled** string |
| `JWT_ACCESS_SECRET` | 96-char hex (first run above) |
| `JWT_REFRESH_SECRET` | 96-char hex (**second** run — must differ) |
| `JWT_ACCESS_EXPIRES_IN` | `15m` |
| `JWT_REFRESH_EXPIRES_IN` | `7d` |
| `BCRYPT_SALT_ROUNDS` | `12` |
| `CORS_ORIGINS` | Your exact Vercel origin, e.g. `https://mini-erp-crm.vercel.app` |
| `RATE_LIMIT_WINDOW_MS` | `900000` |
| `RATE_LIMIT_MAX` | `300` |
| `AUTH_RATE_LIMIT_MAX` | `10` |
| `LOG_LEVEL` | `info` |
| `SEED_ADMIN_EMAIL` | Your admin address |
| `SEED_ADMIN_PASSWORD` | A strong password |

> **`CORS_ORIGINS` must match the deployed origin exactly** — scheme included,
> no trailing slash. A mismatch here is the single most common cause of "it works
> locally but the browser blocks it in production".

The environment is validated by Zod at boot. If anything is missing or malformed
the process exits immediately with a readable report in the deploy log, rather
than failing under load later.

### Seed the database (once)

From the Render **Shell** tab:

```bash
npm run db:seed
```

The seed is idempotent — re-running it will not duplicate anything.

---

## 3. Frontend — Vercel

**Add New → Project**, import the repo, then:

| Setting | Value |
|---|---|
| Framework preset | Vite |
| Root directory | `frontend` |
| Build command | `npm run build` |
| Output directory | `dist` |
| Install command | `npm ci` |

### Environment variable

| Variable | Value |
|---|---|
| `VITE_API_BASE_URL` | `https://<your-render-service>.onrender.com/api/v1` |

> **This is a BUILD-time variable.** Vite inlines it into the bundle, so changing
> it requires a **redeploy** — setting it and restarting will not take effect.
> Include the `/api/v1` suffix.

`vercel.json` in the repo already configures the SPA history fallback, immutable
caching for fingerprinted assets, no-cache for `index.html`, and security
headers.

### The chicken-and-egg between CORS and the API URL

The two services reference each other, so deploy in this order:

1. Deploy the API to Render with `CORS_ORIGINS` set to a placeholder.
2. Deploy the SPA to Vercel with `VITE_API_BASE_URL` pointing at the live API.
3. Copy the real Vercel URL back into Render's `CORS_ORIGINS` and redeploy the API.

### Cross-site cookies

In production the SPA and API are on different registrable domains, so the
refresh cookie is cross-site. The backend sets `SameSite=None; Secure` when
`NODE_ENV=production` — which requires HTTPS on both. Vercel and Render both
serve HTTPS by default, so this works out of the box; it will **not** work if you
put the API behind plain HTTP.

---

## 4. Post-deployment checks

```bash
API=https://<your-service>.onrender.com

# Liveness — does not touch the database
curl -s $API/health | jq

# Readiness — proves the database is reachable
curl -s $API/health/ready | jq
# { "status": "ready", "database": "connected" }

# Sign in
curl -s -X POST $API/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"YOUR_SEED_EMAIL","password":"YOUR_SEED_PASSWORD"}' | jq '.data.user'
```

Then in the browser:

1. Open the Vercel URL and sign in.
2. Confirm the dashboard renders with data (proves CORS + auth + DB).
3. Reload the page — you should stay signed in (proves the refresh cookie works
   cross-site).
4. Create a draft challan and confirm it (proves the transactional path).

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Browser console: "blocked by CORS policy" | `CORS_ORIGINS` does not match the Vercel origin | Compare character by character — scheme, no trailing slash |
| Login works, but reloading signs you out | Refresh cookie not being stored | Both origins must be HTTPS; check `NODE_ENV=production` on Render |
| Requests go to `/api/v1/...` on the Vercel domain | `VITE_API_BASE_URL` missing at build time | Set it and **redeploy** — it is compiled in, not read at runtime |
| Deploy fails: "Environment variable not found: DATABASE_URL" | Prisma needs it during `generate` | Ensure it is set for the build, not only at runtime |
| `prisma migrate deploy` hangs | Running through the Neon pooler | Use the direct (non-`-pooler`) URL for migrations |
| First request after idle takes ~30s | Render free tier cold start | Expected; upgrade the plan or accept it for a demo |
| 429 on login during a demo | `AUTH_RATE_LIMIT_MAX` is 10 per 15 min | Raise it temporarily, or wait out the window |
| Rate limits behave oddly across instances | In-memory store is per-instance | Switch to the Redis store (see Known Limitations) |

---

## Docker alternative

To run the whole stack anywhere Docker runs:

```bash
docker compose up -d --build
docker compose exec api npx prisma migrate deploy
docker compose exec api npm run db:seed
```

| Service | URL |
|---|---|
| SPA | http://localhost:5173 |
| API | http://localhost:4000/api/v1 |
| Docs | http://localhost:4000/api/v1/docs |
| Postgres | `localhost:5432` (`erp` / `erp_password`) |

Tear down, discarding the database volume:

```bash
docker compose down -v
```

The Compose file uses development secrets. Generate real ones before deploying
this configuration anywhere reachable.

# OB Inventory — Deployment Checklist

Use this checklist before deploying to production. Version: **1.1.0**

---

## Pre-deploy: Local verification

### 1. Code & build
- [ ] **Git status clean** — No uncommitted changes, or all changes committed
  ```bash
  git status
  ```
- [ ] **Full build succeeds**
  ```bash
  pnpm build
  ```
- [ ] **Docker images build** (API, Web, Worker)
  ```bash
  docker compose build
  ```

### 2. Database
- [ ] **Migrations up to date** — All migrations in `packages/db/src/migrations/` are committed
- [ ] **Production schema compared** (optional) — Run if you changed schema:
  ```bash
  pnpm db:compare-production dump
  pnpm db:compare-production check
  ```

### 3. Environment
- [ ] **`.env` exists** on target server (copy from `.env.example`, fill values)
- [ ] **Secrets are strong** — JWT, DB password, webhook secret, plugin API key
- [ ] **No placeholder values** — Replace `changeme`, `replace_with_*`, `yourdomain.com`

---

## Environment variables (production)

| Variable | Required | Notes |
|----------|----------|-------|
| `POSTGRES_PASSWORD` | ✅ | Strong password for DB |
| `DATABASE_URL` | ✅ | `postgresql://ob_user:PASSWORD@postgres:5432/ob_inventory` |
| `REDIS_URL` | ✅ | `redis://redis:6379` |
| `JWT_SECRET` | ✅ | 64-byte hex: `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"` |
| `JWT_REFRESH_SECRET` | ✅ | Different 64-byte hex |
| `WOO_WEBHOOK_SECRET` | ✅ | Same value in WooCommerce webhook settings |
| `WOO_PLUGIN_API_KEY` | ✅ | Same value in WordPress plugin settings |
| `DOMAIN` | ✅ | e.g. `activebrands.cloud` |
| `CADDY_EMAIL` | ✅ | For Let's Encrypt |
| `WOO_STORE_URL` | Optional | WooCommerce store URL |
| `WOO_API_KEY` | Optional | WooCommerce API key |
| `WOO_API_SECRET` | Optional | WooCommerce API secret |

---

## Deploy steps

### 1. Pull & build
```bash
cd /opt/ob-inventory
git pull origin main
docker compose build --no-cache
```

### 2. Run migrations (before starting API)
```bash
docker compose run --rm api node apps/api/dist/migrate.js
```

### 3. Start services
```bash
docker compose up -d
```

### 4. Verify
- [ ] **API health** — `curl https://YOUR_DOMAIN/api/health`
- [ ] **Web loads** — Open `https://YOUR_DOMAIN` in browser
- [ ] **Login works** — Sign in with admin credentials
- [ ] **Version shows v1.1.0** — Check sidebar logo
- [ ] **Worker running** — `docker compose logs worker` shows "Ready. N WooCommerce store(s) configured"

---

## Post-deploy

- [ ] **WooCommerce plugin** — Update plugin to 1.1.0 if needed
- [ ] **WooCommerce stores** — Verify store URLs and secret tokens in Settings
- [ ] **Backup** — Ensure DB backup is configured (e.g. pg_dump cron)

---

## Rollback

If deployment fails:
```bash
cd /opt/ob-inventory
git checkout PREVIOUS_COMMIT
docker compose build
docker compose up -d
```

Migrations are additive; rolling back code does not auto-rollback DB. Avoid dropping columns in migrations if rollback is likely.

---

## Quick reference

| Service | Port | Health |
|---------|------|--------|
| Postgres | 5432 | `pg_isready` |
| Redis | 6379 | `redis-cli ping` |
| API | 3000 | `GET /api/health` |
| Web | 80 | Served by nginx in container |
| Caddy | 80, 443 | Reverse proxy |

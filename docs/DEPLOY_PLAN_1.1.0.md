# OB Inventory v1.1.0 — Detailed Deploy Plan

**Target:** Production at `187.124.160.50` (activebrands.cloud)  
**App dir:** `/opt/ob-inventory`  
**⚠️ CRITICAL: Do not damage existing inventory data**

---

## Agent rules (do not deploy without these)

- **Never** run destructive migration 0008 without checking data first
- **Never** use `docker compose down` — it stops Postgres and Redis; use `stop` instead
- **Always** build before running migrations (migrations must use the new image)
- **Stop immediately** on migration failure — do not proceed
- **Do not overwrite** `.env` — preserve existing values
- **Verify** worker logs and health after deploy
- **Print** deployed commit SHA using `git rev-parse HEAD` after pull/reset
- **Treat** failed `curl -fSs https://activebrands.cloud/api/health` as deploy failure
- **Do not** perform rollback automatically unless explicitly instructed
- **If** any checkpoint output is unclear or non-numeric where numeric is expected, stop and report instead of guessing
- **Never** remove Docker volumes or database data (e.g. `docker compose down -v`, `docker volume rm`, dropping the DB) unless explicitly instructed for rollback/restore

---

## Phase 0: Pre-deploy (local)

### 0.1 Commit & push
```powershell
cd c:\Users\denis\Desktop\docker-projects\ob-inventory
git status                    # Should be clean
git push origin main          # Push all commits
```

### 0.2 Verify build locally
```powershell
pnpm build
```
All packages must build successfully.

---

## Phase 1: Backup production data (MANDATORY)

**Before any changes on the server**, create a backup.

### 1.1 SSH to production
```powershell
ssh root@187.124.160.50
```

### 1.2 Create backup directory on host
```bash
mkdir -p /root/backups/ob-inventory
```

### 1.3 Create database backup (container-safe path first)
```bash
cd /opt/ob-inventory
# pg_dump writes to a path inside the postgres container; /tmp is safe
docker compose exec -T postgres pg_dump -U ob_user -d ob_inventory -F c -f /tmp/ob_inventory_backup.dump
# Copy to host (host path may not be writable from inside container)
docker compose cp postgres:/tmp/ob_inventory_backup.dump /root/backups/ob-inventory/ob_inventory_$(date +%Y%m%d_%H%M%S).dump
# Housekeeping: remove temp dump from container
docker compose exec -T postgres rm -f /tmp/ob_inventory_backup.dump
```
**Fallback** if `docker compose cp` is unavailable: `docker cp $(docker compose ps -q postgres):/tmp/ob_inventory_backup.dump /root/backups/ob-inventory/ob_inventory_$(date +%Y%m%d_%H%M%S).dump`

### 1.4 Verify backup
```bash
ls -lh /root/backups/ob-inventory/ob_inventory_*.dump
```

### 1.5 (Recommended) Download backup locally
```powershell
# From your local machine:
scp root@187.124.160.50:/root/backups/ob-inventory/ob_inventory_*.dump ./backups/
```

---

## Phase 2: Migration 0008 — RED-ALERT CHECKPOINT

**⚠️ 0008 is destructive.** Do not proceed until this is verified.

### 2.1 Check products.box_number usage
```bash
ssh root@187.124.160.50 "cd /opt/ob-inventory && docker compose exec -T postgres psql -U ob_user -d ob_inventory -t -c \"SELECT COUNT(*) FROM products WHERE box_number IS NOT NULL AND box_number != '';\""
```

### 2.2 Decision
- **If the query result is not a clean numeric value** (e.g. weird whitespace, error, empty): **STOP** and report failure.
- **If count > 0:** **STOP.** Do not deploy. Report back. Decide whether to migrate data to `inventory_stock` first, or accept the loss (app uses `inventory_stock.box_number` only).
- **Only continue if count = 0.**

### 2.3 Other migrations (safe)
- **0004, 0005, 0006, 0007** — all use `IF NOT EXISTS`, idempotent, safe

---

## Phase 3: Deploy steps (on production server)

**Correct order:** pull → stop app only → build → migrate → start

### 3.1 SSH to production
```powershell
ssh root@187.124.160.50
```

### 3.2 Pull latest code (deterministic for deploy-only servers)
```bash
cd /opt/ob-inventory
git fetch origin
git checkout -B main origin/main
git reset --hard origin/main
git rev-parse HEAD            # Print deployed commit SHA (record this)
```
**Why checkout -B:** Creates `main` if it doesn't exist locally; avoids failure on fresh clones. **Why reset --hard:** Server should match `origin/main` exactly.

### 3.3 Stop app services only (keep Postgres and Redis running)
```bash
cd /opt/ob-inventory
docker compose stop web api worker caddy
```
**Do NOT use `docker compose down`** — that stops Postgres and Redis; migrations need Postgres.

### 3.4 Verify .env exists
```bash
test -f /opt/ob-inventory/.env && echo "OK" || echo "MISSING - create from .env.example"
```
If missing, copy from `.env.example` and fill values. **Do not overwrite** existing `.env` with defaults.

### 3.5 Build fresh images
```bash
cd /opt/ob-inventory
docker compose build
```
Use `--no-cache` only if you suspect stale layers.

### 3.6 Run migrations (using the newly built image)
```bash
cd /opt/ob-inventory
docker compose run --rm api node apps/api/dist/migrate.js
```
**Expected output:** `Running migrations from ...` then `Migrations complete.`  
**If migration command exits non-zero:** Stop immediately. Do not run `docker compose up -d`. Report failure. Only restore DB if migration partially modified the schema/data and the app cannot be recovered safely without restore.

### 3.6b Verify migration status (optional sanity check)
**Stop only if you are sure this table should exist.** Some setups use a different schema/table.

```bash
# Inspect drizzle schema tables first (optional)
docker compose exec -T postgres psql -U ob_user -d ob_inventory -c "\dt drizzle.*"

# If drizzle.__drizzle_migrations exists, query it (OB Inventory uses this)
docker compose exec -T postgres psql -U ob_user -d ob_inventory -c "SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 10;"
```
Should show 9 rows (0000–0008) after a fresh deploy. **Do not panic** if the table name differs — it may be a different migration setup.

### 3.7 Start all services
```bash
cd /opt/ob-inventory
docker compose up -d
```

### 3.8 Verify services
```bash
docker compose ps
```
All services should be `Up` or `running`.

---

## Phase 4: Post-deploy verification (hard checks)

**Treat failed health check as deploy failure.**

### 4.1 Check API and worker logs
```bash
docker compose logs api --tail 50
docker compose logs worker --tail 50
```
**Expected (worker):** `[worker] Redis connected` then `[worker] Ready. N WooCommerce store(s) configured for sync.`

### 4.2 API health (fail loudly)
```bash
curl -fSs https://activebrands.cloud/api/health && echo "API healthy"
```
**If this fails:** Treat as deploy failure. Do not consider deploy complete.

### 4.3 Web app
- Open https://activebrands.cloud
- Login with admin credentials
- **Check version:** Sidebar should show **v1.1.0**

### 4.4 Inventory data
- Open a warehouse, verify products and stock quantities are correct
- Check a few sales/transfers — data should be intact

---

## Rollback (the real parachute)

**Once destructive migrations are applied, code rollback alone is fake comfort.**

**Do not perform rollback automatically unless explicitly instructed.**

### Actual rollback
1. **Restore DB** from backup
2. **Redeploy old code**

```bash
cd /opt/ob-inventory
# Backup is on host; copy into container first (replace TIMESTAMP with your backup file)
docker compose cp /root/backups/ob-inventory/ob_inventory_TIMESTAMP.dump postgres:/tmp/restore.dump
docker compose exec -T postgres pg_restore -U ob_user -d ob_inventory -c /tmp/restore.dump
docker compose exec -T postgres rm -f /tmp/restore.dump

# Redeploy previous version
git checkout 5c08d54          # Previous known-good commit
docker compose build
docker compose up -d
```

---

## Summary checklist

| Step | Action | Safe? |
|------|--------|-------|
| 1 | Push to git | ✅ |
| 2 | Backup DB: pg_dump to /tmp, copy to `/root/backups/ob-inventory/` | ✅ **MANDATORY** |
| 3 | Check products.box_number — **STOP if count > 0** | ⚠️ **RED-ALERT** |
| 4 | `git fetch` + `checkout main` + `reset --hard origin/main` + `git rev-parse HEAD` | ✅ |
| 5 | `docker compose stop web api worker caddy` | ✅ (keeps Postgres/Redis) |
| 6 | `docker compose build` | ✅ |
| 7 | `docker compose run --rm api node apps/api/dist/migrate.js` | ✅ |
| 8 | `docker compose up -d` | ✅ |
| 9 | `docker compose logs api --tail 50` + `worker --tail 50` | ✅ |
| 10 | `curl -fSs https://activebrands.cloud/api/health` (failure = deploy failure) | ✅ |
| 11 | Verify version, inventory data | ✅ |

---

## Short corrected order (trusted)

```bash
cd /opt/ob-inventory
git fetch origin
git checkout -B main origin/main
git reset --hard origin/main
git rev-parse HEAD
docker compose stop web api worker caddy
docker compose build
docker compose run --rm api node apps/api/dist/migrate.js
# Optional: docker compose exec -T postgres psql -U ob_user -d ob_inventory -c "\dt drizzle.*"
# Optional: docker compose exec -T postgres psql -U ob_user -d ob_inventory -c "SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 10;"
docker compose up -d
docker compose ps
docker compose logs api --tail 50
docker compose logs worker --tail 50
curl -fSs https://activebrands.cloud/api/health && echo "API healthy"
```

---

## Contact / notes

- **Server:** 187.124.160.50 (root)
- **Domain:** activebrands.cloud
- **Repo:** https://github.com/ri5pekt/ob-inventory

# OB Inventory v1.2.0 — Detailed Deploy Plan

**Target:** Production at `187.124.160.50` (activebrands.cloud)  
**App dir:** `/opt/ob-inventory`  
**⚠️ CRITICAL: Do not damage existing inventory data**

---

## What's new in v1.2.0

| Area | Change |
|------|--------|
| **Sales module** | Full CRUD for direct / partner / WooCommerce sales — SalesView, CreateSaleModal, EditSaleModal, SaleDetailDialog |
| **Sale meta** | Sale Targets and Invoice Statuses — managed in Settings → Sales Meta tab |
| **Product pricing** | `cost_price` and `retail_price` columns on `products` |
| **Inventory table** | Cost and Retail price columns in warehouse StockTable |
| **CSV import** | Recognises "Cost Price" / "Retail Price" columns — non-destructive (blank cells never wipe existing prices) |
| **Auto-fill** | Retail price pre-filled when adding an item to a manual sale |
| **Migration 0009** | Creates `sale_targets`, `sale_invoice_statuses` tables; adds FK columns `target_id`, `invoice_status_id` to `sales` |
| **Migration 0010** | Adds `cost_price`, `retail_price` to `products` |

---

## Agent rules (do not deploy without these)

- **Never** use `docker compose down` — it stops Postgres and Redis; use `stop` instead
- **Always** build before running migrations (migrations must use the new image)
- **Stop immediately** on migration failure — do not proceed
- **Do not overwrite** `.env` — preserve existing values
- **Verify** worker logs and health after deploy
- **Print** deployed commit SHA using `git rev-parse HEAD` after pull/reset
- **Treat** failed `curl -fSs https://activebrands.cloud/api/health` as deploy failure
- **Do not** perform rollback automatically unless explicitly instructed
- **If** any checkpoint output is unclear or non-numeric where numeric is expected, stop and report instead of guessing
- **Never** remove Docker volumes or database data (e.g. `docker compose down -v`, `docker volume rm`, dropping the DB) unless explicitly instructed

---

## Phase 0: Pre-deploy (local)

### 0.1 Verify commit is pushed
```powershell
cd c:\Users\denis\Desktop\docker-projects\ob-inventory
git log --oneline -3   # Should show the v1.2.0 commit at the top
git status             # Should be clean
```

### 0.2 Verify build locally
```powershell
pnpm build
```
All packages must build successfully before touching production.

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

### 1.3 Create database backup
```bash
cd /opt/ob-inventory
docker compose exec -T postgres pg_dump -U ob_user -d ob_inventory -F c -f /tmp/ob_inventory_backup.dump
docker compose cp postgres:/tmp/ob_inventory_backup.dump /root/backups/ob-inventory/ob_inventory_$(date +%Y%m%d_%H%M%S).dump
docker compose exec -T postgres rm -f /tmp/ob_inventory_backup.dump
```
**Fallback** if `docker compose cp` is unavailable:
```bash
docker cp $(docker compose ps -q postgres):/tmp/ob_inventory_backup.dump /root/backups/ob-inventory/ob_inventory_$(date +%Y%m%d_%H%M%S).dump
docker compose exec -T postgres rm -f /tmp/ob_inventory_backup.dump
```

### 1.4 Verify backup
```bash
ls -lh /root/backups/ob-inventory/ob_inventory_*.dump
```
Must show a non-zero `.dump` file. **If missing or zero bytes — STOP.**

### 1.5 (Recommended) Download backup locally
```powershell
scp root@187.124.160.50:/root/backups/ob-inventory/ob_inventory_*.dump ./backups/
```

---

## Phase 2: Migration safety check

Both migrations for v1.2.0 are **additive only** — `IF NOT EXISTS` / new columns on existing tables with no data drops.

### 2.1 Confirm current migration count
```bash
ssh root@187.124.160.50 "cd /opt/ob-inventory && docker compose exec -T postgres psql -U ob_user -d ob_inventory -t -c \"SELECT COUNT(*) FROM drizzle.__drizzle_migrations;\""
```
- **Expected value before deploy:** `9` (migrations 0000–0008 applied)
- **If the query fails or returns unexpected output:** STOP and report — do not proceed

### 2.2 Confirm new tables do NOT yet exist (sanity check)
```bash
ssh root@187.124.160.50 "cd /opt/ob-inventory && docker compose exec -T postgres psql -U ob_user -d ob_inventory -t -c \"SELECT COUNT(*) FROM information_schema.tables WHERE table_name IN ('sale_targets','sale_invoice_statuses');\""
```
- **Expected: `0`** — tables don't exist yet (migrations not applied)
- **If `2`:** Migrations were already partially applied — check carefully before proceeding

---

## Phase 3: Deploy steps (on production server)

**Correct order:** pull → stop app only → build → migrate → start

### 3.1 SSH to production
```powershell
ssh root@187.124.160.50
```

### 3.2 Pull latest code
```bash
cd /opt/ob-inventory
git fetch origin
git checkout -B main origin/main
git reset --hard origin/main
git rev-parse HEAD            # Print and record the deployed commit SHA
```
Expected SHA: `2901b77` (or the latest commit on main).

### 3.3 Stop app services only (keep Postgres and Redis running)
```bash
cd /opt/ob-inventory
docker compose stop web api worker caddy
```
**Do NOT use `docker compose down`** — that stops Postgres and Redis.

### 3.4 Verify .env exists
```bash
test -f /opt/ob-inventory/.env && echo "OK" || echo "MISSING - create from .env.example"
```
If missing, copy from `.env.example` and fill values. **Do not overwrite** existing `.env`.

### 3.5 Build fresh images
```bash
cd /opt/ob-inventory
docker compose build
```

### 3.6 Run migrations
```bash
cd /opt/ob-inventory
docker compose run --rm api node apps/api/dist/migrate.js
```
**Expected output:** `Running migrations from ...` then `Migrations complete.`  
**If migration command exits non-zero:** Stop immediately. Do not run `docker compose up -d`. Report failure.

### 3.6b Verify migrations applied (optional sanity check)
```bash
docker compose exec -T postgres psql -U ob_user -d ob_inventory -c "SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 5;"
```
Should now show **11 rows** (0000–0010) with the two newest entries near the top.

```bash
# Also confirm the new tables exist
docker compose exec -T postgres psql -U ob_user -d ob_inventory -c "\dt sale_targets"
docker compose exec -T postgres psql -U ob_user -d ob_inventory -c "\dt sale_invoice_statuses"
# And the new columns on products
docker compose exec -T postgres psql -U ob_user -d ob_inventory -c "\d products" | grep -E "cost_price|retail_price"
```

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

### 4.3 Web app smoke test
- Open https://activebrands.cloud
- Login with admin credentials
- Navigate to **Sales** — the view must load with period stats
- Open a warehouse — **Cost** and **Retail** price columns should appear in the table
- Go to **Settings → Parameters → Sales Meta** tab — must exist and load

### 4.4 Inventory data integrity
- Open a warehouse, verify products and stock quantities are correct
- Check existing sales/transfers — data should be intact
- Try creating a new Direct Sale — retail price should auto-fill if set on the product

---

## Rollback

**Once migrations are applied, code rollback alone is not safe.**  
**Do not perform rollback automatically unless explicitly instructed.**

Migrations 0009 and 0010 are **additive** (new tables / new nullable columns), so a code rollback without DB restore is generally safe — the old code simply won't use the new columns. However, if data was written to `sale_targets` or `sale_invoice_statuses`, a full DB restore will lose that data.

### Full rollback (if needed)
```bash
cd /opt/ob-inventory
# Restore DB (replace TIMESTAMP with your backup file)
docker compose cp /root/backups/ob-inventory/ob_inventory_TIMESTAMP.dump postgres:/tmp/restore.dump
docker compose exec -T postgres pg_restore -U ob_user -d ob_inventory -c /tmp/restore.dump
docker compose exec -T postgres rm -f /tmp/restore.dump

# Redeploy previous version
git checkout 51896c8          # Previous known-good commit (last v1.1.0 commit)
docker compose build
docker compose up -d
```

---

## Summary checklist

| Step | Action | Safe? |
|------|--------|-------|
| 1 | Verify commit pushed — `git log --oneline -3` | ✅ |
| 2 | Backup DB: pg_dump → `/root/backups/ob-inventory/` | ✅ **MANDATORY** |
| 3 | Confirm migration count = 9 before deploy — **STOP if unexpected** | ⚠️ |
| 4 | `git fetch` + `checkout -B main origin/main` + `reset --hard` + `git rev-parse HEAD` | ✅ |
| 5 | `docker compose stop web api worker caddy` | ✅ (keeps Postgres/Redis) |
| 6 | `docker compose build` | ✅ |
| 7 | `docker compose run --rm api node apps/api/dist/migrate.js` | ✅ |
| 8 | Verify 11 migrations + new tables + new columns | ✅ |
| 9 | `docker compose up -d` | ✅ |
| 10 | `docker compose logs api --tail 50` + `worker --tail 50` | ✅ |
| 11 | `curl -fSs https://activebrands.cloud/api/health` — failure = deploy failure | ✅ |
| 12 | Smoke test: Sales view, StockTable prices, Settings Sales Meta tab | ✅ |

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
# Sanity check migrations:
# docker compose exec -T postgres psql -U ob_user -d ob_inventory -c "SELECT COUNT(*) FROM drizzle.__drizzle_migrations;"
# docker compose exec -T postgres psql -U ob_user -d ob_inventory -c "\dt sale_targets"
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
- **Commit:** `2901b77` (feat: v1.2.0)
- **Previous safe rollback commit:** `51896c8`

# OB Inventory v1.1.0 — Detailed Deploy Plan

**Target:** Production at `187.124.160.50` (activebrands.cloud)  
**App dir:** `/opt/ob-inventory`  
**⚠️ CRITICAL: Do not damage existing inventory data**

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

### 1.2 Create database backup
```bash
cd /opt/ob-inventory
docker compose exec -T postgres pg_dump -U ob_user -d ob_inventory -F c -f /tmp/ob_inventory_backup_$(date +%Y%m%d_%H%M%S).dump
```

### 1.3 Copy backup to safe location (optional)
```bash
# List backups
ls -la /tmp/ob_inventory_backup_*.dump

# Or copy to host (from your local machine):
# scp root@187.124.160.50:/tmp/ob_inventory_backup_*.dump ./backups/
```

### 1.4 Verify backup
```bash
# Quick check: backup file exists and has size
ls -lh /tmp/ob_inventory_backup_*.dump
```

---

## Phase 2: Check migration impact (data safety)

### 2.1 Migrations that will run
Production has **4 migrations** applied (0000–0003). These will run:
- **0004** — `ADD COLUMN IF NOT EXISTS customer_address` (sales) — safe, idempotent
- **0005** — `ADD COLUMN IF NOT EXISTS customer_phone` (sales) — safe, idempotent
- **0006** — `ADD COLUMN IF NOT EXISTS secret_token` (stores) — safe, idempotent
- **0007** — Adds columns to warehouses, inventory_stock, products, transfers, sales, sale_items — all use `IF NOT EXISTS`, safe
- **0008** — `DROP COLUMN IF EXISTS box_number` (products) — **⚠️ READ BELOW**

### 2.2 Migration 0008 — products.box_number
- **What it does:** Drops `products.box_number` (moved to `inventory_stock.box_number` per warehouse)
- **Data impact:** If production has values in `products.box_number`, they will be **lost**
- **Check before deploy:**
  ```bash
  ssh root@187.124.160.50 "docker compose -f /opt/ob-inventory/docker-compose.yml exec -T postgres psql -U ob_user -d ob_inventory -t -c \"SELECT COUNT(*) FROM products WHERE box_number IS NOT NULL AND box_number != '';\""
  ```
- **If count > 0:** Decide whether to migrate that data to `inventory_stock` first, or accept the loss (app uses `inventory_stock.box_number` only)
- **If count = 0:** Safe to run 0008

---

## Phase 3: Deploy steps (on production server)

### 3.1 SSH to production
```powershell
ssh root@187.124.160.50
```

### 3.2 Stop services (graceful)
```bash
cd /opt/ob-inventory
docker compose down
```
**Note:** This stops API, Worker, Web, Caddy. Postgres and Redis keep running (data preserved).

### 3.3 Pull latest code
```bash
cd /opt/ob-inventory
git fetch origin
git status                    # See current branch
git pull origin main
```

### 3.4 Verify .env exists
```bash
test -f /opt/ob-inventory/.env && echo "OK" || echo "MISSING - create from .env.example"
```
If missing, copy from `.env.example` and fill values. **Do not overwrite** existing `.env` with defaults.

### 3.5 Run migrations (BEFORE starting API)
```bash
cd /opt/ob-inventory
docker compose run --rm api node apps/api/dist/migrate.js
```
**Expected output:** `Running migrations from ...` then `Migrations complete.`  
**If it fails:** Do NOT start services. Restore from backup if needed.

### 3.6 Build Docker images
```bash
cd /opt/ob-inventory
docker compose build --no-cache
```
Builds: api, web, worker. Uses `.dockerignore` (no node_modules in context).

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

## Phase 4: Worker setup verification

### 4.1 Worker requirements
- **DATABASE_URL** — for reading stores, products, inventory
- **REDIS_URL** — for BullMQ queue (`sync-woo-stock`)

### 4.2 Check worker logs
```bash
docker compose logs worker --tail 50
```
**Expected:** `[worker] Redis connected` then `[worker] Ready. N WooCommerce store(s) configured for sync.`

### 4.3 Worker processes jobs from API
- API enqueues jobs when stock changes (warehouse products, transfers, etc.)
- Worker consumes `sync-woo-stock` queue and pushes stock to WooCommerce stores
- No extra config needed if stores are set in Settings → WooCommerce

---

## Phase 5: Post-deploy verification

### 5.1 API health
```bash
curl -s https://activebrands.cloud/api/health | head -5
```

### 5.2 Web app
- Open https://activebrands.cloud
- Login with admin credentials
- **Check version:** Sidebar should show **v1.1.0**

### 5.3 Inventory data
- Open a warehouse, verify products and stock quantities are correct
- Check a few sales/transfers — data should be intact

### 5.4 Worker
```bash
docker compose logs worker --tail 20
```
Should show "Ready" and no errors.

---

## Rollback (if something goes wrong)

### If migrations fail
```bash
cd /opt/ob-inventory
# Restore from backup (replace TIMESTAMP with your backup file)
docker compose exec -T postgres pg_restore -U ob_user -d ob_inventory -c /tmp/ob_inventory_backup_TIMESTAMP.dump
# Or: drop and recreate DB, then restore
```

### If app fails after deploy
```bash
cd /opt/ob-inventory
git checkout 5c08d54          # Previous known-good commit
docker compose build
docker compose up -d
```
**Note:** Migrations already applied cannot be "un-applied". Rollback only reverts code.

---

## Summary checklist

| Step | Action | Safe? |
|------|--------|-------|
| 1 | Push to git | ✅ |
| 2 | Backup DB | ✅ **MANDATORY** |
| 3 | Check products.box_number usage | ⚠️ Verify |
| 4 | `docker compose down` | ✅ |
| 5 | `git pull origin main` | ✅ |
| 6 | `docker compose run --rm api node apps/api/dist/migrate.js` | ✅ (after backup) |
| 7 | `docker compose build --no-cache` | ✅ |
| 8 | `docker compose up -d` | ✅ |
| 9 | Verify health, version, data | ✅ |

---

## Contact / notes

- **Server:** 187.124.160.50 (root)
- **Domain:** activebrands.cloud
- **Repo:** https://github.com/ri5pekt/ob-inventory

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

### 1.2 Create backup directory
```bash
mkdir -p /root/backups/ob-inventory
```

### 1.3 Create database backup
```bash
cd /opt/ob-inventory
docker compose exec -T postgres pg_dump -U ob_user -d ob_inventory -F c > /root/backups/ob-inventory/ob_inventory_$(date +%Y%m%d_%H%M%S).dump
```

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
- **If count > 0:** **STOP.** Do not deploy. Report back. Decide whether to migrate data to `inventory_stock` first, or accept the loss (app uses `inventory_stock.box_number` only).
- **If count = 0:** Safe to proceed with deploy.

### 2.3 Other migrations (safe)
- **0004, 0005, 0006, 0007** — all use `IF NOT EXISTS`, idempotent, safe

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
git status                    # See current branch
git pull origin main
```

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
**If it fails:** Do NOT start services. Restore from backup if needed.

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

## Phase 4: Post-deploy verification

### 4.1 API health (fail loudly)
```bash
curl -fSs https://activebrands.cloud/api/health
```

### 4.2 Check worker logs
```bash
docker compose logs worker --tail 50
```
**Expected:** `[worker] Redis connected` then `[worker] Ready. N WooCommerce store(s) configured for sync.`

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

### Actual rollback
1. **Restore DB** from backup
2. **Redeploy old code**

```bash
cd /opt/ob-inventory
# Restore from backup (replace TIMESTAMP with your backup file)
docker compose exec -T postgres pg_restore -U ob_user -d ob_inventory -c /root/backups/ob-inventory/ob_inventory_TIMESTAMP.dump

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
| 2 | Backup DB to `/root/backups/ob-inventory/` | ✅ **MANDATORY** |
| 3 | Check products.box_number — **STOP if count > 0** | ⚠️ **RED-ALERT** |
| 4 | `git pull origin main` | ✅ |
| 5 | `docker compose stop web api worker caddy` | ✅ (keeps Postgres/Redis) |
| 6 | `docker compose build` | ✅ |
| 7 | `docker compose run --rm api node apps/api/dist/migrate.js` | ✅ |
| 8 | `docker compose up -d` | ✅ |
| 9 | `curl -fSs https://activebrands.cloud/api/health` | ✅ |
| 10 | `docker compose logs worker --tail 50` | ✅ |
| 11 | Verify version, inventory data | ✅ |

---

## Short corrected order (trusted)

```bash
cd /opt/ob-inventory
git pull origin main
docker compose stop web api worker caddy
docker compose build
docker compose run --rm api node apps/api/dist/migrate.js
docker compose up -d
docker compose ps
curl -fSs https://activebrands.cloud/api/health
docker compose logs worker --tail 50
```

---

## Contact / notes

- **Server:** 187.124.160.50 (root)
- **Domain:** activebrands.cloud
- **Repo:** https://github.com/ri5pekt/ob-inventory

"""
Download production DB and restore it locally.
Wipes local data and replaces with prod data.
Clears store credentials so no accidental Woo syncs happen.
"""
import paramiko, subprocess, sys, os, time, tempfile

HOST     = "187.124.160.50"
USER     = "root"
PASSWORD = "ct3JzHM18F/4kpfL"

LOCAL_CONTAINER = "ob-inventory-postgres-1"
LOCAL_DB_USER   = "ob_user"
LOCAL_DB_NAME   = "ob_inventory"
LOCAL_DUMP      = os.path.join(tempfile.gettempdir(), "prod_dump.sql")

def ssh_run(client, cmd, check=True):
    _, stdout, stderr = client.exec_command(cmd)
    out = stdout.read().decode()
    err = stderr.read().decode()
    if check and err.strip():
        print(f"  STDERR: {err.strip()[:300]}")
    return out.strip()

def local_psql(sql):
    result = subprocess.run(
        ["docker", "exec", "-i", LOCAL_CONTAINER,
         "psql", "-U", LOCAL_DB_USER, "-d", LOCAL_DB_NAME, "-c", sql],
        capture_output=True, text=True
    )
    if result.returncode != 0:
        print(f"  PSQL error: {result.stderr.strip()[:300]}")
    return result

# ── 1. Connect to VPS ─────────────────────────────────────────────────────────
print("Connecting to VPS...")
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USER, password=PASSWORD, timeout=30)
print("Connected.\n")

# ── 2. Dump production DB ─────────────────────────────────────────────────────
print("Dumping production database...")
dump_path = "/tmp/prod_dump.sql"
ssh_run(client,
    f"docker exec ob-inventory-postgres-1 pg_dump -U ob_user --no-owner --no-acl ob_inventory > {dump_path}"
)
print(f"  Dump created at {dump_path} on VPS")

# ── 3. Download dump ──────────────────────────────────────────────────────────
print(f"Downloading dump to {LOCAL_DUMP}...")
sftp = client.open_sftp()
sftp.get(dump_path, LOCAL_DUMP)
sftp.close()
size_mb = os.path.getsize(LOCAL_DUMP) / 1024 / 1024
print(f"  Downloaded {size_mb:.1f} MB")

# Cleanup remote dump
ssh_run(client, f"rm -f {dump_path}")
client.close()
print()

# ── 4. Drop and recreate local DB ─────────────────────────────────────────────
print("Dropping and recreating local database...")
# Terminate all active connections first
subprocess.run(
    ["docker", "exec", LOCAL_CONTAINER,
     "psql", "-U", LOCAL_DB_USER, "-d", "postgres",
     "-c", f"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '{LOCAL_DB_NAME}' AND pid <> pg_backend_pid();"],
    check=False, capture_output=True
)
subprocess.run(
    ["docker", "exec", LOCAL_CONTAINER,
     "psql", "-U", LOCAL_DB_USER, "-d", "postgres",
     "-c", f"DROP DATABASE IF EXISTS {LOCAL_DB_NAME};"],
    check=True, capture_output=True
)
subprocess.run(
    ["docker", "exec", LOCAL_CONTAINER,
     "psql", "-U", LOCAL_DB_USER, "-d", "postgres",
     "-c", f"CREATE DATABASE {LOCAL_DB_NAME} OWNER {LOCAL_DB_USER};"],
    check=True, capture_output=True
)
print("  Database recreated")

# ── 5. Restore dump ───────────────────────────────────────────────────────────
print("Restoring dump (this may take a moment)...")
with open(LOCAL_DUMP, "rb") as f:
    result = subprocess.run(
        ["docker", "exec", "-i", LOCAL_CONTAINER,
         "psql", "-U", LOCAL_DB_USER, "-d", LOCAL_DB_NAME,
         "--quiet", "--set=ON_ERROR_STOP=0"],
        stdin=f, capture_output=True, text=True
    )
# Only print actual errors, not notices
errors = [l for l in result.stderr.splitlines() if "ERROR" in l and "already exists" not in l]
if errors:
    print("  Warnings:")
    for e in errors[:10]:
        print(f"    {e}")
print("  Restore complete")

# ── 6. Run migration 0017 if needed ───────────────────────────────────────────
print("\nChecking migration 0017...")
check = local_psql("SELECT to_regclass('public.user_warehouses');")
if "user_warehouses" not in check.stdout:
    print("  Applying migration 0017...")
    local_psql("ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'warehouse_admin';")
    time.sleep(1)  # enum value must commit before use
    local_psql("""
        UPDATE users SET role = 'warehouse_admin' WHERE role = 'staff';
        CREATE TABLE IF NOT EXISTS user_warehouses (
            user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            warehouse_id uuid NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
            PRIMARY KEY (user_id, warehouse_id)
        );
    """)
    print("  Migration 0017 applied")
else:
    print("  Already up to date")

# ── 7. Clear WooCommerce store credentials ────────────────────────────────────
print("\nClearing WooCommerce store credentials (prevent accidental syncs)...")
local_psql("UPDATE stores SET secret_token = NULL, url = NULL WHERE platform = 'woocommerce';")
count = local_psql("SELECT COUNT(*) FROM stores WHERE platform = 'woocommerce';")
print(f"  Cleared Woo credentials for {count.stdout.strip()} store(s)")

# ── 8. Reset local admin password ────────────────────────────────────────────
print("\nChecking local admin account...")
check = local_psql("SELECT id FROM users WHERE email = 'denisb9@gmail.com';")
if "0 rows" in check.stdout or not check.stdout.strip():
    print("  denisb9@gmail.com not found — skipping (use the prod admin credentials)")
else:
    print("  denisb9@gmail.com found in prod data (log in with your prod password)")

print("\nDone! Local DB is now a copy of production.")
print("   WooCommerce sync is disabled (credentials cleared).")
print("   Restart your local API server to pick up the new data.")

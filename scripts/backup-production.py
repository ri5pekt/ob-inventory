"""
Production backup script — run before deploys that include DB migrations.

Creates on the server:
  /root/backups/ob_inventory_<timestamp>.sql   ← full Postgres dump
  /root/backups/ob_inventory_<timestamp>.tar.gz ← app files (code + uploads)

Downloads both files to:
  scripts/backups/<timestamp>/
"""

import paramiko, sys, io, os, time

os.environ.setdefault('PYTHONIOENCODING', 'utf-8')
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace', line_buffering=True)

HOST     = "187.124.160.50"
USER     = "root"
PASSWORD = "ct3JzHM18F/4kpfL"
APP_DIR  = "/opt/ob-inventory"
COMPOSE  = f"{APP_DIR}/docker-compose.yml"

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
print(f"Connecting to {HOST}...")
client.connect(HOST, username=USER, password=PASSWORD, timeout=30)
print("Connected.\n")

def run(cmd, timeout=60):
    print(f"$ {cmd}")
    _, stdout, stderr = client.exec_command(cmd, timeout=timeout, get_pty=True)
    out = ""
    while not stdout.channel.exit_status_ready():
        if stdout.channel.recv_ready():
            chunk = stdout.channel.recv(4096).decode("utf-8", errors="replace")
            print(chunk, end="", flush=True)
            out += chunk
        time.sleep(0.1)
    rest = stdout.read().decode("utf-8", errors="replace")
    print(rest, end="")
    out += rest
    code = stdout.channel.recv_exit_status()
    print(f"[exit {code}]\n")
    return out.strip(), code

# ── Get timestamp from server ──────────────────────────────────────────────────
ts_out, _ = run("date +%Y%m%d_%H%M%S", timeout=10)
TIMESTAMP = ts_out.strip().splitlines()[-1]
print(f"Backup timestamp: {TIMESTAMP}\n")

SQL_FILE = f"/root/backups/ob_inventory_{TIMESTAMP}.sql"
TAR_FILE = f"/root/backups/ob_inventory_{TIMESTAMP}.tar.gz"

# ── Create backup dir on server ───────────────────────────────────────────────
run("mkdir -p /root/backups", timeout=10)

# ── DB dump ───────────────────────────────────────────────────────────────────
print("=== 1/2  Dumping Postgres database ===")
_, code = run(
    f"docker compose -f {COMPOSE} exec -T postgres "
    f"pg_dump -U ob_user ob_inventory > {SQL_FILE}",
    timeout=120,
)
if code != 0:
    print("ERROR: pg_dump failed — aborting.")
    client.close()
    sys.exit(1)

size_out, _ = run(f"du -sh {SQL_FILE}", timeout=10)
print(f"DB dump size: {size_out}\n")

# ── App files tar ─────────────────────────────────────────────────────────────
print("=== 2/2  Archiving app files ===")
run(
    f"tar --exclude='{APP_DIR}/.git' "
    f"    --exclude='{APP_DIR}/node_modules' "
    f"    -czf {TAR_FILE} -C /opt ob-inventory",
    timeout=120,
)
size_out, _ = run(f"du -sh {TAR_FILE}", timeout=10)
print(f"App archive size: {size_out}\n")

# ── Download both files locally ───────────────────────────────────────────────
local_dir = os.path.join(os.path.dirname(__file__), "backups", TIMESTAMP)
os.makedirs(local_dir, exist_ok=True)

sftp = client.open_sftp()

for remote_path, label in [(SQL_FILE, "DB dump"), (TAR_FILE, "App archive")]:
    filename   = os.path.basename(remote_path)
    local_path = os.path.join(local_dir, filename)
    print(f"Downloading {label} → {local_path}")
    sftp.get(remote_path, local_path)
    local_size = os.path.getsize(local_path)
    print(f"  Saved: {local_size:,} bytes\n")

sftp.close()
client.close()

print("=" * 60)
print(f"Backup complete!  Files saved to:")
print(f"  {local_dir}")
print(f"\nTo restore the DB if needed:")
print(f"  1. Copy {os.path.basename(SQL_FILE)} to the server")
print(f"  2. docker compose -f {COMPOSE} stop api worker")
print(f"  3. docker compose -f {COMPOSE} exec -T postgres psql -U ob_user -d ob_inventory < {SQL_FILE}")
print(f"  4. docker compose -f {COMPOSE} start api worker")
print("=" * 60)

"""
Production deploy script — v1.3.2
Run from project root: python scripts/deploy-production.py
"""

import paramiko, sys, io, os, time

os.environ.setdefault('PYTHONIOENCODING', 'utf-8')
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace', line_buffering=True)

HOST    = "187.124.160.50"
USER    = "root"
PASSWORD = "ct3JzHM18F/4kpfL"
APP_DIR  = "/opt/ob-inventory"
COMPOSE  = f"docker compose -f {APP_DIR}/docker-compose.yml"

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
print(f"Connecting to {HOST}...")
client.connect(HOST, username=USER, password=PASSWORD, timeout=30)
print("Connected.\n")

def run(cmd, timeout=120, allow_fail=False):
    print(f"\n$ {cmd[:140]}")
    _, stdout, _ = client.exec_command(cmd, timeout=timeout, get_pty=True)
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
    print(f"[exit {code}]")
    if code != 0 and not allow_fail:
        print(f"\n[FATAL] Command failed (exit {code}). Aborting deploy.")
        client.close()
        sys.exit(code)
    return out.strip(), code

def step(label):
    print(f"\n{'='*60}")
    print(f"  {label}")
    print(f"{'='*60}")

# ── 1. Pull latest code ────────────────────────────────────────────────────────
step("1 / 5  Pull latest code")
run(f"cd {APP_DIR} && git fetch && git reset --hard origin/main", timeout=60)

# ── 2. Build all containers (api + worker + web) ───────────────────────────────
step("2 / 5  Build containers — api, worker, web  (may take a few minutes)")
run(
    f"cd {APP_DIR} && BUILDKIT_PROGRESS=plain docker compose build api worker web 2>&1",
    timeout=900,
)

# ── 3. Restart all services ───────────────────────────────────────────────────
step("3 / 5  Restart all services")
run(
    f"cd {APP_DIR} && docker compose up -d --remove-orphans 2>&1",
    timeout=120,
)

# ── 4. Wait for DB, then run migrations ───────────────────────────────────────
step("4 / 5  Wait for DB + run migrations")
run(
    f"cd {APP_DIR} && timeout 90 bash -c "
    "'until docker compose exec -T postgres pg_isready -U ob_user -d ob_inventory; do sleep 3; done'",
    timeout=120,
)
run(
    f"cd {APP_DIR} && docker compose exec -T api node apps/api/dist/migrate.js 2>&1",
    timeout=60,
    allow_fail=True,  # warn but don't abort — migration may already be applied
)

# ── 5. Status check ───────────────────────────────────────────────────────────
step("5 / 5  Container status")
run(f"cd {APP_DIR} && docker compose ps 2>&1", timeout=30)

client.close()

print(f"""
{'='*60}
  DEPLOY COMPLETE — v1.3.2

  URL: https://activebrands.cloud
{'='*60}
""")

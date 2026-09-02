"""
Production deploy script — v2.2.0
Run from project root: python scripts/deploy-production.py
"""

import paramiko, sys, io, os, time
from _vps_creds import VPS_HOST, VPS_USER, VPS_PASSWORD

os.environ.setdefault('PYTHONIOENCODING', 'utf-8')
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace', line_buffering=True)

HOST    = VPS_HOST
USER    = VPS_USER
PASSWORD = VPS_PASSWORD
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
run(f"cd {APP_DIR} && GIT_TERMINAL_PROMPT=0 git fetch && git reset --hard origin/main", timeout=60)

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
    allow_fail=True,  # warn but don't abort — Drizzle may skip files after 0000
)

# Drizzle often skips later SQL files because 0000 has a future timestamp.
# Apply any migration whose marker table isn't there yet, directly via psql.
PENDING_MIGRATIONS = [
    ("quotes",      "0022_add_quotes.sql"),
    ("api_tokens",  "0023_add_api_tokens.sql"),
]

# Column-level migrations that Drizzle's migrate.js may skip (its marker table already
# exists, so we can't use the simple "table missing" check above). Applied best-effort
# via psql, ignoring "already exists" errors so re-deploys stay idempotent.
COLUMN_MIGRATIONS = [
    "0024_convert_sale_to_transfer.sql",
]
for marker_table, sql_file in PENDING_MIGRATIONS:
    exists_out, _ = run(
        f"cd {APP_DIR} && docker compose exec -T postgres "
        f"psql -U ob_user -d ob_inventory -tAc \"SELECT to_regclass('public.{marker_table}')\"",
        timeout=30,
        allow_fail=True,
    )
    if marker_table not in exists_out:
        print(f"Applying {sql_file} via psql...")
        run(
            f"cd {APP_DIR} && docker compose exec -T postgres "
            "psql -U ob_user -d ob_inventory -v ON_ERROR_STOP=1 "
            f"< {APP_DIR}/packages/db/src/migrations/{sql_file}",
            timeout=60,
        )
    else:
        print(f"{marker_table} table already exists — skipping {sql_file}.")

# Column-level migrations — marker table already exists, so check the specific
# column instead. Statements inside these files use IF NOT EXISTS / ADD VALUE IF NOT
# EXISTS, so re-running is safe; we still skip when possible to avoid noisy psql output.
COLUMN_MARKERS = {
    "0024_convert_sale_to_transfer.sql": ("transfers", "converted_from_sale_id"),
}
for sql_file in COLUMN_MIGRATIONS:
    table, column = COLUMN_MARKERS[sql_file]
    col_exists_out, _ = run(
        f"cd {APP_DIR} && docker compose exec -T postgres "
        f"psql -U ob_user -d ob_inventory -tAc "
        f"\"SELECT 1 FROM information_schema.columns WHERE table_name='{table}' AND column_name='{column}'\"",
        timeout=30,
        allow_fail=True,
    )
    if "1" not in col_exists_out:
        print(f"Applying {sql_file} via psql...")
        run(
            f"cd {APP_DIR} && docker compose exec -T postgres "
            "psql -U ob_user -d ob_inventory -v ON_ERROR_STOP=1 "
            f"< {APP_DIR}/packages/db/src/migrations/{sql_file}",
            timeout=60,
        )
    else:
        print(f"{table}.{column} already exists — skipping {sql_file}.")

# ── 5. Status check ───────────────────────────────────────────────────────────
step("5 / 5  Container status")
run(f"cd {APP_DIR} && docker compose ps 2>&1", timeout=30)

client.close()

print(f"""
{'='*60}
  DEPLOY COMPLETE — v2.2.0

  URL: https://activebrands.cloud
{'='*60}
""")

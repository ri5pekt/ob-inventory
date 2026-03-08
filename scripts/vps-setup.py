"""
VPS setup script -- connects via SSH and bootstraps the production environment.
Run from the project root: python scripts/vps-setup.py
"""

import paramiko
import time
import secrets
import sys
import os
import io

# Force UTF-8 output so remote Unicode chars don't crash on Windows cp1252
os.environ.setdefault('PYTHONIOENCODING', 'utf-8')
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace', line_buffering=True)
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace', line_buffering=True)

HOST     = "187.124.160.50"
USER     = "root"
PASSWORD = "ct3JzHM18F/4kpfL"
REPO_URL = "https://github.com/ri5pekt/ob-inventory.git"
APP_DIR  = "/opt/ob-inventory"
DOMAIN   = "activebrands.cloud"

# Generate strong secrets for production
DB_PASS       = secrets.token_urlsafe(24)
JWT_SECRET    = secrets.token_hex(64)
JWT_REFRESH   = secrets.token_hex(64)
WH_SECRET     = secrets.token_urlsafe(32)
PLUGIN_KEY    = secrets.token_urlsafe(32)

ENV_CONTENT = f"""# Database
POSTGRES_DB=ob_inventory
POSTGRES_USER=ob_user
POSTGRES_PASSWORD={DB_PASS}

DATABASE_URL=postgresql://ob_user:{DB_PASS}@postgres:5432/ob_inventory

# Redis
REDIS_URL=redis://redis:6379

# JWT
JWT_SECRET={JWT_SECRET}
JWT_REFRESH_SECRET={JWT_REFRESH}
JWT_ACCESS_EXPIRES_IN=90d
JWT_REFRESH_EXPIRES_IN=365d

# WooCommerce
WOO_STORE_URL=
WOO_API_KEY=
WOO_API_SECRET=
WOO_WEBHOOK_SECRET={WH_SECRET}
WOO_PLUGIN_API_KEY={PLUGIN_KEY}

# Server
NODE_ENV=production
API_PORT=3000
WEB_PORT=80

# Caddy
DOMAIN={DOMAIN}
CADDY_EMAIL=admin@{DOMAIN}
"""

def run(client, cmd, timeout=120):
    print(f"\n$ {cmd[:120]}")
    _, stdout, stderr = client.exec_command(cmd, timeout=timeout, get_pty=True)
    out = ""
    while not stdout.channel.exit_status_ready():
        if stdout.channel.recv_ready():
            chunk = stdout.channel.recv(4096).decode("utf-8", errors="replace")
            print(chunk, end="", flush=True)
            out += chunk
        time.sleep(0.2)
    remaining = stdout.read().decode("utf-8", errors="replace")
    print(remaining, end="", flush=True)
    out += remaining
    exit_code = stdout.channel.recv_exit_status()
    if exit_code != 0:
        err = stderr.read().decode("utf-8", errors="replace")
        if err.strip():
            print(f"[STDERR] {err}")
    return exit_code, out

def step(label):
    print(f"\n{'='*60}")
    print(f"  STEP: {label}")
    print(f"{'='*60}")

def main():
    print(f"Connecting to {HOST}...")
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USER, password=PASSWORD, timeout=30)
    print("Connected.\n")

    # 1 -- Docker already installed from previous run, just verify
    step("Check Docker")
    run(client, "docker --version && docker compose version", timeout=15)

    # 2 -- Enable Docker
    step("Enable Docker")
    run(client, "systemctl enable --now docker", timeout=30)

    # 3 -- Pull latest code
    step("Pull latest code")
    run(client,
        f"cd {APP_DIR} && git fetch && git reset --hard origin/main",
        timeout=60)

    # 4 -- Write .env (only if it doesn't exist to preserve existing secrets)
    step("Write .env")
    code, out = run(client, f"test -f {APP_DIR}/.env && echo EXISTS || echo MISSING", timeout=10)
    if "MISSING" in out:
        sftp = client.open_sftp()
        with sftp.file(f"{APP_DIR}/.env", "w") as f:
            f.write(ENV_CONTENT)
        sftp.close()
        print(".env written with fresh secrets.")
    else:
        print(".env already exists, keeping existing secrets.")

    # 5 -- Build and start containers
    step("Build & start containers (this takes a while...)")
    code, _ = run(client,
        f"cd {APP_DIR} && BUILDKIT_PROGRESS=plain docker compose up -d --build 2>&1",
        timeout=900)
    if code != 0:
        print("[FAILED] docker compose up failed.")
        client.close(); sys.exit(1)

    # 6 -- Wait for DB
    step("Wait for DB to be healthy")
    run(client,
        f"cd {APP_DIR} && timeout 90 bash -c "
        "'until docker compose exec -T postgres pg_isready -U ob_user -d ob_inventory; do sleep 3; done'",
        timeout=120)

    # 7 -- Run migrations
    step("Run DB migrations")
    code, _ = run(client,
        f"cd {APP_DIR} && docker compose exec -T api node apps/api/dist/migrate.js",
        timeout=60)
    if code != 0:
        print("[WARN] Migration step returned non-zero. Check output above.")

    # 8 -- Seed
    step("Seed admin user + default store")
    run(client,
        f"cd {APP_DIR} && docker compose exec -T api node apps/api/dist/seed.js",
        timeout=60)

    # 9 -- Status
    step("Container status")
    run(client, f"cd {APP_DIR} && docker compose ps")

    client.close()

    print(f"""
{'='*60}
  DEPLOYMENT COMPLETE

  URL:      https://{DOMAIN}
  Login:    admin@local / admin123

  DB password (save this!):
  {DB_PASS}
{'='*60}
""")

if __name__ == "__main__":
    main()

"""
VPS setup script — connects via SSH and bootstraps the production environment.
Run from the project root: python scripts/vps-setup.py
"""

import paramiko
import time
import secrets
import sys

HOST     = "187.124.160.50"
USER     = "root"
PASSWORD = "ct3JzHM18F/4kpfL"
REPO_URL = "https://github.com/ri5pekt/ob-inventory.git"
APP_DIR  = "/opt/ob-inventory"
DOMAIN   = "activebrands.cloud"

# ── Generate strong secrets for production ───────────────────────────────────
DB_PASS       = secrets.token_urlsafe(24)
JWT_SECRET    = secrets.token_hex(64)
JWT_REFRESH   = secrets.token_hex(64)
WH_SECRET     = secrets.token_urlsafe(32)
PLUGIN_KEY    = secrets.token_urlsafe(32)

ENV_CONTENT = f"""# ── Database ──────────────────────────────────────────────
POSTGRES_DB=ob_inventory
POSTGRES_USER=ob_user
POSTGRES_PASSWORD={DB_PASS}

DATABASE_URL=postgresql://ob_user:{DB_PASS}@postgres:5432/ob_inventory

# ── Redis ─────────────────────────────────────────────────
REDIS_URL=redis://redis:6379

# ── JWT ───────────────────────────────────────────────────
JWT_SECRET={JWT_SECRET}
JWT_REFRESH_SECRET={JWT_REFRESH}
JWT_ACCESS_EXPIRES_IN=90d
JWT_REFRESH_EXPIRES_IN=365d

# ── WooCommerce ───────────────────────────────────────────
WOO_STORE_URL=
WOO_API_KEY=
WOO_API_SECRET=
WOO_WEBHOOK_SECRET={WH_SECRET}
WOO_PLUGIN_API_KEY={PLUGIN_KEY}

# ── Server ────────────────────────────────────────────────
NODE_ENV=production
API_PORT=3000
WEB_PORT=80

# ── Caddy ─────────────────────────────────────────────────
DOMAIN={DOMAIN}
CADDY_EMAIL=admin@{DOMAIN}
"""

def run(client, cmd, timeout=120):
    print(f"\n$ {cmd}")
    stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout, get_pty=True)
    out = ""
    while not stdout.channel.exit_status_ready():
        if stdout.channel.recv_ready():
            chunk = stdout.channel.recv(4096).decode("utf-8", errors="replace")
            print(chunk, end="", flush=True)
            out += chunk
        time.sleep(0.2)
    # drain remaining
    remaining = stdout.read().decode("utf-8", errors="replace")
    print(remaining, end="", flush=True)
    out += remaining
    exit_code = stdout.channel.recv_exit_status()
    if exit_code != 0:
        err = stderr.read().decode("utf-8", errors="replace")
        print(f"[STDERR] {err}")
    return exit_code, out

def main():
    print(f"Connecting to {HOST}...")
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USER, password=PASSWORD, timeout=30)
    print("Connected.\n")

    steps = [
        # 1 – Update packages
        ("Update apt", "apt-get update -qq"),

        # 2 – Install Docker
        ("Install Docker", (
            "apt-get install -y -qq ca-certificates curl gnupg lsb-release && "
            "install -m 0755 -d /etc/apt/keyrings && "
            "curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg --yes && "
            "chmod a+r /etc/apt/keyrings/docker.gpg && "
            'echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] '
            'https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" > /etc/apt/sources.list.d/docker.list && '
            "apt-get update -qq && "
            "apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin"
        )),

        # 3 – Enable Docker
        ("Enable Docker", "systemctl enable --now docker"),

        # 4 – Clone repo
        ("Clone repo", f"git clone {REPO_URL} {APP_DIR} || (cd {APP_DIR} && git pull)"),
    ]

    for label, cmd in steps:
        print(f"\n{'─'*60}")
        print(f"  STEP: {label}")
        print(f"{'─'*60}")
        code, _ = run(client, cmd, timeout=300)
        if code != 0:
            print(f"\n[FAILED] Step '{label}' exited with code {code}. Aborting.")
            client.close()
            sys.exit(1)

    # 5 – Write .env
    print(f"\n{'─'*60}")
    print("  STEP: Write .env")
    print(f"{'─'*60}")
    sftp = client.open_sftp()
    with sftp.file(f"{APP_DIR}/.env", "w") as f:
        f.write(ENV_CONTENT)
    sftp.close()
    print(".env written.")

    # 6 – Build and start containers
    post_steps = [
        ("Build & start containers", f"cd {APP_DIR} && docker compose up -d --build 2>&1"),
        ("Wait for DB to be healthy",
         f"cd {APP_DIR} && timeout 90 bash -c "
         "'until docker compose exec -T postgres pg_isready -U ob_user -d ob_inventory; do sleep 3; done'"),
        ("Run DB migrations",
         f"cd {APP_DIR} && docker compose exec -T api node apps/api/dist/migrate.js"),
        ("Seed admin user + default store",
         f"cd {APP_DIR} && docker compose exec -T api node apps/api/dist/seed.js"),
    ]

    for label, cmd in post_steps:
        print(f"\n{'─'*60}")
        print(f"  STEP: {label}")
        print(f"{'─'*60}")
        run(client, cmd, timeout=600)

    # 7 – Status check
    print(f"\n{'─'*60}")
    print("  STEP: Container status")
    print(f"{'─'*60}")
    run(client, f"cd {APP_DIR} && docker compose ps")

    client.close()
    print(f"""
{'═'*60}
  DONE!

  App URL:  https://{DOMAIN}
  Login:    admin@local / admin123

  DB password (save this!): {DB_PASS}
{'═'*60}
""")

if __name__ == "__main__":
    main()

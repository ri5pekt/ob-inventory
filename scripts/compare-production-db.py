#!/usr/bin/env python3
"""
Compare production DB schema with local schema.
SSH to production, dump schema, save locally, then run drizzle-kit generate
against production (via tunnel) to create any needed migrations.

Usage:
  # 1. Dump production schema (requires SSH access)
  python scripts/compare-production-db.py dump

  # 2. Generate migrations against production (requires tunnel + password)
  #    First start tunnel: ssh -L 15432:localhost:5432 root@PRODUCTION_HOST -N
  #    Then: PRODUCTION_DATABASE_URL=postgresql://ob_user:PASSWORD@localhost:15432/ob_inventory pnpm db:generate
"""
import os
import sys
import subprocess

# Optional: load from .env.production or similar
SSH_HOST = os.environ.get("PRODUCTION_SSH_HOST", "187.124.160.50")
SSH_USER = os.environ.get("PRODUCTION_SSH_USER", "root")
SCHEMA_OUT = "scripts/production-schema.sql"


def run_ssh(cmd: str, timeout: int = 60) -> str:
    """Run command on production via SSH."""
    full_cmd = [
        "ssh",
        "-o", "StrictHostKeyChecking=no",
        "-o", "ConnectTimeout=15",
        "-o", "BatchMode=no",
        f"{SSH_USER}@{SSH_HOST}",
        cmd,
    ]
    try:
        result = subprocess.run(
            full_cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        if result.returncode != 0:
            print(f"SSH command failed (exit {result.returncode}):", file=sys.stderr)
            print(result.stderr, file=sys.stderr)
            sys.exit(1)
        return result.stdout
    except FileNotFoundError:
        print("Error: 'ssh' not found. Install OpenSSH or use WSL.", file=sys.stderr)
        sys.exit(1)
    except subprocess.TimeoutExpired:
        print("Error: SSH command timed out.", file=sys.stderr)
        sys.exit(1)


def cmd_dump():
    """Dump production schema to local file."""
    print(f"Dumping schema from {SSH_USER}@{SSH_HOST}...")
    cmd = (
        "docker compose -f /opt/ob-inventory/docker-compose.yml exec -T postgres "
        "pg_dump -U ob_user -d ob_inventory --schema-only --no-owner 2>/dev/null"
    )
    out = run_ssh(cmd, timeout=30)
    with open(SCHEMA_OUT, "w", encoding="utf-8") as f:
        f.write(out)
    print(f"Saved to {SCHEMA_OUT}")
    print(f"Schema has {len(out.splitlines())} lines.")


def cmd_check_migrations():
    """Check which migrations have been applied on production."""
    print(f"Checking migrations on {SSH_USER}@{SSH_HOST}...")
    cmd = (
        "docker compose -f /opt/ob-inventory/docker-compose.yml exec -T postgres "
        "psql -U ob_user -d ob_inventory -t -c "
        "\"SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at;\" 2>/dev/null || "
        "echo 'Table drizzle.__drizzle_migrations not found'"
    )
    out = run_ssh(cmd, timeout=15)
    print(out or "(no migrations table)")


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(0)
    sub = sys.argv[1].lower()
    if sub == "dump":
        cmd_dump()
    elif sub == "check":
        cmd_check_migrations()
    else:
        print(f"Unknown command: {sub}")
        print("Use: dump | check")
        sys.exit(1)


if __name__ == "__main__":
    main()

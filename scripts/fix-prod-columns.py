"""
Emergency fix: add sale_date and transfer_date columns directly to production DB.
Run from project root: python scripts/fix-prod-columns.py
"""
import paramiko, sys, io, os, time
from _vps_creds import VPS_HOST, VPS_USER, VPS_PASSWORD

os.environ.setdefault('PYTHONIOENCODING', 'utf-8')
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace', line_buffering=True)

HOST     = VPS_HOST
USER     = VPS_USER
PASSWORD = VPS_PASSWORD
COMPOSE  = "docker compose -f /opt/ob-inventory/docker-compose.yml"

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
print(f"Connecting to {HOST}...")
client.connect(HOST, username=USER, password=PASSWORD, timeout=30)
print("Connected.\n")

def psql(sql, label=""):
    cmd = f'docker compose -f /opt/ob-inventory/docker-compose.yml exec -T postgres psql -U ob_user -d ob_inventory -c "{sql}"'
    print(f"\n>>> {label or sql}")
    _, stdout, _ = client.exec_command(cmd, timeout=30, get_pty=True)
    out = stdout.read().decode("utf-8", errors="replace")
    print(out.strip())
    code = stdout.channel.recv_exit_status()
    print(f"[exit {code}]")
    if code != 0:
        print("[FATAL] Aborting.")
        client.close()
        sys.exit(code)
    return out

# sales.sale_date
psql("ALTER TABLE sales ADD COLUMN IF NOT EXISTS sale_date timestamp with time zone DEFAULT now();",
     "Add sale_date to sales")
psql("UPDATE sales SET sale_date = created_at WHERE sale_date IS NULL;",
     "Backfill sale_date from created_at")
psql("ALTER TABLE sales ALTER COLUMN sale_date SET NOT NULL;",
     "Set sale_date NOT NULL")

# transfers.transfer_date
psql("ALTER TABLE transfers ADD COLUMN IF NOT EXISTS transfer_date timestamp with time zone DEFAULT now();",
     "Add transfer_date to transfers")
psql("UPDATE transfers SET transfer_date = created_at WHERE transfer_date IS NULL;",
     "Backfill transfer_date from created_at")
psql("ALTER TABLE transfers ALTER COLUMN transfer_date SET NOT NULL;",
     "Set transfer_date NOT NULL")

# Verify
psql("SELECT column_name, data_type FROM information_schema.columns WHERE table_name IN ('sales','transfers') AND column_name IN ('sale_date','transfer_date') ORDER BY table_name, column_name;",
     "Verify columns exist")

client.close()
print("\nDone — columns applied successfully.")

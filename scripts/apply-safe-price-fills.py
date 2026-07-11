"""
Apply the 537 "safe" price fills from scripts/analysis/safe_updates.csv to production.

Safe = every existing price within the product family already agreed, so we're
only filling genuinely blank cost_price/retail_price cells (never overwriting
an existing value). Each UPDATE carries an `IS NULL` guard for defense in depth.

Run from project root: python scripts/apply-safe-price-fills.py
"""
import os
import paramiko
import pandas as pd
from _vps_creds import VPS_HOST, VPS_USER, VPS_PASSWORD

APP_DIR = "/opt/ob-inventory"
COMPOSE = f"docker compose -f {APP_DIR}/docker-compose.yml"
DIR = os.path.join(os.path.dirname(__file__), "analysis")


def main():
    safe = pd.read_csv(os.path.join(DIR, "safe_updates.csv"), dtype=str)
    full = pd.read_csv(os.path.join(DIR, "products_full_after.csv"), dtype=str)
    sku_to_id = dict(zip(full["sku"], full["id"]))

    stmts = ["BEGIN;"]
    n_cost, n_retail, missing = 0, 0, []
    for _, row in safe.iterrows():
        pid = sku_to_id.get(row["sku"])
        if not pid:
            missing.append(row["sku"])
            continue
        if row["old_cost"] == "-" and row["new_cost"] != "-":
            stmts.append(f"UPDATE products SET cost_price = {row['new_cost']} WHERE id = '{pid}' AND cost_price IS NULL;")
            n_cost += 1
        if row["old_retail"] == "-" and row["new_retail"] != "-":
            stmts.append(f"UPDATE products SET retail_price = {row['new_retail']} WHERE id = '{pid}' AND retail_price IS NULL;")
            n_retail += 1
    stmts.append("COMMIT;")

    if missing:
        print(f"WARNING: {len(missing)} SKUs not found: {missing}")

    print(f"Rows in safe_updates.csv: {len(safe)}")
    print(f"cost_price fills: {n_cost}, retail_price fills: {n_retail}")
    print(f"Total UPDATE statements: {len(stmts) - 2}")

    sql = "\n".join(stmts)
    local_sql_path = os.path.join(DIR, "_apply_safe_price_fills.sql")
    with open(local_sql_path, "w", encoding="utf-8") as f:
        f.write(sql)
    print(f"Wrote SQL to {local_sql_path}")

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    print(f"\nConnecting to {VPS_HOST}...")
    client.connect(VPS_HOST, username=VPS_USER, password=VPS_PASSWORD, timeout=30)
    print("Connected.\n")

    remote_tmp = "/tmp/apply_safe_price_fills.sql"
    sftp = client.open_sftp()
    sftp.put(local_sql_path, remote_tmp)
    sftp.close()
    client.exec_command(f"docker cp {remote_tmp} $({COMPOSE} ps -q postgres):{remote_tmp}", timeout=30)[1].read()

    print("Applying (single transaction)...")
    cmd = f"{COMPOSE} exec -T postgres psql -U ob_user -d ob_inventory -v ON_ERROR_STOP=1 -f {remote_tmp}"
    _, stdout, stderr = client.exec_command(cmd, timeout=120)
    out = stdout.read().decode("utf-8", errors="replace")
    err = stderr.read().decode("utf-8", errors="replace")
    exit_code = stdout.channel.recv_exit_status()

    update_lines = [l for l in out.splitlines() if l.startswith("UPDATE")]
    zero_updates = [l for l in update_lines if l.strip() == "UPDATE 0"]
    print(f"UPDATE statements executed: {len(update_lines)}")
    print(f"'UPDATE 0' (guard blocked, unexpected): {len(zero_updates)}")
    if err.strip():
        print(f"STDERR: {err.strip()}")
    print(f"[exit {exit_code}]")

    client.exec_command(f"rm -f {remote_tmp}")
    client.close()


if __name__ == "__main__":
    main()

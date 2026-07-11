"""
Apply scripts/analysis/text_to_option_safe.csv to PRODUCTION: convert
free-text attribute rows (option_id IS NULL) into proper linked options,
ONLY where the existing value_text is empty or already matches the label
we intend to set. Single transaction, extra guard re-checked in the SQL
itself (not just trusting the precomputed CSV).
"""
import os
import paramiko
import pandas as pd
from _vps_creds import VPS_HOST, VPS_USER, VPS_PASSWORD

APP_DIR = "/opt/ob-inventory"
COMPOSE = f"docker compose -f {APP_DIR}/docker-compose.yml"
DIR = os.path.join(os.path.dirname(__file__), "analysis")

FIELD_TO_DEFINITION = {"model": "Model", "unit": "Unit", "size": "Size", "color": "Color"}


def esc(s):
    return str(s).replace("'", "''")


def main():
    safe = pd.read_csv(os.path.join(DIR, "text_to_option_safe.csv"), dtype=str)
    full = pd.read_csv(os.path.join(DIR, "products_full_after.csv"), dtype=str)
    opts = pd.read_csv(os.path.join(DIR, "attribute_options.csv"), dtype=str)
    def_ids = opts.groupby("definition")["definition_id"].first().to_dict()
    sku_to_id = dict(zip(full["sku"], full["id"]))

    stmts = ["BEGIN;"]
    counts = {}
    for _, row in safe.iterrows():
        pid = sku_to_id.get(row["sku"])
        if not pid:
            continue
        def_id = def_ids[FIELD_TO_DEFINITION[row["field"]]]
        option_id = row["new_option_id"]
        label = esc(row["new_value"])
        stmts.append(
            "UPDATE product_attributes SET option_id = '{oid}', value_text = NULL "
            "WHERE product_id = '{pid}' AND definition_id = '{did}' AND option_id IS NULL "
            "AND (value_text IS NULL OR trim(lower(value_text)) = trim(lower('{label}')));".format(
                oid=option_id, pid=pid, did=def_id, label=label
            )
        )
        counts[row["field"]] = counts.get(row["field"], 0) + 1
    stmts.append("COMMIT;")

    print("Statements to apply:")
    for f, c in counts.items():
        print(f"  {f}: {c}")

    sql = "\n".join(stmts)
    local_sql_path = os.path.join(DIR, "_apply_text_to_option_fixes.sql")
    with open(local_sql_path, "w", encoding="utf-8") as f:
        f.write(sql)
    print(f"\nWrote {len(stmts)} statements to {local_sql_path}")

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    print(f"\nConnecting to {VPS_HOST}...")
    client.connect(VPS_HOST, username=VPS_USER, password=VPS_PASSWORD, timeout=30)
    print("Connected.\n")

    remote_tmp = "/tmp/apply_text_to_option_fixes.sql"
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
    update_counts = {}
    for l in update_lines:
        n = l.split()[1]
        update_counts[n] = update_counts.get(n, 0) + 1
    print(f"UPDATE result breakdown: {update_counts}  (total statements: {len(update_lines)})")
    if err.strip():
        print(f"STDERR: {err.strip()}")
    print(f"[exit {exit_code}]")

    client.exec_command(f"rm -f {remote_tmp}")
    client.close()


if __name__ == "__main__":
    main()

"""
Apply the confident attribute fixes from scripts/analysis/attribute_fixes.csv
to PRODUCTION. Only touches rows still NULL/untagged (IS NULL guard / ON
CONFLICT DO NOTHING), wrapped in a single transaction — all-or-nothing.

Does NOT touch anything in scripts/analysis/attribute_needs_review.csv.

Run from project root: python scripts/apply-attribute-fixes.py
"""
import os
import paramiko
import pandas as pd
from _vps_creds import VPS_HOST, VPS_USER, VPS_PASSWORD

APP_DIR = "/opt/ob-inventory"
COMPOSE = f"docker compose -f {APP_DIR}/docker-compose.yml"
DIR = os.path.join(os.path.dirname(__file__), "analysis")

FIELD_TO_DEFINITION = {"model": "Model", "unit": "Unit", "size": "Size", "color": "Color"}
FIELD_TO_COLUMN = {"brand": "brand_id", "category": "category_id"}


def build_sql():
    fixes = pd.read_csv(os.path.join(DIR, "attribute_fixes.csv"), dtype=str)
    full = pd.read_csv(os.path.join(DIR, "products_full.csv"), dtype=str)
    opts = pd.read_csv(os.path.join(DIR, "attribute_options.csv"), dtype=str)

    def_ids = opts.groupby("definition")["definition_id"].first().to_dict()

    sku_to_id = dict(zip(full["sku"], full["id"]))

    stmts = ["BEGIN;"]
    counts = {}
    skipped_no_id = 0
    for _, row in fixes.iterrows():
        pid = sku_to_id.get(row["sku"])
        if not pid:
            skipped_no_id += 1
            continue
        field = row["field"]
        option_id = row["new_option_id"]
        if field in FIELD_TO_COLUMN:
            col = FIELD_TO_COLUMN[field]
            stmts.append(
                f"UPDATE products SET {col} = '{option_id}' WHERE id = '{pid}' AND {col} IS NULL;"
            )
        elif field in FIELD_TO_DEFINITION:
            def_id = def_ids[FIELD_TO_DEFINITION[field]]
            stmts.append(
                "INSERT INTO product_attributes (product_id, definition_id, option_id) "
                f"VALUES ('{pid}', '{def_id}', '{option_id}') "
                "ON CONFLICT (product_id, definition_id) DO NOTHING;"
            )
        else:
            continue
        counts[field] = counts.get(field, 0) + 1
    stmts.append("COMMIT;")

    print("Statements to apply:")
    for f, c in counts.items():
        print(f"  {f}: {c}")
    if skipped_no_id:
        print(f"  (skipped {skipped_no_id} rows — sku not found in products_full.csv)")

    return "\n".join(stmts)


def main():
    sql = build_sql()
    local_sql_path = os.path.join(DIR, "_apply_attribute_fixes.sql")
    with open(local_sql_path, "w", encoding="utf-8") as f:
        f.write(sql)
    print(f"\nWrote SQL to {local_sql_path} ({len(sql.splitlines())} lines)")

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    print(f"\nConnecting to {VPS_HOST}...")
    client.connect(VPS_HOST, username=VPS_USER, password=VPS_PASSWORD, timeout=30)
    print("Connected.\n")

    remote_tmp = "/tmp/apply_attribute_fixes.sql"
    sftp = client.open_sftp()
    sftp.put(local_sql_path, remote_tmp)
    sftp.close()
    print(f"Uploaded to {remote_tmp} on VPS")

    container_path = "/tmp/apply_attribute_fixes.sql"
    _, stdout, stderr = client.exec_command(
        f"docker cp {remote_tmp} $({COMPOSE} ps -q postgres):{container_path}", timeout=30
    )
    stdout.read()
    err = stderr.read().decode("utf-8", errors="replace")
    if err.strip():
        print(f"docker cp stderr: {err.strip()[:300]}")

    print("\nApplying SQL inside postgres container (single transaction)...")
    cmd = f"{COMPOSE} exec -T postgres psql -U ob_user -d ob_inventory -v ON_ERROR_STOP=1 -f {container_path}"
    _, stdout, stderr = client.exec_command(cmd, timeout=120)
    out = stdout.read().decode("utf-8", errors="replace")
    err = stderr.read().decode("utf-8", errors="replace")
    exit_code = stdout.channel.recv_exit_status()
    print(out)
    if err.strip():
        print(f"STDERR: {err.strip()}")
    print(f"[exit {exit_code}]")

    if exit_code == 0:
        print("\nSuccess — transaction committed.")
    else:
        print("\nFAILED — transaction should have rolled back automatically (ON_ERROR_STOP + no explicit commit reached).")

    client.exec_command(f"rm -f {remote_tmp}")
    client.close()


if __name__ == "__main__":
    main()

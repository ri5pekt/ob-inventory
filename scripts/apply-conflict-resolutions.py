"""
Apply store-owner-confirmed price resolutions for the 4 conflicting families
that were NOT skipped (BBTD, GROINFABRIC, SJ were left alone per instructions).

Sets an exact cost/retail for every SKU in each resolved family — this both
corrects the one/two wrong values AND fills every remaining blank. Idempotent:
safe to re-run, only actually changes rows that differ from the target.

Run from project root: python scripts/apply-conflict-resolutions.py
"""
import os
import paramiko
import pandas as pd
from _vps_creds import VPS_HOST, VPS_USER, VPS_PASSWORD

APP_DIR = "/opt/ob-inventory"
COMPOSE = f"docker compose -f {APP_DIR}/docker-compose.yml"
DIR = os.path.join(os.path.dirname(__file__), "analysis")

RESOLUTIONS = {
    "BGBL01": {
        "cost": "270.00", "retail": "395.00",
        "skus": [
            "BGBL01-BKBU-10", "BGBL01-BKBU-12", "BGBL01-BKBU-14", "BGBL01-BKBU-16", "BGBL01-BKBU-8",
            "BGBL01-BKRD-10", "BGBL01-BKRD-12", "BGBL01-BKRD-14", "BGBL01-BKRD-16", "BGBL01-BKRD-8",
            "BGBL01-BKWH-10", "BGBL01-BKWH-12", "BGBL01-BKWH-14", "BGBL01-BKWH-16", "BGBL01-BKWH-8",
            "BGBL01-WHBK-12",
            "BGBL01-WHBU-10", "BGBL01-WHBU-12", "BGBL01-WHBU-14", "BGBL01-WHBU-16", "BGBL01-WHBU-8",
        ],
    },
    "BGSA": {
        "cost": "270.00", "retail": "395.00",
        "skus": [
            "BGSA-BK-10", "BGSA-BK-12", "BGSA-BK-14", "BGSA-BK-16", "BGSA-BK-18", "BGSA-BK-8",
            "BGSA-BKBUWH-10", "BGSA-BKBUWH-12", "BGSA-BKBUWH-14", "BGSA-BKBUWH-16", "BGSA-BKBUWH-8",
            "BGSA-BU-10", "BGSA-BU-12", "BGSA-BU-14", "BGSA-BU-16", "BGSA-BU-8",
            "BGSA-RD-10", "BGSA-RD-12", "BGSA-RD-14", "BGSA-RD-16", "BGSA-RD-8",
            "BGSA-RDBKBK-10", "BGSA-RDBKBK-12", "BGSA-RDBKBK-14", "BGSA-RDBKBK-16", "BGSA-RDBKBK-8",
            "BGSA-WH-10", "BGSA-WH-12", "BGSA-WH-14", "BGSA-WH-16", "BGSA-WH-18", "BGSA-WH-8",
            "BGSA-WHBKBK-10", "BGSA-WHBKBK-12", "BGSA-WHBKBK-14", "BGSA-WHBKBK-16", "BGSA-WHBKBK-8",
            "BGSA-WHBKRD-10", "BGSA-WHBKRD-12", "BGSA-WHBKRD-14", "BGSA-WHBKRD-16", "BGSA-WHBKRD-8",
            "BGSA-WHBUBK-10", "BGSA-WHBUBK-12", "BGSA-WHBUBK-14", "BGSA-WHBUBK-16", "BGSA-WHBUBK-8",
            "BGSA-WHPKPK-10", "BGSA-WHPKPK-12", "BGSA-WHPKPK-14", "BGSA-WHPKPK-16", "BGSA-WHPKPK-8",
            "BGSA-WHRDBK-10", "BGSA-WHRDBK-12", "BGSA-WHRDBK-14", "BGSA-WHRDBK-16", "BGSA-WHRDBK-8",
            "BGSA-WHYWBK-10", "BGSA-WHYWBK-12", "BGSA-WHYWBK-14", "BGSA-WHYWBK-16", "BGSA-WHYWBK-8",
            "BGSA-YWBKBK-10", "BGSA-YWBKBK-12", "BGSA-YWBKBK-14", "BGSA-YWBKBK-16", "BGSA-YWBKBK-8",
            "BGSA-YWWHWH-10", "BGSA-YWWHWH-12", "BGSA-YWWHWH-14", "BGSA-YWWHWH-16", "BGSA-YWWHWH-8",
        ],
    },
    "GI": {
        "cost": "230.00", "retail": "275.00",
        "skus": [
            "GI-BK-A0", "GI-BK-A1", "GI-BK-A2", "GI-BK-A3", "GI-BK-A4",
            "GI-GY-A0", "GI-GY-A1", "GI-GY-A2", "GI-GY-A3", "GI-GY-A4",
            "GI-WH-A0", "GI-WH-A1", "GI-WH-A3", "GI-WH-A4",
        ],
    },
    "SGCLASSIC": {
        "cost": "185.00", "retail": "295.00",
        "skus": [
            "SGCLASSIC-BK-L", "SGCLASSIC-BK-M", "SGCLASSIC-BK-S", "SGCLASSIC-BK-XL",
            "SGCLASSIC-BU-L", "SGCLASSIC-BU-M", "SGCLASSIC-BU-S", "SGCLASSIC-BU-XL",
            "SGCLASSIC-LBU-L", "SGCLASSIC-LBU-M", "SGCLASSIC-LBU-S", "SGCLASSIC-LBU-XL",
            "SGCLASSIC-MAROON-L", "SGCLASSIC-MAROON-M", "SGCLASSIC-MAROON-XL",
            "SGCLASSIC-PR-L", "SGCLASSIC-PR-M", "SGCLASSIC-PR-S", "SGCLASSIC-PR-XL",
            "SGCLASSIC-RD-L", "SGCLASSIC-RD-M", "SGCLASSIC-RD-S", "SGCLASSIC-RD-XL",
            "SGCLASSIC-TEAL-L", "SGCLASSIC-TEAL-M", "SGCLASSIC-TEAL-S", "SGCLASSIC-TEAL-XL",
            "SGCLASSIC-WH-L", "SGCLASSIC-WH-M", "SGCLASSIC-WH-S", "SGCLASSIC-WH-XL",
        ],
    },
}


def main():
    full = pd.read_csv(os.path.join(DIR, "products_full_after.csv"), dtype=str)
    sku_to_id = dict(zip(full["sku"], full["id"]))

    stmts = ["BEGIN;"]
    total = 0
    missing_skus = []
    for family, res in RESOLUTIONS.items():
        for sku in res["skus"]:
            pid = sku_to_id.get(sku)
            if not pid:
                missing_skus.append(sku)
                continue
            stmts.append(
                f"UPDATE products SET cost_price = {res['cost']}, retail_price = {res['retail']} "
                f"WHERE id = '{pid}';"
            )
            total += 1
    stmts.append("COMMIT;")

    if missing_skus:
        print(f"WARNING: {len(missing_skus)} SKUs not found: {missing_skus}")

    print(f"Statements to apply: {total} across {len(RESOLUTIONS)} families")
    for fam, res in RESOLUTIONS.items():
        print(f"  {fam}: {len(res['skus'])} SKUs -> cost={res['cost']}, retail={res['retail']}")

    sql = "\n".join(stmts)
    local_sql_path = os.path.join(DIR, "_apply_conflict_resolutions.sql")
    with open(local_sql_path, "w", encoding="utf-8") as f:
        f.write(sql)
    print(f"\nWrote {len(stmts)} statements to {local_sql_path}")

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    print(f"\nConnecting to {VPS_HOST}...")
    client.connect(VPS_HOST, username=VPS_USER, password=VPS_PASSWORD, timeout=30)
    print("Connected.\n")

    remote_tmp = "/tmp/apply_conflict_resolutions.sql"
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
    print(f"UPDATE statements executed: {len(update_lines)}")
    non_one = [l for l in update_lines if l.strip() != "UPDATE 1"]
    if non_one:
        print(f"Unexpected results (not 'UPDATE 1'): {non_one}")
    if err.strip():
        print(f"STDERR: {err.strip()}")
    print(f"[exit {exit_code}]")

    client.exec_command(f"rm -f {remote_tmp}")
    client.close()


if __name__ == "__main__":
    main()

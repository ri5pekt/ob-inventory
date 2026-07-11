"""
Backfill customers.id_number from historical Cardcom documents.

Cardcom stores the ID/company number (ת.ז. / ח.פ.) entered when creating an
invoice as `Comp_ID` on each document (queried via Documents/GetReport). We
never persisted that value locally — this script recovers it from Cardcom's
own records and fills in any BLANK customers.id_number, matched by email.
Never overwrites an existing id_number. Read-only against Cardcom; only
writes to our own `customers` table on production.

Run from project root: python scripts/backfill-customer-id-numbers.py
"""
import os
import sys
import io
import requests
import paramiko
from pathlib import Path
from _vps_creds import VPS_HOST, VPS_USER, VPS_PASSWORD

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

APP_DIR = "/opt/ob-inventory"
COMPOSE = f"docker compose -f {APP_DIR}/docker-compose.yml"

ROOT = Path(__file__).resolve().parent.parent


def _load_dotenv():
    env_path = ROOT / ".env"
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        os.environ.setdefault(k.strip(), v.strip())


_load_dotenv()
API_NAME     = os.environ["CARDCOM_API_NAME"]
API_PASSWORD = os.environ["CARDCOM_API_PASSWORD"]


def fetch_cardcom_documents():
    resp = requests.post(
        "https://secure.cardcom.solutions/api/v11/Documents/GetReport",
        json={
            "ApiName": API_NAME,
            "ApiPassword": API_PASSWORD,
            "FromDateYYYYMMDD": "20240801",  # terminal launched Aug 2024
            "ToDateYYYYMMDD": "20261231",
            "DocType": -2,
            "PageNumber": 1,
        },
        timeout=60,
    )
    data = resp.json()
    if data.get("ResponseCode") != 0:
        raise RuntimeError(f"Cardcom GetReport failed: {data.get('Description')}")
    return data.get("Documents") or []


def esc(s):
    return str(s).replace("'", "''")


def main():
    docs = fetch_cardcom_documents()
    print(f"Fetched {len(docs)} Cardcom documents (Aug 2024 - present)")

    # email -> {id_number, name, doc_count}
    by_email: dict[str, dict] = {}
    conflicts = []
    for d in docs:
        email = (d.get("Email") or "").strip().lower()
        comp_id = (d.get("Comp_ID") or "").strip()
        if not email or not comp_id:
            continue
        if email in by_email and by_email[email]["id_number"] != comp_id:
            conflicts.append((email, by_email[email]["id_number"], comp_id))
            continue
        by_email[email] = {
            "id_number": comp_id,
            "name": d.get("Cust_Name"),
        }

    print(f"Distinct emails with a Comp_ID: {len(by_email)}")
    if conflicts:
        print(f"WARNING: {len(conflicts)} emails had conflicting Comp_ID values across documents — skipped:")
        for c in conflicts:
            print(f"  {c}")

    if not by_email:
        print("Nothing to backfill.")
        return

    # Match against production customers (blank id_number only)
    emails_sql = "','".join(esc(e) for e in by_email.keys())
    select_sql = (
        f"SELECT id, email, id_number FROM customers WHERE lower(email) IN ('{emails_sql}')"
    )

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    print(f"\nConnecting to {VPS_HOST}...")
    client.connect(VPS_HOST, username=VPS_USER, password=VPS_PASSWORD, timeout=30)
    print("Connected.\n")

    cmd = f'{COMPOSE} exec -T postgres psql -U ob_user -d ob_inventory -t -A -F"|" -c "{select_sql}"'
    _, stdout, stderr = client.exec_command(cmd, timeout=30)
    out = stdout.read().decode("utf-8", errors="replace")
    err = stderr.read().decode("utf-8", errors="replace")
    if err.strip():
        print("STDERR:", err.strip())

    rows = [l.split("|") for l in out.strip().splitlines() if l.strip()]
    print(f"Matching customers found in production: {len(rows)}")

    stmts = ["BEGIN;"]
    to_fill = []
    already_set = []
    for cust_id, cust_email, existing_id_number in rows:
        cust_email_lower = cust_email.strip().lower()
        info = by_email.get(cust_email_lower)
        if not info:
            continue
        if existing_id_number.strip():
            already_set.append((cust_email, existing_id_number))
            continue
        stmts.append(
            f"UPDATE customers SET id_number = '{esc(info['id_number'])}' "
            f"WHERE id = '{cust_id}' AND id_number IS NULL;"
        )
        to_fill.append((cust_email, info["id_number"]))
    stmts.append("COMMIT;")

    print(f"\nAlready had an ID number (left untouched): {len(already_set)}")
    print(f"Will fill: {len(to_fill)}")
    for email, idn in to_fill:
        print(f"  {email} -> {idn}")

    if not to_fill:
        print("\nNothing to apply.")
        client.close()
        return

    sql = "\n".join(stmts)
    local_path = ROOT / "scripts" / "analysis" / "_backfill_customer_id_numbers.sql"
    local_path.parent.mkdir(exist_ok=True)
    local_path.write_text(sql, encoding="utf-8")

    remote_tmp = "/tmp/backfill_customer_id_numbers.sql"
    sftp = client.open_sftp()
    sftp.put(str(local_path), remote_tmp)
    sftp.close()
    client.exec_command(f"docker cp {remote_tmp} $({COMPOSE} ps -q postgres):{remote_tmp}", timeout=30)[1].read()

    print("\nApplying (single transaction)...")
    apply_cmd = f"{COMPOSE} exec -T postgres psql -U ob_user -d ob_inventory -v ON_ERROR_STOP=1 -f {remote_tmp}"
    _, stdout, stderr = client.exec_command(apply_cmd, timeout=60)
    apply_out = stdout.read().decode("utf-8", errors="replace")
    apply_err = stderr.read().decode("utf-8", errors="replace")
    exit_code = stdout.channel.recv_exit_status()

    update_lines = [l for l in apply_out.splitlines() if l.startswith("UPDATE")]
    print(f"UPDATE statements executed: {len(update_lines)}")
    if apply_err.strip():
        print("STDERR:", apply_err.strip())
    print(f"[exit {exit_code}]")

    client.exec_command(f"rm -f {remote_tmp}")
    client.close()


if __name__ == "__main__":
    main()

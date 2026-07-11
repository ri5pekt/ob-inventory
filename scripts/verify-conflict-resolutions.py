"""Verify the 4 resolved conflict families now have exactly the confirmed price, with zero blanks left."""
import paramiko
from _vps_creds import VPS_HOST, VPS_USER, VPS_PASSWORD

APP_DIR = "/opt/ob-inventory"
COMPOSE = f"docker compose -f {APP_DIR}/docker-compose.yml"

SQL = """
SELECT
  CASE
    WHEN sku LIKE 'BGBL01%%' THEN 'BGBL01'
    WHEN sku LIKE 'BGSA-%%' THEN 'BGSA'
    WHEN sku LIKE 'GI-%%' THEN 'GI'
    WHEN sku LIKE 'SGCLASSIC%%' THEN 'SGCLASSIC'
    WHEN sku LIKE 'BBTD%%' THEN 'BBTD (skipped)'
    WHEN sku LIKE 'GROINFABRIC%%' THEN 'GROINFABRIC (skipped)'
    WHEN sku LIKE 'SJ-%%' THEN 'SJ (skipped)'
  END AS family,
  COUNT(*) AS n_skus,
  COUNT(DISTINCT cost_price) AS distinct_costs,
  COUNT(DISTINCT retail_price) AS distinct_retails,
  string_agg(DISTINCT cost_price::text, ',') AS costs,
  string_agg(DISTINCT retail_price::text, ',') AS retails,
  SUM(CASE WHEN cost_price IS NULL OR retail_price IS NULL THEN 1 ELSE 0 END) AS still_blank
FROM products
WHERE sku LIKE 'BGBL01%%' OR sku LIKE 'BGSA-%%' OR sku LIKE 'GI-%%' OR sku LIKE 'SGCLASSIC%%'
   OR sku LIKE 'BBTD%%' OR sku LIKE 'GROINFABRIC%%' OR sku LIKE 'SJ-%%'
GROUP BY family
ORDER BY family;
""".strip().replace("\n", " ")

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(VPS_HOST, username=VPS_USER, password=VPS_PASSWORD, timeout=30)
cmd = f'{COMPOSE} exec -T postgres psql -U ob_user -d ob_inventory -c "{SQL}"'
_, stdout, stderr = client.exec_command(cmd, timeout=30)
print(stdout.read().decode())
err = stderr.read().decode()
if err.strip():
    print("STDERR:", err)
client.close()

"""
Read-only export: pull the full product catalog from PRODUCTION (activebrands.cloud)
and save it to a local CSV for offline price-update analysis.

Does NOT modify anything on production. Safe to re-run any time.

Run from project root: python scripts/export-products-for-price-analysis.py
"""
import os
import paramiko
from _vps_creds import VPS_HOST, VPS_USER, VPS_PASSWORD

APP_DIR = "/opt/ob-inventory"
COMPOSE = f"docker compose -f {APP_DIR}/docker-compose.yml"

OUT_DIR = os.path.join(os.path.dirname(__file__), "analysis")
OUT_CSV = os.path.join(OUT_DIR, "products_export.csv")

SQL = """
COPY (
  SELECT
    p.sku,
    p.name,
    b.name AS brand,
    c.name AS category,
    p.date_added,
    p.cost_price,
    p.retail_price,
    p.base_price,
    p.woo_product_id,
    (SELECT ao.label FROM product_attributes pa
       JOIN attribute_options ao ON ao.id = pa.option_id
       JOIN attribute_definitions ad ON ad.id = pa.definition_id
      WHERE pa.product_id = p.id AND ad.name = 'Size') AS size,
    (SELECT ao.label FROM product_attributes pa
       JOIN attribute_options ao ON ao.id = pa.option_id
       JOIN attribute_definitions ad ON ad.id = pa.definition_id
      WHERE pa.product_id = p.id AND ad.name = 'Color') AS color,
    (SELECT ao.label FROM product_attributes pa
       JOIN attribute_options ao ON ao.id = pa.option_id
       JOIN attribute_definitions ad ON ad.id = pa.definition_id
      WHERE pa.product_id = p.id AND ad.name = 'Model') AS model,
    (SELECT ao.label FROM product_attributes pa
       JOIN attribute_options ao ON ao.id = pa.option_id
       JOIN attribute_definitions ad ON ad.id = pa.definition_id
      WHERE pa.product_id = p.id AND ad.name = 'Unit') AS unit,
    (SELECT string_agg(DISTINCT ist.box_number, ',') FROM inventory_stock ist
      WHERE ist.product_id = p.id AND ist.box_number IS NOT NULL) AS boxes,
    (SELECT COALESCE(SUM(ist.quantity), 0) FROM inventory_stock ist
      WHERE ist.product_id = p.id) AS qty
  FROM products p
  LEFT JOIN brands b ON b.id = p.brand_id
  LEFT JOIN categories c ON c.id = p.category_id
  ORDER BY p.sku
) TO STDOUT WITH CSV HEADER
""".strip().replace("\n", " ")

def main():
    os.makedirs(OUT_DIR, exist_ok=True)

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    print(f"Connecting to {VPS_HOST}...")
    client.connect(VPS_HOST, username=VPS_USER, password=VPS_PASSWORD, timeout=30)
    print("Connected.\n")

    cmd = f'{COMPOSE} exec -T postgres psql -U ob_user -d ob_inventory -c "{SQL}"'
    print("Exporting products from production (read-only)...")
    _, stdout, stderr = client.exec_command(cmd, timeout=60)
    data = stdout.read().decode("utf-8", errors="replace")
    err = stderr.read().decode("utf-8", errors="replace")
    client.close()

    if err.strip():
        print(f"  STDERR: {err.strip()[:500]}")

    if not data.strip():
        print("No data returned — aborting.")
        return

    with open(OUT_CSV, "w", encoding="utf-8", newline="") as f:
        f.write(data)

    line_count = len(data.splitlines()) - 1  # minus header
    print(f"Saved {line_count} products to {OUT_CSV}")

if __name__ == "__main__":
    main()

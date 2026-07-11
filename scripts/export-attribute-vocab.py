"""
Read-only export: pull attribute definitions/options and full product data
(with raw IDs, for later precise writes) from PRODUCTION.

Run from project root: python scripts/export-attribute-vocab.py
"""
import os
import paramiko
from _vps_creds import VPS_HOST, VPS_USER, VPS_PASSWORD

APP_DIR = "/opt/ob-inventory"
COMPOSE = f"docker compose -f {APP_DIR}/docker-compose.yml"
OUT_DIR = os.path.join(os.path.dirname(__file__), "analysis")

QUERIES = {
    "attribute_options.csv": """
        COPY (
          SELECT ad.name AS definition, ad.id AS definition_id, ao.id AS option_id,
                 ao.code, ao.label
          FROM attribute_options ao
          JOIN attribute_definitions ad ON ad.id = ao.definition_id
          ORDER BY ad.sort_order, ao.sort_order
        ) TO STDOUT WITH CSV HEADER
    """,
    "brands.csv": "COPY (SELECT id, name FROM brands ORDER BY name) TO STDOUT WITH CSV HEADER",
    "categories.csv": "COPY (SELECT id, name FROM categories ORDER BY name) TO STDOUT WITH CSV HEADER",
    "products_full.csv": """
        COPY (
          SELECT
            p.id, p.sku, p.name, p.brand_id, p.category_id, p.date_added,
            p.cost_price, p.retail_price,
            (SELECT pa.option_id FROM product_attributes pa JOIN attribute_definitions ad ON ad.id = pa.definition_id
              WHERE pa.product_id = p.id AND ad.name = 'Size') AS size_option_id,
            (SELECT pa.option_id FROM product_attributes pa JOIN attribute_definitions ad ON ad.id = pa.definition_id
              WHERE pa.product_id = p.id AND ad.name = 'Color') AS color_option_id,
            (SELECT pa.option_id FROM product_attributes pa JOIN attribute_definitions ad ON ad.id = pa.definition_id
              WHERE pa.product_id = p.id AND ad.name = 'Model') AS model_option_id,
            (SELECT pa.option_id FROM product_attributes pa JOIN attribute_definitions ad ON ad.id = pa.definition_id
              WHERE pa.product_id = p.id AND ad.name = 'Unit') AS unit_option_id
          FROM products p
          ORDER BY p.sku
        ) TO STDOUT WITH CSV HEADER
    """,
}


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    print(f"Connecting to {VPS_HOST}...")
    client.connect(VPS_HOST, username=VPS_USER, password=VPS_PASSWORD, timeout=30)
    print("Connected.\n")

    for filename, sql in QUERIES.items():
        sql_flat = sql.strip().replace("\n", " ")
        cmd = f'{COMPOSE} exec -T postgres psql -U ob_user -d ob_inventory -c "{sql_flat}"'
        print(f"Exporting {filename}...")
        _, stdout, stderr = client.exec_command(cmd, timeout=60)
        data = stdout.read().decode("utf-8", errors="replace")
        err = stderr.read().decode("utf-8", errors="replace")
        if err.strip():
            print(f"  STDERR: {err.strip()[:500]}")
        out_path = os.path.join(OUT_DIR, filename)
        with open(out_path, "w", encoding="utf-8", newline="") as f:
            f.write(data)
        print(f"  -> {out_path} ({max(len(data.splitlines()) - 1, 0)} rows)")

    client.close()


if __name__ == "__main__":
    main()

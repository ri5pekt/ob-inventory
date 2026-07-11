"""
Precisely verify: for every row we intended to fix, is that EXACT value now
set on production? Re-exports current state and checks row-by-row, rather
than relying on aggregate counts (which can drift if the live store is
being used concurrently).
"""
import os
import sys
import paramiko
import pandas as pd
from _vps_creds import VPS_HOST, VPS_USER, VPS_PASSWORD

APP_DIR = "/opt/ob-inventory"
COMPOSE = f"docker compose -f {APP_DIR}/docker-compose.yml"
DIR = os.path.join(os.path.dirname(__file__), "analysis")

SQL = """
COPY (
  SELECT
    p.id, p.sku, p.brand_id, p.category_id,
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
""".strip().replace("\n", " ")

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(VPS_HOST, username=VPS_USER, password=VPS_PASSWORD, timeout=30)
cmd = f'{COMPOSE} exec -T postgres psql -U ob_user -d ob_inventory -c "{SQL}"'
_, stdout, stderr = client.exec_command(cmd, timeout=60)
data = stdout.read().decode("utf-8", errors="replace")
client.close()

now_path = os.path.join(DIR, "products_full_after.csv")
with open(now_path, "w", encoding="utf-8", newline="") as f:
    f.write(data)

now = pd.read_csv(now_path, dtype=str)
before = pd.read_csv(os.path.join(DIR, "products_full.csv"), dtype=str)
fixes = pd.read_csv(os.path.join(DIR, "attribute_fixes.csv"), dtype=str)

FIELD_TO_COL = {
    "brand": "brand_id", "category": "category_id",
    "model": "model_option_id", "unit": "unit_option_id",
    "size": "size_option_id", "color": "color_option_id",
}

now_by_sku = now.set_index("sku")
before_by_sku = before.set_index("sku")

applied, not_applied, overwritten_something_else = 0, 0, 0
mismatches = []
for _, row in fixes.iterrows():
    sku = row["sku"]
    col = FIELD_TO_COL[row["field"]]
    expected = row["new_option_id"]
    if sku not in now_by_sku.index:
        continue
    actual = now_by_sku.loc[sku, col]
    prior = before_by_sku.loc[sku, col] if sku in before_by_sku.index else None
    if pd.notna(actual) and actual == expected:
        applied += 1
    elif pd.notna(actual) and actual != expected:
        overwritten_something_else += 1
        mismatches.append((sku, row["field"], prior, expected, actual))
    else:
        not_applied += 1
        mismatches.append((sku, row["field"], prior, expected, actual))

print(f"Fixes correctly applied exactly as intended: {applied} / {len(fixes)}")
print(f"Fixes NOT applied (still blank): {not_applied}")
print(f"Fixes where field now holds a DIFFERENT value than intended: {overwritten_something_else}")
if mismatches:
    print("\nDetails (sku, field, prior_value, intended, actual):")
    for m in mismatches[:30]:
        print(" ", m)

# Now check: how many product_attributes rows appeared that are NOT explained by our fixes at all (drift)
print()
for field, col in [("size", "size_option_id"), ("color", "color_option_id"),
                    ("model", "model_option_id"), ("unit", "unit_option_id")]:
    before_null = set(before_by_sku[before_by_sku[col].isna()].index)
    now_filled = set(now_by_sku[now_by_sku[col].notna()].index) & before_null
    our_fix_skus = set(fixes[fixes["field"] == field]["sku"])
    unexplained = now_filled - our_fix_skus
    print(f"{field}: newly filled = {len(now_filled)}, from our fixes = {len(now_filled & our_fix_skus)}, unexplained/other = {len(unexplained)}")
    if unexplained:
        print("  unexplained skus:", sorted(unexplained)[:10])

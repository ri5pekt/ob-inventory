"""
For every proposed fix that did NOT land (because a free-text attribute row
already occupied that (product_id, definition_id) slot), check whether the
existing value_text is a harmless match for the label we intended to set
(safe to normalize into a proper option_id) or a genuine conflict (leave
alone, flag for review).
"""
import os
import paramiko
import pandas as pd
from _vps_creds import VPS_HOST, VPS_USER, VPS_PASSWORD

APP_DIR = "/opt/ob-inventory"
COMPOSE = f"docker compose -f {APP_DIR}/docker-compose.yml"
DIR = os.path.join(os.path.dirname(__file__), "analysis")

FIELD_TO_COL = {
    "brand": "brand_id", "category": "category_id",
    "model": "model_option_id", "unit": "unit_option_id",
    "size": "size_option_id", "color": "color_option_id",
}
FIELD_TO_DEFINITION = {"model": "Model", "unit": "Unit", "size": "Size", "color": "Color"}

fixes = pd.read_csv(os.path.join(DIR, "attribute_fixes.csv"), dtype=str)
after = pd.read_csv(os.path.join(DIR, "products_full_after.csv"), dtype=str).set_index("sku")
full = pd.read_csv(os.path.join(DIR, "products_full.csv"), dtype=str).set_index("sku")

not_applied_attr = fixes[fixes["field"].isin(FIELD_TO_DEFINITION.keys())].copy()
not_applied_attr["still_missing"] = not_applied_attr.apply(
    lambda r: pd.isna(after.loc[r["sku"], FIELD_TO_COL[r["field"]]]) if r["sku"] in after.index else False,
    axis=1,
)
not_applied_attr = not_applied_attr[not_applied_attr["still_missing"]]
print(f"Rows to diagnose: {len(not_applied_attr)}")

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(VPS_HOST, username=VPS_USER, password=VPS_PASSWORD, timeout=30)

sql = """
COPY (
  SELECT p.sku, ad.name AS def, pa.value_text
  FROM product_attributes pa
  JOIN products p ON p.id = pa.product_id
  JOIN attribute_definitions ad ON ad.id = pa.definition_id
  WHERE pa.option_id IS NULL
) TO STDOUT WITH CSV HEADER
""".strip().replace("\n", " ")
cmd = f'{COMPOSE} exec -T postgres psql -U ob_user -d ob_inventory -c "{sql}"'
_, stdout, stderr = client.exec_command(cmd, timeout=30)
data = stdout.read().decode("utf-8", errors="replace")
client.close()

text_path = os.path.join(DIR, "text_only_attributes.csv")
with open(text_path, "w", encoding="utf-8", newline="") as f:
    f.write(data)

text_rows = pd.read_csv(text_path, dtype=str)
text_rows["key"] = text_rows["sku"] + "|" + text_rows["def"]
text_lookup = text_rows.set_index("key")["value_text"]

def norm(s):
    return str(s).strip().lower() if pd.notna(s) else ""

safe, conflict = [], []
for _, row in not_applied_attr.iterrows():
    key = row["sku"] + "|" + FIELD_TO_DEFINITION[row["field"]]
    if key not in text_lookup.index:
        conflict.append({**row.to_dict(), "existing_value_text": None, "reason": "no_row_found_unexpected"})
        continue
    existing_text = text_lookup.loc[key]
    if isinstance(existing_text, pd.Series):
        existing_text = existing_text.iloc[0]
    if norm(existing_text) == "" or norm(existing_text) == norm(row["new_value"]):
        safe.append({**row.to_dict(), "existing_value_text": existing_text})
    else:
        conflict.append({**row.to_dict(), "existing_value_text": existing_text, "reason": "text_mismatch"})

safe_df = pd.DataFrame(safe)
conflict_df = pd.DataFrame(conflict)
safe_df.to_csv(os.path.join(DIR, "text_to_option_safe.csv"), index=False, encoding="utf-8")
conflict_df.to_csv(os.path.join(DIR, "text_to_option_conflicts.csv"), index=False, encoding="utf-8")

print(f"\nSafe to normalize (text matches intended label exactly): {len(safe_df)}")
print(f"Genuine conflicts (existing text differs): {len(conflict_df)}")
if not conflict_df.empty:
    print("\nSample conflicts:")
    print(conflict_df[["sku", "field", "new_value", "existing_value_text"]].head(20).to_string(index=False))

"""Verify attribute_fixes.csv actually landed on production as expected."""
import paramiko
from _vps_creds import VPS_HOST, VPS_USER, VPS_PASSWORD

APP_DIR = "/opt/ob-inventory"
COMPOSE = f"docker compose -f {APP_DIR}/docker-compose.yml"

SQL = """
SELECT 'brand_null' AS metric, COUNT(*) FROM products WHERE brand_id IS NULL
UNION ALL
SELECT 'category_null', COUNT(*) FROM products WHERE category_id IS NULL
UNION ALL
SELECT 'has_size', COUNT(*) FROM product_attributes pa JOIN attribute_definitions ad ON ad.id = pa.definition_id WHERE ad.name = 'Size'
UNION ALL
SELECT 'has_color', COUNT(*) FROM product_attributes pa JOIN attribute_definitions ad ON ad.id = pa.definition_id WHERE ad.name = 'Color'
UNION ALL
SELECT 'has_model', COUNT(*) FROM product_attributes pa JOIN attribute_definitions ad ON ad.id = pa.definition_id WHERE ad.name = 'Model'
UNION ALL
SELECT 'has_unit', COUNT(*) FROM product_attributes pa JOIN attribute_definitions ad ON ad.id = pa.definition_id WHERE ad.name = 'Unit'
UNION ALL
SELECT 'total_products', COUNT(*) FROM products;
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

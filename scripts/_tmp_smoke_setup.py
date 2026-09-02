import paramiko
from _vps_creds import VPS_HOST, VPS_USER, VPS_PASSWORD

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(VPS_HOST, username=VPS_USER, password=VPS_PASSWORD, timeout=30)
cmd = "cd /opt/ob-inventory && docker compose exec -T postgres psql -U ob_user -d ob_inventory -c \"DELETE FROM api_tokens WHERE name = 'prod-smoke-test-4';\""
stdin, stdout, stderr = client.exec_command(cmd)
print(stdout.read().decode())
print(stderr.read().decode())
client.close()

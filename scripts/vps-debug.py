import paramiko, sys, io, os, time
os.environ.setdefault('PYTHONIOENCODING', 'utf-8')
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace', line_buffering=True)

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect("187.124.160.50", username="root", password="ct3JzHM18F/4kpfL", timeout=30)

def run(cmd, timeout=30):
    print(f"\n$ {cmd}")
    _, stdout, _ = client.exec_command(cmd, timeout=timeout, get_pty=True)
    while not stdout.channel.exit_status_ready():
        if stdout.channel.recv_ready():
            print(stdout.channel.recv(4096).decode("utf-8", errors="replace"), end="", flush=True)
        time.sleep(0.2)
    print(stdout.read().decode("utf-8", errors="replace"), end="")

# Show what's in the volume before deleting
run("docker compose -f /opt/ob-inventory/docker-compose.yml exec -T api sh -c 'ls /app/apps/api/uploads/products/ | wc -l && du -sh /app/apps/api/uploads/products/ 2>/dev/null || echo empty'", timeout=10)

# Delete all image files
run("docker compose -f /opt/ob-inventory/docker-compose.yml exec -T api sh -c 'rm -rf /app/apps/api/uploads/products && mkdir -p /app/apps/api/uploads/products && echo DONE'", timeout=10)

# Clear the picture column in DB too so re-import downloads fresh
run("""cd /opt/ob-inventory && docker compose exec -T postgres psql -U ob_user -d ob_inventory -c "UPDATE products SET picture = NULL;" 2>&1""", timeout=10)

# Also prune Docker build cache to free the 3.9GB
run("docker builder prune -f 2>&1", timeout=60)

run("df -h / 2>&1", timeout=5)
client.close()

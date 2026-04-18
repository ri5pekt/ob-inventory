import paramiko, sys, io, os, time
os.environ.setdefault('PYTHONIOENCODING', 'utf-8')
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace', line_buffering=True)

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect("187.124.160.50", username="root", password="ct3JzHM18F/4kpfL", timeout=30)

def run(cmd, timeout=300):
    print(f"\n$ {cmd[:100]}")
    _, stdout, _ = client.exec_command(cmd, timeout=timeout, get_pty=True)
    while not stdout.channel.exit_status_ready():
        if stdout.channel.recv_ready():
            print(stdout.channel.recv(4096).decode("utf-8", errors="replace"), end="", flush=True)
        time.sleep(0.1)
    print(stdout.read().decode("utf-8", errors="replace"), end="")
    print(f"[exit {stdout.channel.recv_exit_status()}]")

run("cd /opt/ob-inventory && git pull origin main 2>&1")
run("cd /opt/ob-inventory && BUILDKIT_PROGRESS=plain docker compose build web 2>&1")
run("cd /opt/ob-inventory && docker compose up -d --no-deps web 2>&1")
run("cd /opt/ob-inventory && docker compose ps 2>&1", timeout=30)

client.close()
print("\nv1.3.1 deployed.")

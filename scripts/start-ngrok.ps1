# ─────────────────────────────────────────────────────────────────────────────
# start-ngrok.ps1  —  Expose the OB Inventory dev environment via ngrok
#
# Prerequisites:
#   1. Sign up at https://dashboard.ngrok.com/signup  (free)
#   2. Copy your authtoken from https://dashboard.ngrok.com/get-started/your-authtoken
#   3. Run once:  ngrok config add-authtoken <YOUR_TOKEN>
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File .\scripts\start-ngrok.ps1
# ─────────────────────────────────────────────────────────────────────────────

$env:PATH = [System.Environment]::GetEnvironmentVariable('PATH', 'Machine') + ';' +
            [System.Environment]::GetEnvironmentVariable('PATH', 'User')

# ── Verify ngrok is available ─────────────────────────────────────────────────
if (-not (Get-Command ngrok -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: ngrok not found. Install it with:  winget install ngrok.ngrok" -ForegroundColor Red
    exit 1
}

# ── Check auth token ──────────────────────────────────────────────────────────
$configPath = "$env:LOCALAPPDATA\ngrok\ngrok.yml"
if (-not (Test-Path $configPath) -or -not (Select-String -Path $configPath -Pattern 'authtoken' -Quiet)) {
    Write-Host ""
    Write-Host "  ngrok needs an auth token (free account required)" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  1. Sign up:        https://dashboard.ngrok.com/signup"
    Write-Host "  2. Get your token: https://dashboard.ngrok.com/get-started/your-authtoken"
    Write-Host "  3. Run once:       ngrok config add-authtoken <YOUR_TOKEN>"
    Write-Host ""
    exit 1
}

# ── Kill any existing ngrok process ──────────────────────────────────────────
Get-Process ngrok -ErrorAction SilentlyContinue | Stop-Process -Force

# ── Start ngrok in the background ────────────────────────────────────────────
$logFile = "$env:TEMP\ngrok-ob-inventory.log"
Write-Host "Starting ngrok tunnel on port 3000 (API)..." -ForegroundColor Cyan

Start-Process -FilePath "ngrok" `
    -ArgumentList "http 3000 --log=stdout --log-level=info" `
    -RedirectStandardOutput $logFile `
    -WindowStyle Hidden

# ── Wait for the tunnel to come up ────────────────────────────────────────────
$url = $null
for ($i = 0; $i -lt 15; $i++) {
    Start-Sleep -Seconds 1
    try {
        $tunnels = Invoke-RestMethod -Uri "http://localhost:4040/api/tunnels" -ErrorAction Stop
        $https = $tunnels.tunnels | Where-Object { $_.proto -eq 'https' }
        if ($https) {
            $url = $https.public_url
            break
        }
    } catch { }
}

if (-not $url) {
    Write-Host ""
    Write-Host "ERROR: Tunnel did not start. Check log: $logFile" -ForegroundColor Red
    Get-Content $logFile -ErrorAction SilentlyContinue | Select-Object -Last 20
    exit 1
}

# ── Success ───────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  ✅  Tunnel is live!" -ForegroundColor Green
Write-Host ""
Write-Host "  API public URL:    $url" -ForegroundColor White
Write-Host "  API base URL:      $url/api" -ForegroundColor White
Write-Host "  Health check:      $url/api/health" -ForegroundColor White
Write-Host "  ngrok inspector:   http://localhost:4040" -ForegroundColor White
Write-Host ""
Write-Host "  ─────────────────────────────────────────────────────────────" -ForegroundColor DarkGray
Write-Host "  WordPress plugin settings (Settings → OB Inventory):" -ForegroundColor Yellow
Write-Host "    API Base URL:     $url/api" -ForegroundColor Yellow
Write-Host "    App / Dashboard:  $url" -ForegroundColor Yellow
Write-Host "  ─────────────────────────────────────────────────────────────" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  Tunnel stays open as long as this shell session is running." -ForegroundColor DarkGray
Write-Host "  To stop: Get-Process ngrok | Stop-Process" -ForegroundColor DarkGray
Write-Host ""

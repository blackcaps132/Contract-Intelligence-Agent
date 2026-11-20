Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " Starting Contract Intelligence Agent...                 " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# Check if services are already running on ports 8000 and 5173
$backendConn = Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue
$frontendConn = Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue

$backendScript = Join-Path $PSScriptRoot "run_backend.ps1"
$frontendScript = Join-Path $PSScriptRoot "run_frontend.ps1"

if (-not $backendConn) {
    Write-Host "Launching Backend (FastAPI on port 8000)..." -ForegroundColor Yellow
    Start-Process powershell -ArgumentList "-NoExit", "-ExecutionPolicy", "Bypass", "-File", "`"$backendScript`""
} else {
    Write-Host "Backend is already running on port 8000." -ForegroundColor Green
}

if (-not $frontendConn) {
    Write-Host "Launching Frontend (Vite on port 5173)..." -ForegroundColor Yellow
    Start-Process powershell -ArgumentList "-NoExit", "-ExecutionPolicy", "Bypass", "-File", "`"$frontendScript`""
} else {
    Write-Host "Frontend is already running on port 5173." -ForegroundColor Green
}

Write-Host "`nWaiting for services to be ready..." -ForegroundColor Gray
$timeout = 15
$ready = $false
for ($i = 0; $i -lt $timeout; $i++) {
    Start-Sleep -Seconds 1
    $b = Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue
    $f = Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue
    if ($b -and $f) {
        $ready = $true
        break
    }
}

Write-Host "`n==========================================================" -ForegroundColor Green
Write-Host " Contract Intelligence Agent is RUNNING!                  " -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green
Write-Host "  Frontend: http://127.0.0.1:5173" -ForegroundColor White
Write-Host "  Backend:  http://127.0.0.1:8000" -ForegroundColor White
Write-Host "  API Docs: http://127.0.0.1:8000/docs" -ForegroundColor White
Write-Host "Opening web browser at http://127.0.0.1:5173..." -ForegroundColor Cyan

Start-Process "http://127.0.0.1:5173"


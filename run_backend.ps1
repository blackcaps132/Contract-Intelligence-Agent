Write-Host "Starting Contract Intelligence Agent Backend (FastAPI)..." -ForegroundColor Cyan
Set-Location -Path "$PSScriptRoot\backend"
$uvicornPath = "$PSScriptRoot\.venv\Scripts\uvicorn.exe"

if (Test-Path $uvicornPath) {
    & $uvicornPath app.main:app --host 127.0.0.1 --port 8000 --reload
} else {
    uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
}

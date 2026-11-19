Set-Location -Path "$PSScriptRoot\backend"
Write-Host "Starting Contract Intelligence Agent Backend (FastAPI at http://127.0.0.1:8000)..." -ForegroundColor Green
$venvPython = "$PSScriptRoot\.venv\Scripts\python.exe"
if (Test-Path $venvPython) {
    & $venvPython -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
} else {
    python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
}

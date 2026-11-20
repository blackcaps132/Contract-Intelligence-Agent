Set-Location -Path "$PSScriptRoot\frontend"
Write-Host "Starting Contract Intelligence Agent Frontend (Vite at http://127.0.0.1:5173)..." -ForegroundColor Cyan
if (Get-Command npm.cmd -ErrorAction SilentlyContinue) {
    npm.cmd run dev
} else {
    npm run dev
}

@echo off
echo Starting Contract Intelligence Agent Backend (FastAPI)...
cd /d "%~dp0backend"
if exist "..\.venv\Scripts\uvicorn.exe" (
    "..\.venv\Scripts\uvicorn.exe" app.main:app --host 127.0.0.1 --port 8000
) else (
    uvicorn app.main:app --host 127.0.0.1 --port 8000
)

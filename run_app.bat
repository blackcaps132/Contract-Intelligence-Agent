@echo off
echo Starting Contract Intelligence Agent (Backend + Frontend)...
start "Contract Intelligence Backend" cmd /k "%~dp0run_backend.bat"
start "Contract Intelligence Frontend" cmd /k "%~dp0run_frontend.bat"

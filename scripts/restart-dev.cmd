@echo off
setlocal
cd /d "%~dp0\.."
echo Stopping anything listening on port 5174...
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":5174" ^| findstr "LISTENING"') do (
  taskkill /F /PID %%P >nul 2>&1
)
timeout /t 1 /nobreak >nul
echo Dev server: http://localhost:5174/
npm run dev

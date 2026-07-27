@echo off
setlocal
cd /d "%~dp0\.."
echo Dev server: http://localhost:5174/
npm run dev

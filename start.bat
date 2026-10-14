@echo off
title FO Network Mapper Server
echo ========================================================
echo   Starting FO Network Mapper...
echo ========================================================

cd /d "%~dp0"

REM Jalankan server Node.js
start http://localhost:3000/
node server/node/server.js

pause


@echo off
title Elite Dangerous Journal Server
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
    echo [error] Node.js not found. Download it from https://nodejs.org
    pause
    exit /b 1
)

if not exist node_modules (
    echo [setup] Installing dependencies...
    npm install
)

echo [server] Starting Elite Dangerous Journal Server on ws://localhost:31337
echo [server] Keep this window open while playing. Close it to stop.
echo.
node server.js
pause

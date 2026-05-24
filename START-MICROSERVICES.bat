@echo off
title Nexus Microservices
echo 🚀 Starting Nexus Microservices locally...

:: 1. Cleanup old processes
echo 🧹 Cleaning up old node processes...
taskkill /F /IM node.exe /T >nul 2>&1

:: 2. Launch Monolithic Backend Server
echo 📦 Launching Unified Monolithic CRM Server (3000)...
start "Backend" cmd /k "node server/server.js"

:: 3. Wait for database push & connection to warm up
echo ⏳ Waiting for backend to initialize and sync schema...
timeout /t 5 /nobreak >nul

:: 4. Launch Frontend Client
echo 📦 Launching Vite Client (5173)...
start "Client" cmd /k "cd client && npm run dev"

echo.
echo ✅ All services and the client have been launched!
echo 📍 Access your CRM at: http://localhost:5173
echo.
echo NOTE: Keep this window open or press any key to close this launcher.
pause

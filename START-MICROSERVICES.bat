@echo off
title Spike CRM Microservices
echo 🚀 Starting Spike CRM Microservices locally...

:: 1. Cleanup old processes
echo 🧹 Cleaning up old node processes...
taskkill /F /IM node.exe /T >nul 2>&1

:: 2. Launch Services
echo 📦 Launching API Gateway (3000)...
start "Gateway" node microservices/gateway/server.js

echo 📦 Launching Auth Service (3001)...
start "Auth" node microservices/auth-service/server.js

echo 📦 Launching Lead Service (3002)...
start "Lead" node microservices/lead-service/server.js

echo 📦 Launching Notification Service (3003)...
start "Notification" node microservices/notification-service/server.js

echo 📦 Launching Reporting Service (3004)...
start "Reporting" node microservices/reporting-service/server.js

echo.
echo ✅ All services launched successfully!
echo 📍 Access your CRM at: http://localhost:5173 (Vite Client)
pause

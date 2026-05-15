@echo off
title Spike CRM Microservices
echo 🚀 Starting Spike CRM Microservices locally...

:: 1. Cleanup old processes
echo 🧹 Cleaning up old node processes...
taskkill /F /IM node.exe /T >nul 2>&1

:: 2. Launch Backend Services first
echo 📦 Launching Auth Service (3001)...
start "Auth" cmd /k "node microservices/auth-service/server.js"

echo 📦 Launching Lead Service (3002)...
start "Lead" cmd /k "node microservices/lead-service/server.js"

echo 📦 Launching Notification Service (3003)...
start "Notification" cmd /k "node microservices/notification-service/server.js"

echo 📦 Launching Reporting Service (3004)...
start "Reporting" cmd /k "node microservices/reporting-service/server.js"

:: 3. Wait for services to warm up (Database connections take a few seconds)
echo ⏳ Waiting for microservices to initialize...
timeout /t 5 /nobreak >nul

:: 4. Launch API Gateway last
echo 📦 Launching API Gateway (3000)...
start "Gateway" cmd /k "node microservices/gateway/server.js"

echo.
echo ✅ All services launched!
echo 📍 Access your CRM at: http://localhost:5173
pause

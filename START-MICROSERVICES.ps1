# Spike CRM Microservices Startup Script
Write-Host "🚀 Starting Spike CRM Microservices locally..." -ForegroundColor Cyan

# 1. Cleanup
Write-Host "🧹 Cleaning up old node processes..." -ForegroundColor Yellow
Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force

# 2. Launch Services
Write-Host "📦 Launching API Gateway (3000)..."
Start-Process powershell -ArgumentList "-NoExit", "-Command", "node microservices/gateway/server.js" -WindowStyle Normal

Write-Host "📦 Launching Auth Service (3001)..."
Start-Process powershell -ArgumentList "-NoExit", "-Command", "node microservices/auth-service/server.js" -WindowStyle Normal

Write-Host "📦 Launching Lead Service (3002)..."
Start-Process powershell -ArgumentList "-NoExit", "-Command", "node microservices/lead-service/server.js" -WindowStyle Normal

Write-Host "📦 Launching Notification Service (3003)..."
Start-Process powershell -ArgumentList "-NoExit", "-Command", "node microservices/notification-service/server.js" -WindowStyle Normal

Write-Host "📦 Launching Reporting Service (3004)..."
Start-Process powershell -ArgumentList "-NoExit", "-Command", "node microservices/reporting-service/server.js" -WindowStyle Normal

Write-Host "`n✅ All services launched successfully!" -ForegroundColor Green
Write-Host "📍 Access your CRM at: http://localhost:5173 (Vite Client)" -ForegroundColor Blue

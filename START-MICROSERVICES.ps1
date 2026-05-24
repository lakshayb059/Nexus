# Nexus Microservices Startup Script
Write-Host "🚀 Starting Nexus Microservices locally..." -ForegroundColor Cyan

# 1. Cleanup
Write-Host "🧹 Cleaning up old node processes..." -ForegroundColor Yellow
Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force

# 2. Launch Monolithic Backend Server
Write-Host "📦 Launching Unified Monolithic CRM Server (3000)..."
Start-Process powershell -ArgumentList "-NoExit", "-Command", "node server/server.js" -WindowStyle Normal

# 3. Wait for services to initialize
Write-Host "⏳ Waiting for backend to initialize and sync schema..." -ForegroundColor Gray
Start-Sleep -Seconds 5

# 4. Launch Vite Client
Write-Host "📦 Launching Vite Client (5173)..."
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd client; npm run dev" -WindowStyle Normal

Write-Host "`n✅ All services and the client launched successfully!" -ForegroundColor Green
Write-Host "📍 Access your CRM at: http://localhost:5173" -ForegroundColor Blue

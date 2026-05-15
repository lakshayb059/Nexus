# Spike CRM Microservices Startup Script
Write-Host "🚀 Starting Spike CRM Microservices locally..." -ForegroundColor Cyan

# 1. Cleanup
Write-Host "🧹 Cleaning up old node processes..." -ForegroundColor Yellow
Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force

# 2. Launch Services
$services = @(
    @{ Name = "API Gateway"; Port = 3000; Path = "microservices/gateway/server.js" },
    @{ Name = "Auth Service"; Port = 3001; Path = "microservices/auth-service/server.js" },
    @{ Name = "Lead Service"; Port = 3002; Path = "microservices/lead-service/server.js" },
    @{ Name = "Notification Service"; Port = 3003; Path = "microservices/notification-service/server.js" },
    @{ Name = "Reporting Service"; Port = 3004; Path = "microservices/reporting-service/server.js" }
)

foreach ($service in $services) {
    Write-Host "📦 Launching $($service.Name) on port $($service.Port)..."
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "node $($service.Path)" -WindowStyle Normal
}

Write-Host "`n✅ All services launched successfully!" -ForegroundColor Green
Write-Host "📍 Access your CRM at: http://localhost:5173 (Vite Client)" -ForegroundColor Blue

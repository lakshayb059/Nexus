# Start Spike CRM Microservices
$services = @(
    @{ Name = "Gateway"; Path = "microservices/gateway"; Port = 3000 },
    @{ Name = "Auth"; Path = "microservices/auth-service"; Port = 3001 },
    @{ Name = "Lead"; Path = "microservices/lead-service"; Port = 3002 },
    @{ Name = "Notification"; Path = "microservices/notification-service"; Port = 3003 },
    @{ Name = "Reporting"; Path = "microservices/reporting-service"; Port = 3004 }
)

Write-Host "🚀 Starting Spike CRM Microservices..." -ForegroundColor Cyan

foreach ($svc in $services) {
    Write-Host "Starting $($svc.Name) on port $($svc.Port)..."
    Start-Process -NoNewWindow -FilePath "node" -ArgumentList "server.js" -WorkingDirectory "$($svc.Path)"
}

Write-Host "✅ All services started. API Gateway at http://localhost:3000" -ForegroundColor Green

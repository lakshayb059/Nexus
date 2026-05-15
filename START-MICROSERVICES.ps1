# Spike CRM Microservices Startup Script
echo "🚀 Starting Spike CRM Microservices locally..."

# Kill any existing processes on our ports
echo "🧹 Cleaning up old processes..."
Stop-Process -Name node -ErrorAction SilentlyContinue

# Start Services in new windows
echo "📦 Launching Services..."

# 1. API Gateway (Port 3000)
Start-Process powershell -ArgumentList "-NoExit", "-Command", "node microservices/gateway/server.js" -WindowStyle Normal
echo "  - Gateway (3000) started"

# 2. Auth Service (Port 3001)
Start-Process powershell -ArgumentList "-NoExit", "-Command", "node microservices/auth-service/server.js" -WindowStyle Normal
echo "  - Auth Service (3001) started"

# 3. Lead Service (Port 3002)
Start-Process powershell -ArgumentList "-NoExit", "-Command", "node microservices/lead-service/server.js" -WindowStyle Normal
echo "  - Lead Service (3002) started"

# 4. Notification Service (Port 3003)
Start-Process powershell -ArgumentList "-NoExit", "-Command", "node microservices/notification-service/server.js" -WindowStyle Normal
echo "  - Notification Service (3003) started"

# 5. Reporting Service (Port 3004)
Start-Process powershell -ArgumentList "-NoExit", "-Command", "node microservices/reporting-service/server.js" -WindowStyle Normal
echo "  - Reporting Service (3004) started"

echo "✅ All services launched!"
echo "📍 Access your CRM at: http://localhost:5173 (Vite Client)"

#!/bin/bash

# Spike CRM Oracle Cloud Deployment Script
echo "🚀 Starting Spike CRM Deployment on Oracle Cloud..."

# 1. Update system and install dependencies
sudo apt-get update
sudo apt-get install -y docker.io docker-compose git

# 2. Setup Environment Variables
if [ ! -f .env ]; then
    echo "Creating .env file..."
    read -p "Enter MongoDB Admin Username: " MONGO_USER
    read -p "Enter MongoDB Admin Password: " MONGO_PASS
    read -p "Enter JWT Secret: " JWT_SECRET
    
    echo "MONGO_USER=$MONGO_USER" > .env
    echo "MONGO_PASS=$MONGO_PASS" >> .env
    echo "JWT_SECRET=$JWT_SECRET" >> .env
fi

# 3. Build and Start Containers
sudo docker-compose down
sudo docker-compose up --build -d

echo "✅ CRM Backend is now running!"
echo "📍 API Gateway: http://your-vps-ip/api"
echo "📍 Real-time: http://your-vps-ip/socket.io"

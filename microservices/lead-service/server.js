const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
require('dotenv').config();

const app = express();
const PORT = process.env.LEAD_SERVICE_PORT || process.env.PORT || 3002;

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.use(cookieParser());

// Health Check Endpoints for Uptime Monitoring
app.get('/health', (req, res) => res.json({ status: 'Lead service is up', timestamp: new Date() }));
app.get('/', (req, res) => res.json({ status: 'Lead service is active', timestamp: new Date() }));

// Routes
app.use('/contacts', require('./routes/contacts'));
app.use('/leads', require('./routes/leads'));
app.use('/leads-management', require('./routes/leads-management'));

const { execSync } = require('child_process');

async function start() {
  try {
    console.log('Synchronizing Prisma schema with database...');
    const dbUrl = process.env.DATABASE_URL.includes('?') 
      ? `${process.env.DATABASE_URL}&sslmode=require` 
      : `${process.env.DATABASE_URL}?sslmode=require`;
    
    const path = require('path');
    const microservicesPath = path.join(__dirname, '..');
    execSync(`npx prisma db push`, { 
      cwd: microservicesPath,
      stdio: 'inherit',
      env: { ...process.env, DATABASE_URL: dbUrl }
    });
    console.log('Prisma schema synchronized successfully.');
  } catch (err) {
    console.error('Failed to synchronize Prisma schema:', err);
  }

  app.listen(PORT, () => {
    console.log(`📋 Lead Service running on port: ${PORT}`);
  });
}

start();

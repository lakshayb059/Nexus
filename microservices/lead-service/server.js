const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { connect } = require('../shared/mongodb');
require('dotenv').config();

const app = express();
const PORT = process.env.LEAD_SERVICE_PORT || process.env.PORT || 3002;

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());

// Health Check Endpoints for Uptime Monitoring
app.get('/health', (req, res) => res.json({ status: 'Lead service is up', timestamp: new Date() }));
app.get('/', (req, res) => res.json({ status: 'Lead service is active', timestamp: new Date() }));

// Routes
app.use('/contacts', require('./routes/contacts'));
app.use('/leads', require('./routes/leads'));
app.use('/leads-management', require('./routes/leads-management'));

async function start() {
  app.listen(PORT, () => {
    console.log(`📋 Lead Service running on port: ${PORT}`);
  });
  
  // Connect to MongoDB Atlas in the background to prevent blocking startup checks
  connect().catch(err => {
    console.error("❌ Deferred MongoDB Connection Failure in Lead Service:", err.message);
  });
}

start();

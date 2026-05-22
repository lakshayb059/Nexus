const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.REPORTING_SERVICE_PORT || process.env.PORT || 3004;

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

// Health Check Endpoints for Uptime Monitoring
app.get('/health', (req, res) => res.json({ status: 'Reporting service is up', timestamp: new Date() }));
app.get('/', (req, res) => res.json({ status: 'Reporting service is active', timestamp: new Date() }));

// Routes
app.use('/reports', require('./routes/reports'));
app.use('/upload', require('./routes/upload'));

async function start() {
  app.listen(PORT, () => {
    console.log(`📊 Reporting Service running on port: ${PORT}`);
  });
}

start();

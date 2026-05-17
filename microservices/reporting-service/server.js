const express = require('express');
const cors = require('cors');
const { connect } = require('../shared/mongodb');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || process.env.REPORT_SERVICE_PORT || 3004;

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

// Routes
app.use('/reports', require('./routes/reports'));
app.use('/upload', require('./routes/upload'));

async function start() {
  app.listen(PORT, () => {
    console.log(`📊 Reporting Service running on port: ${PORT}`);
  });
  
  // Connect to MongoDB Atlas in the background to prevent blocking startup checks
  connect().catch(err => {
    console.error("❌ Deferred MongoDB Connection Failure in Reporting Service:", err.message);
  });
}

start();

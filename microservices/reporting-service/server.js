const express = require('express');
const cors = require('cors');
const { connect } = require('../shared/mongodb');
require('dotenv').config();

const app = express();
const PORT = process.env.REPORT_SERVICE_PORT || 3004;

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

// Routes
app.use('/reports', require('./routes/reports'));
app.use('/upload', require('./routes/upload'));

async function start() {
  await connect();
  app.listen(PORT, () => {
    console.log(`📊 Reporting Service running on http://localhost:${PORT}`);
  });
}

start();

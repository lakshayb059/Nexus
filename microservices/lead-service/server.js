const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { connect } = require('../shared/mongodb');
require('dotenv').config();

const app = express();
const PORT = process.env.LEAD_SERVICE_PORT || 3002;

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());

// Routes
app.use('/api/contacts', require('./routes/contacts'));
app.use('/api/leads', require('./routes/leads'));
app.use('/api/leads-management', require('./routes/leads-management'));

async function start() {
  await connect();
  app.listen(PORT, () => {
    console.log(`📋 Lead Service running on http://localhost:${PORT}`);
  });
}

start();

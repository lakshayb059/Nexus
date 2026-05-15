const axios = require('axios');
const NOTIFICATION_SERVICE_URL = process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:3003';

async function broadcast(event, data) {
  try {
    // Only attempt broadcast if notification service URL is provided
    if (NOTIFICATION_SERVICE_URL) {
      await axios.post(`${NOTIFICATION_SERVICE_URL}/api/notifications/broadcast`, { event, data });
    }
  } catch (err) {
    console.error(`[NOTIFICATION CLIENT] Failed to broadcast ${event}:`, err.message);
  }
}

module.exports = { broadcast };

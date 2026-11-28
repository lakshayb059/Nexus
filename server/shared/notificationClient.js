const axios = require('axios');
const { invalidateCrmCaches } = require('./redis');

let ioInstance = null;

const CACHE_INVALIDATING_EVENTS = new Set([
  'contact_disposed',
  'lead_disposed',
  'lead_created',
  'lead_updated',
  'contacts_updated',
  'dashboard_update',
  'batch_uploaded',
  'users_updated',
  'agent_status_changed',
]);

function setSocketServer(io) {
  ioInstance = io;
}

async function broadcast(event, data) {
  if (CACHE_INVALIDATING_EVENTS.has(event)) {
    try {
      await invalidateCrmCaches();
    } catch {
      // Non-blocking
    }
  }

  if (ioInstance) {
    ioInstance.emit(event, data);
    return;
  }

  const serviceUrl = process.env.NOTIFICATION_SERVICE_URL;
  if (!serviceUrl) return;

  try {
    await axios.post(`${serviceUrl}/notifications/broadcast`, { event, data });
  } catch (err) {
    console.error(`[NOTIFICATION CLIENT] Failed to broadcast ${event}:`, err.message);
  }
}

module.exports = { broadcast, setSocketServer };

require('dotenv').config();
const dns = require('dns');

// Force Node.js to use public DNS servers that support SRV queries to avoid local DNS/ISP SRV lookup failures (ECONNREFUSED/ENOTFOUND)
try {
  dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
} catch (e) {
  console.warn("⚠️ Failed to set public DNS servers, falling back to default:", e.message);
}

const { MongoClient } = require('mongodb');

let MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://gargabhi999:gargabhi999@crm.8eds5va.mongodb.net/?appName=CRM';
const DB_NAME = 'spike_dms';

const COLLECTIONS = {
  users: 'users',
  contacts: 'contacts',
  batches: 'batches',
  leads: 'leads',
  appointments: 'appointments',
  callbacks: 'callbacks'
};

let db = null;
let client = null;

async function connect() {
  if (db) return db;
  try {
    console.log("📡 Connecting to MongoDB Atlas...");
    if (!client) {
      client = new MongoClient(MONGODB_URI, {
        connectTimeoutMS: 30000,
        serverSelectionTimeoutMS: 30000
      });
    }
    await client.connect();
    // Force spike_dms if the driver defaults to 'test' or nothing is provided
    let dbName = client.options.dbName || '';
    if (!dbName || dbName === 'test' || dbName === 'admin') {
      dbName = 'spike_dms';
    }
    db = client.db(dbName);
    console.log(`✅ Connected to MongoDB Database: [${dbName}]`);
    
    // Asynchronously create essential indexes to optimize query performance (non-blocking)
    const contactsCollection = db.collection('contacts');
    contactsCollection.createIndex({ assignedTo: 1 }).catch(err => console.warn("⚠️ Index creation (assignedTo) skipped/failed:", err.message));
    contactsCollection.createIndex({ createdAt: -1 }).catch(err => console.warn("⚠️ Index creation (createdAt) skipped/failed:", err.message));
    contactsCollection.createIndex({ batchId: 1 }).catch(err => console.warn("⚠️ Index creation (batchId) skipped/failed:", err.message));
    contactsCollection.createIndex({ isDeleted: 1 }).catch(err => console.warn("⚠️ Index creation (isDeleted) skipped/failed:", err.message));

    return db;
  } catch (err) {
    console.error("\n❌ MongoDB Connection Error:", err.message);
    console.error("💡 Action Required to Resolve Database Connection Issues:");
    console.error("   1. Check MongoDB Atlas Network Access: Deployed platforms (e.g., Render/Vercel) have dynamic IPs.");
    console.error("      Go to MongoDB Atlas dashboard -> Network Access -> Add IP Address, and choose 'Allow Access From Anywhere' (adds 0.0.0.0/0).");
    console.error("   2. Verify Environment Variables: Ensure 'MONGODB_URI' is correctly configured in your deployment's dashboard.");
    console.error("   3. Check Connection String Format: Confirm that the credentials and cluster details in your connection string are correct.\n");
    throw err;
  }
}

function getDB() {
  if (!db) throw new Error('Database not connected. Call connect() first.');
  return db;
}

function getCollection(name) {
  return getDB().collection(COLLECTIONS[name] || name);
}

module.exports = {
  connect,
  getDB,
  getCollection,
  COLLECTIONS
};

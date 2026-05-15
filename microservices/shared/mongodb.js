require('dotenv').config();
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
    return db;
  } catch (err) {
    console.error("❌ MongoDB Connection Error:", err.message);
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

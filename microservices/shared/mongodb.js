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
    const clientOptions = {
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 10000,
      tls: true,
      family: 4
    };
    client = new MongoClient(MONGODB_URI, clientOptions);
    await client.connect();
    db = client.db(DB_NAME);
    return db;
  } catch (error) {
    console.error('❌ MongoDB connection error:', error.message);
    throw error;
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

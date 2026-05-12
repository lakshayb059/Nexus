require('dotenv').config();
const { MongoClient } = require('mongodb');
const axios = require('axios');

// MongoDB Atlas connection string from .env
let MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://gargabhi999:gargabhi999@crm.8eds5va.mongodb.net/?appName=CRM';

// Safety check for old cluster URI
if (MONGODB_URI.includes('hxehni4')) {
  console.warn('\n' + '!'.repeat(60));
  console.warn('🚨 WARNING: Detected old cluster URI (hxehni4) from Render Environment.');
  console.warn('🚨 ACTION: Please update MONGODB_URI in Render Dashboard Settings.');
  console.warn('🚨 FORCING override to correct URI (8eds5va) for now.');
  console.warn('!'.repeat(60) + '\n');
  MONGODB_URI = 'mongodb+srv://gargabhi999:gargabhi999@crm.8eds5va.mongodb.net/?appName=CRM';
}

// Database and collection names
const DB_NAME = 'spike_dms';
const COLLECTIONS = {
  users: 'users',
  contacts: 'contacts',
  batches: 'batches'
};

let db = null;
let client = null;

// Connect to MongoDB Atlas
async function connect() {
  if (db) return db;
  
  try {
    console.log('📡 Connecting to MongoDB Atlas...');
    
    const clientOptions = {
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 10000,
      tls: true,
      family: 4 // Force IPv4 to avoid some network issues
    };

    client = new MongoClient(MONGODB_URI, clientOptions);
    await client.connect();
    db = client.db(DB_NAME);
    console.log('✅ Connected to MongoDB Atlas');
    
    // Create indexes for better performance
    await createIndexes();
    
    return db;
  } catch (error) {
    console.error('❌ MongoDB connection error:', error.message);
    
    if (error.message.includes('SSL') || error.message.includes('alert number 80')) {
      console.error('\n' + '='.repeat(60));
      console.error('🚨 DIAGNOSTIC: SSL Alert 80 - IP NOT WHITELISTED');
      console.error('='.repeat(60));
      
      try {
        const response = await axios.get('https://api.ipify.org?format=json');
        const publicIp = response.data.ip;
        console.error(`\n👉 Your current public IP is: ${publicIp}`);
        console.error(`👉 ACTION: Add this IP to MongoDB Atlas > Network Access.`);
        console.error(`👉 Alternatively, add 0.0.0.0/0 for testing access.\n`);
      } catch (ipErr) {
        console.error('\n👉 Please check your public IP and add it to MongoDB Atlas > Network Access.');
      }
      console.error('='.repeat(60) + '\n');
    }
    throw error;
  }
}

// Create database indexes
async function createIndexes() {
  try {
    // Users collection indexes
    await db.collection(COLLECTIONS.users).createIndex({ username: 1 }, { unique: true });
    
    // Contacts collection indexes
    await db.collection(COLLECTIONS.contacts).createIndex({ assignedTo: 1 });
    await db.collection(COLLECTIONS.contacts).createIndex({ disposition: 1 });
    await db.collection(COLLECTIONS.contacts).createIndex({ batchId: 1 });
    await db.collection(COLLECTIONS.contacts).createIndex({ isDeleted: 1 });
    await db.collection(COLLECTIONS.contacts).createIndex({ createdAt: 1 });
    
    // Compound indexes for login and queue performance
    await db.collection(COLLECTIONS.contacts).createIndex({ 
      assignedTo: 1, 
      disposition: 1, 
      appointmentDt: 1 
    });
    await db.collection(COLLECTIONS.contacts).createIndex({ 
      assignedTo: 1, 
      disposition: 1, 
      callBackDt: 1 
    });
    
    // Index for appointment/callback dates for background service
    await db.collection(COLLECTIONS.contacts).createIndex({ appointmentDt: 1 });
    await db.collection(COLLECTIONS.contacts).createIndex({ callBackDt: 1 });
    
    // Index for reports and history
    await db.collection(COLLECTIONS.contacts).createIndex({ disposedAt: 1 });
    await db.collection(COLLECTIONS.contacts).createIndex({ lastModified: 1 });
    
    // Text search index for global search performance
    await db.collection(COLLECTIONS.contacts).createIndex({
      "fields.Name": "text",
      "fields.Phone": "text",
      "fields.Mobile": "text",
      "fields.Email": "text"
    }, { name: "ContactSearchIndex" });
    
    // Batches collection indexes
    await db.collection(COLLECTIONS.batches).createIndex({ agentId: 1 });
    await db.collection(COLLECTIONS.batches).createIndex({ createdAt: 1 });
    
    console.log('✅ Database indexes optimized');
  } catch (error) {
    console.warn('⚠️ Index creation warning:', error.message);
  }
}

// Get database instance
function getDB() {
  if (!db) {
    throw new Error('Database not connected. Call connect() first.');
  }
  return db;
}

// Get collection helper
function getCollection(name) {
  return getDB().collection(COLLECTIONS[name] || name);
}

// Close database connection
async function close() {
  if (client) {
    await client.close();
    db = null;
    client = null;
    console.log('✅ MongoDB connection closed');
  }
}

// Seed initial data
async function seed() {
  try {
    await connect();
    
    const usersCollection = getCollection('users');
    const bcrypt = require('bcryptjs');
    
    // Check if an admin exists
    const adminExists = await usersCollection.findOne({ role: 'admin' });
    if (adminExists) {
      console.log('✅ Admin already exists. Skipping database seed.');
      return;
    }
    
    const hashedPassword = await bcrypt.hash('spikeCRM_2024!', 10);
    
    // Insert default admin only
    await usersCollection.insertOne({
      username: 'admin',
      password: hashedPassword,
      role: 'admin',
      name: 'Administrator',
      active: true,
      createdAt: new Date()
    });
    
    console.log('✅ Default admin user created');
  } catch (error) {
    console.error('❌ Seeding error:', error);
    throw error;
  }
}

module.exports = {
  connect,
  getDB,
  getCollection,
  close,
  seed
};

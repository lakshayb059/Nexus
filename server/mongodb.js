require('dotenv').config();
const { MongoClient } = require('mongodb');

// MongoDB Atlas connection string from .env
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://gargabhi999:CRM123@crm.hxehni4.mongodb.net/?appName=CRM';

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
    client = new MongoClient(MONGODB_URI);
    await client.connect();
    db = client.db(DB_NAME);
    console.log('✅ Connected to MongoDB Atlas');
    
    // Create indexes for better performance
    await createIndexes();
    
    return db;
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    throw error;
  }
}

// Create database indexes
async function createIndexes() {
  try {
    // Users collection indexes
    await db.collection(COLLECTIONS.users).createIndex({ username: 1 }, { unique: true });
    
    // Contacts collection indexes
    await db.collection(COLLECTIONS.contacts).createIndex({ agentId: 1 });
    await db.collection(COLLECTIONS.contacts).createIndex({ disposition: 1 });
    await db.collection(COLLECTIONS.contacts).createIndex({ batchId: 1 });
    
    // Batches collection indexes
    await db.collection(COLLECTIONS.batches).createIndex({ agentId: 1 });
    await db.collection(COLLECTIONS.batches).createIndex({ createdAt: 1 });
    
    console.log('✅ Database indexes created');
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
    
    const hashedPassword = await bcrypt.hash('admin123', 10);
    
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

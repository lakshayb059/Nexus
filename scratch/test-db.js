const { MongoClient } = require('mongodb');

const uri = "mongodb+srv://gargabhi999:gargabhi999@crm.8eds5va.mongodb.net/?appName=CRM";
const client = new MongoClient(uri);

async function run() {
  try {
    console.log("📡 Attempting to connect to MongoDB Atlas...");
    await client.connect();
    console.log("✅ Successfully connected to Atlas!");
    
    const db = client.db();
    const collections = await db.listCollections().toArray();
    console.log("📦 Found collections:", collections.map(c => c.name));
    
  } catch (err) {
    console.error("❌ Connection failed!");
    console.error(err.message);
  } finally {
    await client.close();
  }
}

run();

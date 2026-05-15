const { MongoClient } = require('mongodb');

const uri = "mongodb+srv://gargabhi999:gargabhi999@crm.8eds5va.mongodb.net/?appName=CRM";
const client = new MongoClient(uri);

async function run() {
  try {
    await client.connect();
    console.log("📡 Connected to Atlas cluster.");
    
    const adminDb = client.db().admin();
    const dbsInfo = await adminDb.listDatabases();
    console.log("📂 Available Databases:", dbsInfo.databases.map(d => d.name));
    
    // Check common database names
    const targets = ['CRM', 'spike_crm', 'test'];
    for (const dbName of targets) {
      const db = client.db(dbName);
      const collections = await db.listCollections().toArray();
      if (collections.length > 0) {
        console.log(`✅ Found active data in database: [${dbName}]`);
        const usersCount = await db.collection('users').countDocuments();
        console.log(`👤 Users: ${usersCount}`);
        const leadsCount = await db.collection('leads').countDocuments();
        console.log(`📞 Leads: ${leadsCount}`);
        
        if (usersCount > 0) {
          const admin = await db.collection('users').findOne({ role: 'admin' });
          if (admin) {
            console.log(`🔑 Admin user found: [${admin.username}]`);
          }
        }
      }
    }

  } catch (err) {
    console.error("❌ Deep check failed:", err.message);
  } finally {
    await client.close();
  }
}

run();

const { MongoClient } = require('mongodb');

const uri = "mongodb+srv://gargabhi999:gargabhi999@crm.8eds5va.mongodb.net/spike_dms?appName=CRM";
const client = new MongoClient(uri);

async function run() {
  try {
    await client.connect();
    const db = client.db('spike_dms');
    console.log("📂 Checking database: [spike_dms]");
    
    const usersCount = await db.collection('users').countDocuments();
    const leadsCount = await db.collection('leads').countDocuments();
    const admin = await db.collection('users').findOne({ role: 'admin' });
    
    console.log(`👤 Users: ${usersCount}`);
    console.log(`📞 Leads: ${leadsCount}`);
    if (admin) console.log(`🔑 Admin Account: [${admin.username}]`);
    else console.log("⚠️ No Admin found in spike_dms!");

  } catch (err) {
    console.error("❌ Check failed:", err.message);
  } finally {
    await client.close();
  }
}

run();

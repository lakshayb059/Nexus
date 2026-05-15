const { MongoClient } = require('mongodb');
const bcrypt = require('bcryptjs');

const uri = "mongodb+srv://gargabhi999:gargabhi999@crm.8eds5va.mongodb.net/spike_dms?appName=CRM";
const client = new MongoClient(uri);

async function run() {
  try {
    await client.connect();
    const db = client.db('spike_dms');
    const users = db.collection('users');
    
    console.log("🔍 Looking for user 'admin'...");
    const user = await users.findOne({ username: 'admin' });
    
    if (!user) {
      console.log("❌ Admin not found! Seeding now...");
      const hashed = await bcrypt.hash('spikeCRM_2024!', 10);
      await users.insertOne({
        username: 'admin',
        password: hashed,
        name: 'System Admin',
        role: 'admin',
        active: true,
        createdAt: new Date()
      });
      console.log("✅ Admin seeded successfully!");
    } else {
      console.log("✅ Admin found! Checking password...");
      const valid = await bcrypt.compare('spikeCRM_2024!', user.password);
      console.log(valid ? "✅ Password Correct!" : "❌ Password Incorrect!");
    }
  } catch (err) {
    console.error("❌ Test failed:", err);
  } finally {
    await client.close();
  }
}

run();

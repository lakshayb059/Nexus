require('dotenv').config();
const { Client } = require('pg');

async function testConnection(url, name) {
  console.log(`🔌 Testing connection to ${name}...`);
  const client = new Client({
    connectionString: url,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log(`✅ SUCCESS: Connected to ${name}!`);
    const res = await client.query('SELECT NOW()');
    console.log(`⏰ Time on database: ${res.rows[0].now}`);
  } catch (err) {
    console.error(`❌ FAILED ${name}: `, err.message);
  } finally {
    await client.end();
  }
}

async function run() {
  const internalUrl = process.env.DATABASE_URL;
  // External url is the same, but replaces "-a.oregon-postgres" with ".oregon-postgres"
  const externalUrl = internalUrl.replace('-a.oregon-postgres', '.oregon-postgres');
  
  console.log(`Internal URL: ${internalUrl}`);
  console.log(`External URL: ${externalUrl}`);
  
  await testConnection(internalUrl, "INTERNAL URL");
  console.log("-----------------------------------------");
  await testConnection(externalUrl, "EXTERNAL URL");
}

run();

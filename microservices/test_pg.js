require('dotenv').config();
const { Client } = require('pg');

async function testConnection() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL.includes('sslmode=require') 
      ? process.env.DATABASE_URL 
      : `${process.env.DATABASE_URL}?sslmode=require`,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log("SUCCESS: Connected to pg!");
    const res = await client.query('SELECT NOW()');
    console.log(res.rows[0]);
  } catch (err) {
    console.error("FAILED: ", err.message);
  } finally {
    await client.end();
  }
}

testConnection();

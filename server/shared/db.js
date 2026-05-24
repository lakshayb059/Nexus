require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { Pool } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');

const pool = new Pool({ 
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 5,                     // Limit concurrent database connections
  idleTimeoutMillis: 30000,   // Close idle connections after 30 seconds
  connectionTimeoutMillis: 5000 // Return error if connection takes > 5 seconds
});

const adapter = new PrismaPg(pool);

let prisma;

if (process.env.NODE_ENV === 'production') {
  prisma = new PrismaClient({ adapter });
} else {
  if (!global.prisma) {
    global.prisma = new PrismaClient({ adapter });
  }
  prisma = global.prisma;
}

async function connect() {
  try {
    await prisma.$connect();
    console.log("✅ Connected to PostgreSQL Database via Prisma");
    return prisma;
  } catch (err) {
    console.error("❌ Prisma Connection Error:", err.message);
    throw err;
  }
}

function getDB() {
  return prisma;
}

module.exports = {
  connect,
  prisma,
  getDB
};

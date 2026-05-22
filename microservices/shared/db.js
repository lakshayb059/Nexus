require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { Pool } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
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

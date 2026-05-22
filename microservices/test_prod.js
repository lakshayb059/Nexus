require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

async function main() {
  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: process.env.DATABASE_URL + '?sslmode=require'
      }
    }
  });

  try {
    console.log('Connecting to Prisma...');
    const apps = await prisma.appointment.findMany({ take: 1 });
    console.log('Appointments OK:', apps.length);
    const cbs = await prisma.callback.findMany({ take: 1 });
    console.log('Callbacks OK:', cbs.length);
  } catch (err) {
    console.error('Error fetching data:', err);
  } finally {
    await prisma.$disconnect();
  }
}

main();

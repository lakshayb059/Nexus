require('dotenv').config();
const { prisma, connect } = require('./shared/db');

async function run() {
  await connect();
  const admins = await prisma.user.findMany({ where: { role: 'admin' } });
  console.log(JSON.stringify(admins, null, 2));
  await prisma.$disconnect();
}
run();

const axios = require('axios');
const { PrismaClient } = require('@prisma/client');
const { Pool } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');
require('dotenv').config({ path: 'e:/CRM new/microservices/.env' });

async function test() {
  const pool = new Pool({ connectionString: 'postgresql://crm_mroc_user:VH09W1Hs1DNU74tTGc9RHA7puAUXXtlr@dpg-d880i5pkh4rs73c7vdlg-a.oregon-postgres.render.com/crm_mroc?sslmode=require' });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  try {
    // 1. Create a fake user and contact
    const user = await prisma.user.create({
      data: {
        username: 'testagent_' + Date.now(),
        password: 'pwd',
        name: 'Test Agent',
        role: 'agent'
      }
    });

    const contact = await prisma.contact.create({
      data: {
        assignedTo: user.id,
        fields: { Name: 'Test Contact', Phone: '1234567890' }
      }
    });

    // 2. Generate JWT for user
    const jwt = require('jsonwebtoken');
    const token = jwt.sign(
      { _id: user.id, id: user.id, username: user.username, name: user.name, role: user.role },
      process.env.JWT_SECRET || 'crm-super-secret-jwt-key-2024-change-in-production-use-strong-random-string'
    );

    // 3. Start lead service (we'll just call the logic directly or via http)
    console.log(`User: ${user.id}, Contact: ${contact.id}`);
    
    // Trigger via axios to local server if it's running
    const res = await axios.post(`http://localhost:3002/contacts/${contact.id}/dispose`, {
      disposition: 'Lead',
      remarks: 'Test Lead',
      leadAmount: 100
    }, {
      headers: { Authorization: `Bearer ${token}` }
    });
    console.log('Success:', res.data);
  } catch (err) {
    if (err.response) console.error('Error from server:', err.response.data);
    else console.error('Error:', err.message);
  } finally {
    await prisma.$disconnect();
  }
}

test();

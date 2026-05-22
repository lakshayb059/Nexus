require('dotenv').config();
const { prisma } = require('./shared/db');
const { sign } = require('./shared/authMiddleware');
const axios = require('axios');

async function test() {
  try {
    const agent = await prisma.user.findFirst({ where: { role: 'agent' } });
    if (!agent) { console.log('No agent found'); return; }

    const token = sign({ _id: agent.id, id: agent.id, role: agent.role, name: agent.name, username: agent.username });
    
    console.log('Testing appointments for', agent.name);
    try {
      const res = await axios.get('http://localhost:3002/leads/appointments', {
        headers: { Authorization: `Bearer ${token}` }
      });
      console.log('Appointments OK:', res.data.length);
    } catch (e) {
      console.log('Appointments Error:', e.response?.data || e.message);
    }

    console.log('Testing callbacks for', agent.name);
    try {
      const res = await axios.get('http://localhost:3002/leads/callbacks', {
        headers: { Authorization: `Bearer ${token}` }
      });
      console.log('Callbacks OK:', res.data.length);
    } catch (e) {
      console.log('Callbacks Error:', e.response?.data || e.message);
    }
  } finally {
    await prisma.$disconnect();
  }
}
test();

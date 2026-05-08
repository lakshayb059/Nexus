const { connect, getCollection, close } = require('./mongodb');
const { ObjectId } = require('mongodb');

async function testAdminFetch() {
  try {
    await connect();
    const contactsCollection = getCollection('contacts');
    const usersCollection = getCollection('users');
    
    console.log('Testing Admin fetch...');
    const filters = {};
    const query = { ...filters };
    query.isDeleted = { $ne: true };
    
    console.log('Query:', JSON.stringify(query));
    
    const contacts = await contactsCollection.find(query).sort({ queueOrder: 1, createdAt: 1 }).toArray();
    console.log('Contacts found:', contacts.length);
    
    if (contacts.length > 0) {
      const assignedToIds = [...new Set(contacts.map(c => c.assignedTo).filter(Boolean))];
      console.log('Unique assignedTo IDs:', assignedToIds.map(id => id.toString()));
      
      const agents = await usersCollection.find(
        { _id: { $in: assignedToIds } },
        { projection: { _id: 1, name: 1 } }
      ).toArray();
      console.log('Agents found for enrichment:', agents.length);
      
      const userMap = agents.reduce((acc, agent) => {
        acc[agent._id.toString()] = agent.name;
        return acc;
      }, {});
      
      const enriched = contacts.map(c => ({
        ...c,
        agentName: userMap[c.assignedTo?.toString()] || 'Unknown'
      }));
      console.log('First enriched contact agentName:', enriched[0].agentName);
    }

  } catch (err) {
    console.error(err);
  } finally {
    await close();
  }
}

testAdminFetch();

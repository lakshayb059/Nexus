const { connect, getCollection, close } = require('./mongodb');

async function listAllLeads() {
  try {
    await connect();
    const leads = await getCollection('leads').find({}).toArray();
    console.log(`Total leads: ${leads.length}`);
    leads.forEach((l, i) => {
      console.log(`Lead ${i+1}: Name: ${l.fields?.Name || l.fields?.name}, Phone: ${l.fields?.Phone || l.fields?.phone || l.fields?.Mobile}`);
    });
  } catch (err) {
    console.error(err);
  } finally {
    await close();
  }
}

listAllLeads();

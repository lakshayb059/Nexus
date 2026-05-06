const { connect, getCollection, close } = require('./mongodb');

async function checkTypes() {
  try {
    await connect();
    const leads = await getCollection('leads').find({}).toArray();
    leads.forEach((l, i) => {
      const p = l.fields?.Phone || l.fields?.phone || l.fields?.Mobile;
      console.log(`Lead ${i+1}: Phone: ${p} (Type: ${typeof p})`);
    });
  } catch (err) {
    console.error(err);
  } finally {
    await close();
  }
}

checkTypes();

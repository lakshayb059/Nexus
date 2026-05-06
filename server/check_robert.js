const { connect, getCollection, close } = require('./mongodb');

async function checkRobert() {
  try {
    await connect();
    const phone = '7766554433';
    const leads = await getCollection('leads').find({
      $or: [
        { "fields.Phone": { $regex: phone } },
        { "fields.phone": { $regex: phone } },
        { "fields.Mobile": { $regex: phone } }
      ]
    }).toArray();
    
    console.log(`Leads for ${phone}:`, leads.length);
    leads.forEach((l, i) => {
      console.log(`Lead ${i+1}:`, JSON.stringify(l, null, 2));
    });
  } catch (err) {
    console.error(err);
  } finally {
    await close();
  }
}

checkRobert();

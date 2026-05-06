const { connect, getCollection, close } = require('./mongodb');

async function checkRobert() {
  try {
    await connect();
    const rawPhone = '7766554433';
    const last10 = rawPhone.replace(/\D/g, '').slice(-10);
    const regexPattern = last10.split('').join('[^0-9]*');
    const phoneRegex = new RegExp(regexPattern);

    const matchQuery = {
      $or: [
        { "fields.Phone": { $regex: phoneRegex } },
        { "fields.phone": { $regex: phoneRegex } },
        { "fields.Mobile": { $regex: phoneRegex } },
        { "fields.Phone": { $regex: new RegExp(last10) } },
        { "fields.phone": { $regex: new RegExp(last10) } },
        { "fields.Mobile": { $regex: new RegExp(last10) } }
      ]
    };

    const history = await getCollection('leads').find(matchQuery).sort({ createdAt: -1 }).toArray();
    
    console.log(`History for ${rawPhone}:`, history.length);
    history.forEach((h, i) => {
      console.log(`Record ${i+1}: Name: ${h.fields?.Name || h.fields?.name}, Date: ${h.createdAt}`);
    });
  } catch (err) {
    console.error(err);
  } finally {
    await close();
  }
}

checkRobert();

const { connect, getCollection } = require('../mongodb');
const { consolidateCallbacks } = require('../utils/callbackUtils');

async function run() {
  try {
    console.log('🚀 Starting global callback cleanup...');
    await connect();
    const callbacksCollection = getCollection('callbacks');
    const callbacks = await callbacksCollection.find({}).toArray();
    const phones = new Set();
    
    for (const cb of callbacks) {
      const phone = cb.fields?.Phone || cb.fields?.phone || cb.fields?.Mobile;
      if (phone) phones.add(phone);
    }
    
    console.log(`🔍 Found ${phones.size} unique phone numbers with callbacks.`);
    
    let processed = 0;
    for (const phone of phones) {
      await consolidateCallbacks(phone);
      processed++;
      if (processed % 10 === 0) console.log(`⏳ Processed ${processed}/${phones.size}...`);
    }
    
    console.log('✅ Global callback cleanup complete!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Cleanup failed:', error);
    process.exit(1);
  }
}

run();

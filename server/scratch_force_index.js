const { connect, close } = require('./mongodb');

async function runIndexing() {
  try {
    await connect();
    console.log('Indexing should have run during connect().');
  } catch (err) {
    console.error('Indexing failed:', err);
  } finally {
    await close();
  }
}

runIndexing();

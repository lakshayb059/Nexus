require('dotenv').config();
const { sendConversionEmail } = require('./shared/emailService');

async function test() {
  console.log('Sending test email...');
  const result = await sendConversionEmail(
    'garg.abhi999@gmail.com',
    'wfwoqaqetzjgrcej',
    'garg.abhi999@gmail.com',
    'CRM Test',
    {
      leadName: 'Test Lead',
      contact: '1234567890',
      agentName: 'Test Agent',
      tlName: 'Test TL',
      adminName: 'Test Admin',
      amount: '5000',
      transactionId: 'TXN123'
    }
  );
  console.log('Result:', result);
}
test();

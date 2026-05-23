const { prisma, connect } = require('./shared/db');
const { triggerConversionEmail } = require('./shared/triggerConversionEmail');

const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true,
  auth: {
    user: 'Lakshayb057@gmail.com',
    pass: 'ocht uiyj enjd ojbl'
  }
});

async function run() {
  try {
    await connect();
    const contact = await prisma.contact.findFirst({
      where: { status: 'Converted' },
      orderBy: { createdAt: 'desc' }
    });
    if (contact) {
      console.log('Testing trigger with contact:', contact.id);
      await triggerConversionEmail(contact.id, null);
    } else {
      console.log('No converted contact found');
    }
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await prisma.$disconnect();
  }
}

run();

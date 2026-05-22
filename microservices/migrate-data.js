const { MongoClient } = require('mongodb');
const { prisma } = require('./shared/db');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://gargabhi999:gargabhi999@crm.8eds5va.mongodb.net/?appName=CRM';
const DB_NAME = 'test';

async function migrateData() {
  console.log('🚀 Starting Data Migration from MongoDB to PostgreSQL...');

  const mongoClient = new MongoClient(MONGODB_URI);

  try {
    await mongoClient.connect();
    console.log('✅ Connected to MongoDB');

    const db = mongoClient.db(DB_NAME);

    // 1. Migrate Users
    console.log('📦 Migrating Users...');
    const users = await db.collection('users').find({}).toArray();
    for (const user of users) {
      const data = {
        id: user._id.toString(),
        username: user.username,
        password: user.password,
        name: user.name || null,
        role: user.role || 'agent',
        tlId: user.tlId ? user.tlId.toString() : null,
        adminId: user.adminId ? user.adminId.toString() : null,
        active: user.active !== undefined ? user.active : true,
        createdAt: user.createdAt || new Date()
      };
      await prisma.user.upsert({
        where: { id: data.id },
        update: data,
        create: data
      });
    }
    console.log(`✅ Migrated ${users.length} Users`);

    // 2. Migrate Batches
    console.log('📦 Migrating Batches...');
    const batches = await db.collection('batches').find({}).toArray();
    for (const batch of batches) {
      const data = {
        id: batch._id.toString(),
        name: batch.name || `Batch ${batch._id.toString()}`,
        adminId: batch.adminId ? batch.adminId.toString() : null,
        totalContacts: batch.totalContacts || 0,
        createdAt: batch.createdAt || new Date()
      };
      await prisma.batch.upsert({
        where: { id: data.id },
        update: data,
        create: data
      });
    }
    console.log(`✅ Migrated ${batches.length} Batches`);

    // 3. Migrate Contacts
    console.log('📦 Migrating Contacts...');
    const contacts = await db.collection('contacts').find({}).toArray();
    for (const contact of contacts) {
      const data = {
        id: contact._id.toString(),
        fields: contact.fields || {},
        batchId: contact.batchId || null,
        assignedTo: contact.assignedTo ? contact.assignedTo.toString() : null,
        agentName: contact.agentName || null,
        disposition: contact.disposition || null,
        status: contact.status || null,
        remarks: contact.remarks || null,
        callBackDt: contact.callBackDt || null,
        appointmentDt: contact.appointmentDt || null,
        leadAmount: contact.leadAmount || 0,
        transactionId: contact.transactionId || null,
        statusDetails: contact.statusDetails || null,
        queueOrder: contact.queueOrder || 999999,
        rechurnCount: contact.rechurnCount || 0,
        lastCallAttempt: contact.lastCallAttempt || null,
        isDeleted: contact.isDeleted || false,
        conversionDate: contact.conversionDate || null,
        disposedBy: contact.disposedBy ? contact.disposedBy.toString() : null,
        disposedAt: contact.disposedAt || null,
        adminId: contact.adminId ? contact.adminId.toString() : null,
        reminderSent: contact.reminderSent || false,
        lateNotified: contact.lateNotified || false,
        cbReminderSent: contact.cbReminderSent || false,
        createdAt: contact.createdAt || new Date(),
        lastModified: contact.lastModified || new Date()
      };
      await prisma.contact.upsert({
        where: { id: data.id },
        update: data,
        create: data
      });
    }
    console.log(`✅ Migrated ${contacts.length} Contacts`);

    // 4. Migrate Leads
    console.log('📦 Migrating Leads...');
    const leads = await db.collection('leads').find({}).toArray();
    for (const lead of leads) {
      const data = {
        id: lead._id.toString(),
        contactId: lead.contactId ? lead.contactId.toString() : null,
        fields: lead.fields || {},
        batchId: lead.batchId || null,
        assignedTo: lead.assignedTo ? lead.assignedTo.toString() : null,
        agentName: lead.agentName || null,
        leadAmount: lead.leadAmount || 0,
        status: lead.status || 'Pending',
        remarks: lead.remarks || null,
        transactionId: lead.transactionId || null,
        statusDetails: lead.statusDetails || null,
        adminId: lead.adminId ? lead.adminId.toString() : null,
        createdAt: lead.createdAt || new Date(),
        lastModified: lead.lastModified || new Date()
      };
      await prisma.lead.upsert({
        where: { id: data.id },
        update: data,
        create: data
      });
    }
    console.log(`✅ Migrated ${leads.length} Leads`);

    // 5. Migrate Appointments
    console.log('📦 Migrating Appointments...');
    const appointments = await db.collection('appointments').find({}).toArray();
    for (const appt of appointments) {
      const data = {
        id: appt._id.toString(),
        contactId: appt.contactId ? appt.contactId.toString() : null,
        fields: appt.fields || {},
        batchId: appt.batchId || null,
        assignedTo: appt.assignedTo ? appt.assignedTo.toString() : null,
        agentName: appt.agentName || null,
        appointmentDt: appt.appointmentDt || null,
        remarks: appt.remarks || null,
        adminId: appt.adminId ? appt.adminId.toString() : null,
        createdAt: appt.createdAt || new Date(),
        lastModified: appt.lastModified || new Date()
      };
      await prisma.appointment.upsert({
        where: { id: data.id },
        update: data,
        create: data
      });
    }
    console.log(`✅ Migrated ${appointments.length} Appointments`);

    // 6. Migrate Callbacks
    console.log('📦 Migrating Callbacks...');
    const callbacks = await db.collection('callbacks').find({}).toArray();
    for (const cb of callbacks) {
      const data = {
        id: cb._id.toString(),
        contactId: cb.contactId ? cb.contactId.toString() : null,
        fields: cb.fields || {},
        batchId: cb.batchId || null,
        assignedTo: cb.assignedTo ? cb.assignedTo.toString() : null,
        agentName: cb.agentName || null,
        callBackDt: cb.callBackDt || null,
        remarks: cb.remarks || null,
        status: cb.status || null,
        source: cb.source || null,
        adminId: cb.adminId ? cb.adminId.toString() : null,
        createdAt: cb.createdAt || new Date(),
        lastModified: cb.lastModified || new Date()
      };
      await prisma.callback.upsert({
        where: { id: data.id },
        update: data,
        create: data
      });
    }
    console.log(`✅ Migrated ${callbacks.length} Callbacks`);

    console.log('🎉 Migration Completed Successfully!');

  } catch (error) {
    console.error('❌ Migration Failed:', error);
  } finally {
    await mongoClient.close();
    await prisma.$disconnect();
  }
}

migrateData();

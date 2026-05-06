const { getCollection } = require('../mongodb');
const { ObjectId } = require('mongodb');

class AppointmentService {
  constructor(io) {
    this.io = io;
    this.reminderInterval = null;
    this.checkInterval = 60 * 1000; // Check every 1 minute for better accuracy
  }

  start() {
    console.log('📅 Appointment service started');

    // Check immediately on start
    this.checkAppointments();
    this.checkCallbacks();

    // Set up recurring checks
    this.reminderInterval = setInterval(() => {
      this.checkAppointments();
      this.checkCallbacks();
    }, this.checkInterval);
  }

  stop() {
    if (this.reminderInterval) {
      clearInterval(this.reminderInterval);
      this.reminderInterval = null;
      console.log('📅 Appointment service stopped');
    }
  }

  async checkAppointments() {
    try {
      const contactsCollection = getCollection('contacts');
      const now = new Date();

      // 1. Check for upcoming appointments (within next 2 minutes)
      const upcoming = await contactsCollection.find({
        disposition: 'Appointment',
        appointmentDt: {
          $gte: now,
          $lte: new Date(now.getTime() + 2 * 60 * 1000)
        },
        reminderSent: { $ne: true }
      }).toArray();

      for (const app of upcoming) {
        const diff = new Date(app.appointmentDt) - now;
        const mins = Math.max(0, Math.round(diff / (1000 * 60)));
        await this.sendReminder(app, mins, 'upcoming');
      }

      // 2. Check for "LATE" appointments (missed by ~1 minute)
      const late = await contactsCollection.find({
        disposition: 'Appointment',
        appointmentDt: {
          $lte: new Date(now.getTime() - 60 * 1000), // Past due by 1 min
          $gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) // Within last 24h
        },
        lateNotified: { $ne: true }
      }).toArray();

      for (const app of late) {
        await this.sendReminder(app, -1, 'late');
      }

    } catch (error) {
      console.error('Appointment check error:', error);
    }
  }

  async checkCallbacks() {
    try {
      const contactsCollection = getCollection('contacts');
      const now = new Date();

      // 1. Auto-requeue is DISABLED by user request. 
      // Callbacks will now remain on the Callbacks page until explicitly added to the workflow by an agent.

      // 2. Pre-notification (2 minutes before)
      const upcoming = await contactsCollection.find({
        disposition: 'CallBack',
        callBackDt: {
          $gte: now,
          $lte: new Date(now.getTime() + 2 * 60 * 1000)
        },
        cbReminderSent: { $ne: true }
      }).toArray();

      for (const cb of upcoming) {
        if (this.io) {
          this.io.emit('callback_reminder', {
            contactId: cb._id,
            contactName: cb.fields?.Name || cb.fields?.name || 'Unknown',
            agentId: cb.assignedTo.toString(),
            callBackDt: cb.callBackDt,
            minutesUntil: 2
          });
        }
        await contactsCollection.updateOne({ _id: cb._id }, { $set: { cbReminderSent: true } });
      }

    } catch (error) {
      console.error('Callback check error:', error);
    }
  }

  async sendReminder(appointment, minutesUntil, type = 'upcoming') {
    try {
      const contactsCollection = getCollection('contacts');
      const usersCollection = getCollection('users');

      const agent = await usersCollection.findOne({ _id: appointment.assignedTo });
      if (!agent) return;

      const update = type === 'late' ? { lateNotified: true } : { reminderSent: true, reminderSentAt: new Date() };

      await contactsCollection.updateOne({ _id: appointment._id }, { $set: update });

        if (this.io) {
          this.io.emit('appointment_reminder', {
            appointmentId: appointment._id,
            contactName: appointment.fields?.Name || appointment.fields?.name || 'Unknown',
            appointmentTime: appointment.appointmentDt,
            minutesUntil,
            type, // 'upcoming' or 'late'
            agentId: agent._id.toString(),
            agentName: agent.name,
            contactPhone: appointment.fields?.Phone || appointment.fields?.Mobile || 'N/A'
          });
        }
    } catch (error) {
      console.error('Send reminder error:', error);
    }
  }

  async scheduleAppointment(contactId, appointmentDt, agentId) {
    try {
      const contactsCollection = getCollection('contacts');
      const update = {
        disposition: 'Appointment',
        appointmentDt: new Date(appointmentDt),
        appointmentStatus: 'scheduled',
        reminderSent: false,
        lateNotified: false,
        queueOrder: 999999,
        lastModified: new Date()
      };
      await contactsCollection.updateOne({ _id: new ObjectId(contactId) }, { $set: update });
      if (this.io) {
        this.io.emit('appointment_scheduled', { contactId, appointmentDt: update.appointmentDt, agentId });
      }
      return { success: true, appointment: update.appointmentDt };
    } catch (error) {
      console.error('Schedule appointment error:', error);
      throw error;
    }
  }

  // ... other methods omitted for brevity as they are standard CRUD
  async cancelAppointment(contactId, reason = '') {
    try {
      const contactsCollection = getCollection('contacts');
      const update = {
        disposition: 'CallBack',
        appointmentDt: null,
        appointmentStatus: 'cancelled',
        callBackDt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        queueOrder: 999999,
        lastModified: new Date(),
        remarks: reason ? `[Cancelled: ${reason}]` : '[Appointment cancelled]'
      };
      await contactsCollection.updateOne({ _id: new ObjectId(contactId) }, { $set: update });
      return { success: true };
    } catch (error) { throw error; }
  }
}

module.exports = AppointmentService;

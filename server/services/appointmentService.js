const { getCollection } = require('../mongodb');
const { ObjectId } = require('mongodb');

class AppointmentService {
  constructor(io) {
    this.io = io;
    this.reminderInterval = null;
    this.checkInterval = 5 * 60 * 1000; // Check every 5 minutes
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
      const usersCollection = getCollection('users');
      const now = new Date();
      
      // Check for appointments within the next 30 minutes
      const upcomingAppointments = await contactsCollection.find({
        disposition: 'Appointment',
        appointmentDt: { 
          $gte: now,
          $lte: new Date(now.getTime() + 30 * 60 * 1000) // 30 minutes window
        },
        reminderSent: { $ne: true } // Only if reminder not sent
      }).toArray();

      for (const appointment of upcomingAppointments) {
        const timeUntilAppointment = new Date(appointment.appointmentDt) - now;
        const minutesUntil = Math.floor(timeUntilAppointment / (1000 * 60));

        // Send reminder if within 30 minutes
        if (minutesUntil <= 30 && minutesUntil > 0) {
          await this.sendReminder(appointment, minutesUntil);
        }
      }

      // Check for overdue appointments to reschedule
      const overdueAppointments = await contactsCollection.find({
        disposition: 'Appointment',
        appointmentDt: { $lt: now },
        appointmentStatus: { $ne: 'overdue' }
      }).toArray();

      for (const appointment of overdueAppointments) {
        await this.handleOverdueAppointment(appointment);
      }

    } catch (error) {
      console.error('Appointment check error:', error);
    }
  }

  async checkCallbacks() {
    try {
      const contactsCollection = getCollection('contacts');
      const now = new Date();
      
      // Find due callbacks that are still at order 999999
      const dueCallbacks = await contactsCollection.find({
        disposition: 'CallBack',
        callBackDt: { $lte: now },
        queueOrder: 999999
      }).toArray();

      for (const callback of dueCallbacks) {
        // Reset to queue order 0 (top of queue)
        await contactsCollection.updateOne(
          { _id: callback._id },
          { 
            $set: { 
              queueOrder: 0, 
              lastModified: new Date(),
              remarks: (callback.remarks || '') + ' [Callback due - auto re-queued]'
            } 
          }
        );

        // Notify agent via socket
        if (this.io) {
          this.io.emit('callback_due', {
            contactId: callback._id,
            contactName: callback.fields?.Name || callback.fields?.name || 'Unknown',
            agentId: callback.assignedTo,
            callBackDt: callback.callBackDt
          });
        }
      }

      if (dueCallbacks.length > 0) {
        console.log(`📅 Auto re-queued ${dueCallbacks.length} callbacks`);
      }

    } catch (error) {
      console.error('Callback check error:', error);
    }
  }

  async sendReminder(appointment, minutesUntil) {
    try {
      const contactsCollection = getCollection('contacts');
      const usersCollection = getCollection('users');
      
      // Get agent details
      const agent = await usersCollection.findOne({ _id: appointment.assignedTo });
      
      if (!agent) return;

      // Mark reminder as sent
      await contactsCollection.updateOne(
        { _id: appointment._id },
        { 
          $set: { 
            reminderSent: true,
            reminderSentAt: new Date()
          } 
        }
      );

      // Send real-time notification to agent
      if (this.io) {
        this.io.emit('appointment_reminder', {
          appointmentId: appointment._id,
          contactName: appointment.fields?.Name || appointment.fields?.name || 'Unknown',
          appointmentTime: appointment.appointmentDt,
          minutesUntil,
          agentId: agent._id,
          agentName: agent.name,
          contactPhone: appointment.fields?.Phone || appointment.fields?.Mobile || 'N/A'
        });
      }

      console.log(`📅 Reminder sent to ${agent.name} for appointment in ${minutesUntil} minutes`);

    } catch (error) {
      console.error('Send reminder error:', error);
    }
  }

  async handleOverdueAppointment(appointment) {
    try {
      const contactsCollection = getCollection('contacts');
      
      // Mark as overdue and move to callback queue
      await contactsCollection.updateOne(
        { _id: appointment._id },
        { 
          $set: { 
            appointmentStatus: 'overdue',
            disposition: 'CallBack',
            callBackDt: new Date(Date.now() + 2 * 60 * 60 * 1000), // 2 hours from now
            queueOrder: 999999,
            lastModified: new Date(),
            remarks: (appointment.remarks || '') + ' [Appointment missed - auto rescheduled]'
          } 
        }
      );

      // Send notification
      if (this.io) {
        this.io.emit('appointment_overdue', {
          appointmentId: appointment._id,
          contactName: appointment.fields?.Name || appointment.fields?.name || 'Unknown',
          originalAppointmentTime: appointment.appointmentDt,
          rescheduledFor: new Date(Date.now() + 2 * 60 * 60 * 1000)
        });
      }

      console.log(`📅 Overdue appointment handled: ${appointment._id}`);

    } catch (error) {
      console.error('Handle overdue appointment error:', error);
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
        queueOrder: 999999,
        lastModified: new Date()
      };

      await contactsCollection.updateOne(
        { _id: new ObjectId(contactId) },
        { $set: update }
      );

      if (this.io) {
        this.io.emit('appointment_scheduled', {
          contactId,
          appointmentDt: update.appointmentDt,
          agentId
        });
      }

      return { success: true, appointment: update.appointmentDt };

    } catch (error) {
      console.error('Schedule appointment error:', error);
      throw error;
    }
  }

  async rescheduleAppointment(contactId, newAppointmentDt, reason = '') {
    try {
      const contactsCollection = getCollection('contacts');
      
      const update = {
        appointmentDt: new Date(newAppointmentDt),
        appointmentStatus: 'rescheduled',
        reminderSent: false,
        lastModified: new Date(),
        remarks: reason ? `[Rescheduled: ${reason}]` : '[Rescheduled]'
      };

      await contactsCollection.updateOne(
        { _id: new ObjectId(contactId) },
        { $set: update }
      );

      if (this.io) {
        this.io.emit('appointment_rescheduled', {
          contactId,
          newAppointmentDt: update.appointmentDt,
          reason
        });
      }

      return { success: true, appointment: update.appointmentDt };

    } catch (error) {
      console.error('Reschedule appointment error:', error);
      throw error;
    }
  }

  async cancelAppointment(contactId, reason = '') {
    try {
      const contactsCollection = getCollection('contacts');
      
      const update = {
        disposition: 'CallBack',
        appointmentDt: null,
        appointmentStatus: 'cancelled',
        callBackDt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours from now
        queueOrder: 999999,
        lastModified: new Date(),
        remarks: reason ? `[Cancelled: ${reason}]` : '[Appointment cancelled]'
      };

      await contactsCollection.updateOne(
        { _id: new ObjectId(contactId) },
        { $set: update }
      );

      if (this.io) {
        this.io.emit('appointment_cancelled', {
          contactId,
          reason
        });
      }

      return { success: true };

    } catch (error) {
      console.error('Cancel appointment error:', error);
      throw error;
    }
  }

  async getUpcomingAppointments(agentId = null, timeWindow = 60) {
    try {
      const contactsCollection = getCollection('contacts');
      const now = new Date();
      
      let query = {
        disposition: 'Appointment',
        appointmentDt: { 
          $gte: now,
          $lte: new Date(now.getTime() + timeWindow * 60 * 1000)
        }
      };

      if (agentId) {
        query.assignedTo = new ObjectId(agentId);
      }

      const appointments = await contactsCollection.find(query)
        .sort({ appointmentDt: 1 })
        .toArray();

      return appointments;

    } catch (error) {
      console.error('Get upcoming appointments error:', error);
      throw error;
    }
  }
}

module.exports = AppointmentService;

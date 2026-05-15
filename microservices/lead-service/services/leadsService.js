const { getCollection } = require('../../shared/mongodb');
const { ObjectId } = require('mongodb');
const { consolidateCallbacks, cleanupAllCallbacks } = require('../../shared/callbackUtils');

class LeadsService {
  constructor(io) {
    this.io = io;
  }

  async getNextContact(agentId) {
    try {
      const contactsCollection = getCollection('contacts');
      const now = new Date();
      
      const dueCallbacks = await contactsCollection.find({
        assignedTo: new ObjectId(agentId),
        disposition: 'CallBack',
        callBackDt: { $lte: now },
        queueOrder: { $lt: 999999 }
      }).sort({ callBackDt: 1 }).limit(1).toArray();

      if (dueCallbacks.length > 0) {
        await contactsCollection.updateOne(
          { _id: dueCallbacks[0]._id },
          { $set: { queueOrder: 0, callBackDt: null } }
        );
        return {
          contact: dueCallbacks[0],
          type: 'callback_due',
          message: 'Callback due - recalling now'
        };
      }

      const nextContact = await contactsCollection.findOne({
        assignedTo: new ObjectId(agentId),
        queueOrder: { $lt: 999999 },
        $or: [
          { disposition: null },
          { disposition: 'CallNotAnswered' }
        ]
      }).sort({ queueOrder: 1, createdAt: 1 });

      return {
        contact: nextContact || null,
        queueStats: await this.getQueueStats(agentId)
      };
    } catch (error) {
      console.error('Get next contact error:', error);
      throw error;
    }
  }

  async getQueueStats(agentId) {
    try {
      const contactsCollection = getCollection('contacts');
      const stats = await contactsCollection.aggregate([
        { $match: { assignedTo: new ObjectId(agentId) } },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            pending: {
              $sum: {
                $cond: [
                  { $or: [{ $eq: ['$disposition', null] }, { $eq: ['$disposition', 'CallNotAnswered'] }] },
                  1, 0
                ]
              }
            },
            disposed: {
              $sum: {
                $cond: [
                  { $and: [{ $ne: ['$disposition', null] }, { $ne: ['$disposition', 'CallNotAnswered'] }] },
                  1, 0
                ]
              }
            }
          }
        }
      ]).toArray();
      return stats[0] || { total: 0, pending: 0, disposed: 0 };
    } catch (error) {
      return { total: 0, pending: 0, disposed: 0 };
    }
  }
}

module.exports = LeadsService;

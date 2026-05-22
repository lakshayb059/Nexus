const { prisma } = require('../../shared/db');
const { consolidateCallbacks, cleanupAllCallbacks } = require('../../shared/callbackUtils');

class LeadsService {
  constructor(io) {
    this.io = io;
  }

  async getNextContact(agentId) {
    try {
      const now = new Date();
      
      const dueCallbacks = await prisma.contact.findMany({
        where: {
          assignedTo: agentId,
          disposition: 'CallBack',
          callBackDt: { lte: now },
          queueOrder: { lt: 999999 }
        },
        orderBy: { callBackDt: 'asc' },
        take: 1
      });

      if (dueCallbacks.length > 0) {
        await prisma.contact.update({
          where: { id: dueCallbacks[0].id },
          data: { queueOrder: 0, callBackDt: null }
        });
        return {
          contact: dueCallbacks[0],
          type: 'callback_due',
          message: 'Callback due - recalling now'
        };
      }

      const nextContact = await prisma.contact.findFirst({
        where: {
          assignedTo: agentId,
          queueOrder: { lt: 999999 },
          OR: [
            { disposition: null },
            { disposition: 'CallNotAnswered' }
          ]
        },
        orderBy: [
          { queueOrder: 'asc' },
          { createdAt: 'asc' }
        ]
      });

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
      const [total, pending] = await Promise.all([
        prisma.contact.count({
          where: { assignedTo: agentId }
        }),
        prisma.contact.count({
          where: {
            assignedTo: agentId,
            OR: [
              { disposition: null },
              { disposition: 'CallNotAnswered' }
            ]
          }
        })
      ]);

      return {
        total,
        pending,
        disposed: total - pending
      };
    } catch (error) {
      return { total: 0, pending: 0, disposed: 0 };
    }
  }
}

module.exports = LeadsService;

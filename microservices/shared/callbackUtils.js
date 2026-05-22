const { prisma } = require('./db');

function normalizePhone(phone) {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

async function consolidateCallbacks(phoneNum) {
  if (!phoneNum) return;
  const normalized = normalizePhone(phoneNum);
  if (!normalized) return;

  try {
    // In Prisma, searching JSON fields with Regex is not natively supported without raw queries.
    // For this migration, we will fetch callbacks that have fields and filter in memory, 
    // or we'd ideally use a raw query. Since we want a robust Prisma way, we'll fetch recently created callbacks.
    // To avoid fetching all, we might fetch callbacks from the last few days, but to be safe we fetch all 
    // (which might be inefficient, so let's try a raw query or just fetch those where contactId is known).
    // Actually, Prisma postgres raw query for JSON:
    
    const allCallbacks = await prisma.callback.findMany({
      orderBy: { createdAt: 'desc' }
    });

    const matchingCallbacks = allCallbacks.filter(cb => {
      const f = cb.fields || {};
      const p = f.Phone || f.phone || f.Mobile;
      if (!p) return false;
      return String(p).endsWith(normalized);
    });

    if (matchingCallbacks.length <= 1) return;

    const newestCb = matchingCallbacks[0];
    const olderCbs = matchingCallbacks.slice(1);

    let mergedRemarks = newestCb.remarks || '';
    for (const cb of olderCbs) {
      if (cb.remarks && !mergedRemarks.includes(cb.remarks)) {
        mergedRemarks += ` | [Older CB Remark: ${cb.remarks}]`;
      }
    }

    await prisma.callback.update({
      where: { id: newestCb.id },
      data: { remarks: mergedRemarks, lastModified: new Date() }
    });

    if (newestCb.contactId) {
      await prisma.contact.update({
        where: { id: newestCb.contactId },
        data: { remarks: mergedRemarks, lastModified: new Date() }
      });
    }

    const callbackIdsToDelete = olderCbs.map(cb => cb.id);
    const contactIdsToDelete = olderCbs.map(cb => cb.contactId).filter(id => id && String(id) !== String(newestCb.contactId));

    if (callbackIdsToDelete.length > 0) {
      await prisma.callback.deleteMany({ where: { id: { in: callbackIdsToDelete } } });
    }
    if (contactIdsToDelete.length > 0) {
      await prisma.contact.deleteMany({ where: { id: { in: contactIdsToDelete } } });
    }
  } catch (error) {
    console.error(`[CONSOLIDATE] Error:`, error);
  }
}

async function cleanupAllCallbacks(phoneNum) {
  if (!phoneNum) return;
  const normalized = normalizePhone(phoneNum);
  if (!normalized) return;

  try {
    const allCallbacks = await prisma.callback.findMany();

    const matchingCallbacks = allCallbacks.filter(cb => {
      const f = cb.fields || {};
      const p = f.Phone || f.phone || f.Mobile;
      if (!p) return false;
      return String(p).endsWith(normalized);
    });

    if (matchingCallbacks.length === 0) return;

    const callbackIds = matchingCallbacks.map(cb => cb.id);
    const contactIds = matchingCallbacks.map(cb => cb.contactId).filter(Boolean);

    if (callbackIds.length > 0) {
      await prisma.callback.deleteMany({ where: { id: { in: callbackIds } } });
    }
    if (contactIds.length > 0) {
      await prisma.contact.deleteMany({ where: { id: { in: contactIds } } });
    }
  } catch (error) {
    console.error(`[CLEANUP] Error:`, error);
  }
}

module.exports = {
  normalizePhone,
  consolidateCallbacks,
  cleanupAllCallbacks
};

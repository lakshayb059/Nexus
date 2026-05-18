const { getCollection } = require('./mongodb');
const { ObjectId } = require('mongodb');

function normalizePhone(phone) {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

async function consolidateCallbacks(phoneNum) {
  if (!phoneNum) return;
  const normalized = normalizePhone(phoneNum);
  if (!normalized) return;

  try {
    const callbacksCollection = getCollection('callbacks');
    const contactsCollection = getCollection('contacts');
    const phoneRegex = new RegExp(normalized + '$');

    // Sort by createdAt descending to ensure we keep the newest callback and contact record
    const allCallbacks = await callbacksCollection.find({
      $or: [
        { "fields.Phone": { $regex: phoneRegex } },
        { "fields.phone": { $regex: phoneRegex } },
        { "fields.Mobile": { $regex: phoneRegex } }
      ]
    }).sort({ createdAt: -1 }).toArray();

    if (allCallbacks.length <= 1) return;

    const newestCb = allCallbacks[0];
    const olderCbs = allCallbacks.slice(1);

    let mergedRemarks = newestCb.remarks || '';
    for (const cb of olderCbs) {
      if (cb.remarks && !mergedRemarks.includes(cb.remarks)) {
        mergedRemarks += ` | [Older CB Remark: ${cb.remarks}]`;
      }
    }

    await callbacksCollection.updateOne(
      { _id: newestCb._id },
      { $set: { remarks: mergedRemarks, lastModified: new Date() } }
    );

    if (newestCb.contactId) {
      await contactsCollection.updateOne(
        { _id: new ObjectId(newestCb.contactId) },
        { $set: { remarks: mergedRemarks, lastModified: new Date() } }
      );
    }

    const callbackIdsToDelete = olderCbs.map(cb => cb._id);
    const contactIdsToDelete = olderCbs.map(cb => cb.contactId).filter(id => id && String(id) !== String(newestCb.contactId));

    if (callbackIdsToDelete.length > 0) {
      await callbacksCollection.deleteMany({ _id: { $in: callbackIdsToDelete } });
    }
    if (contactIdsToDelete.length > 0) {
      await contactsCollection.deleteMany({ _id: { $in: contactIdsToDelete.map(id => new ObjectId(id)) } });
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
    const callbacksCollection = getCollection('callbacks');
    const contactsCollection = getCollection('contacts');
    const phoneRegex = new RegExp(normalized + '$');

    const allCallbacks = await callbacksCollection.find({
      $or: [
        { "fields.Phone": { $regex: phoneRegex } },
        { "fields.phone": { $regex: phoneRegex } },
        { "fields.Mobile": { $regex: phoneRegex } }
      ]
    }).toArray();

    if (allCallbacks.length === 0) return;

    const callbackIds = allCallbacks.map(cb => cb._id);
    const contactIds = allCallbacks.map(cb => cb.contactId).filter(Boolean);

    await callbacksCollection.deleteMany({ _id: { $in: callbackIds } });
    if (contactIds.length > 0) {
      await contactsCollection.deleteMany({ _id: { $in: contactIds.map(id => new ObjectId(id)) } });
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

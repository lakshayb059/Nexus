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

    const allCallbacks = await callbacksCollection.find({
      $or: [
        { "fields.Phone": { $regex: phoneRegex } },
        { "fields.phone": { $regex: phoneRegex } },
        { "fields.Mobile": { $regex: phoneRegex } }
      ]
    }).sort({ callBackDt: 1 }).toArray();

    if (allCallbacks.length <= 1) return;

    const earliestCb = allCallbacks[0];
    const laterCbs = allCallbacks.slice(1);

    let mergedRemarks = earliestCb.remarks || '';
    for (const cb of laterCbs) {
      if (cb.remarks && !mergedRemarks.includes(cb.remarks)) {
        mergedRemarks += ` | [Later CB Remark: ${cb.remarks}]`;
      }
    }

    await callbacksCollection.updateOne(
      { _id: earliestCb._id },
      { $set: { remarks: mergedRemarks, lastModified: new Date() } }
    );

    if (earliestCb.contactId) {
      await contactsCollection.updateOne(
        { _id: new ObjectId(earliestCb.contactId) },
        { $set: { remarks: mergedRemarks, lastModified: new Date() } }
      );
    }

    const callbackIdsToDelete = laterCbs.map(cb => cb._id);
    const contactIdsToDelete = laterCbs.map(cb => cb.contactId).filter(id => id && String(id) !== String(earliestCb.contactId));

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

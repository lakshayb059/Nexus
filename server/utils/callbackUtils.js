const { getCollection } = require('../mongodb');
const { ObjectId } = require('mongodb');

/**
 * Normalizes a phone number to its last 10 digits.
 * @param {string} phone 
 * @returns {string}
 */
function normalizePhone(phone) {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

/**
 * Consolidates multiple callbacks for the same contact.
 * Keeps the earliest callback, merges remarks, and deletes redundant callbacks/contacts.
 * @param {string} phoneNum 
 */
async function consolidateCallbacks(phoneNum) {
  if (!phoneNum) return;
  const normalized = normalizePhone(phoneNum);
  if (!normalized) return;

  console.log(`[CONSOLIDATE] Checking callbacks for normalized phone: ${normalized}`);

  try {
    const callbacksCollection = getCollection('callbacks');
    const contactsCollection = getCollection('contacts');

    // Create a regex for the phone number (last 10 digits)
    const phoneRegex = new RegExp(normalized + '$');

    // Find all callbacks for this phone number
    const allCallbacks = await callbacksCollection.find({
      $or: [
        { "fields.Phone": { $regex: phoneRegex } },
        { "fields.phone": { $regex: phoneRegex } },
        { "fields.Mobile": { $regex: phoneRegex } }
      ]
    }).sort({ callBackDt: 1 }).toArray();

    if (allCallbacks.length <= 1) {
      console.log(`[CONSOLIDATE] No redundant callbacks found for ${normalized}`);
      return;
    }

    console.log(`[CONSOLIDATE] Found ${allCallbacks.length} callbacks for ${normalized}. Consolidating...`);

    const earliestCb = allCallbacks[0];
    const laterCbs = allCallbacks.slice(1);

    // Merge remarks
    let mergedRemarks = earliestCb.remarks || '';
    for (const cb of laterCbs) {
      if (cb.remarks && !mergedRemarks.includes(cb.remarks)) {
        mergedRemarks += ` | [Later CB Remark: ${cb.remarks}]`;
      }
    }

    // Update the earliest callback with merged remarks
    await callbacksCollection.updateOne(
      { _id: earliestCb._id },
      { $set: { remarks: mergedRemarks, lastModified: new Date() } }
    );

    // Update the associated contact of the earliest callback
    if (earliestCb.contactId) {
      await contactsCollection.updateOne(
        { _id: new ObjectId(earliestCb.contactId) },
        { $set: { remarks: mergedRemarks, lastModified: new Date() } }
      );
    }

    // Delete redundant callbacks and their associated "cloned" contacts
    const callbackIdsToDelete = laterCbs.map(cb => cb._id);
    const contactIdsToDelete = laterCbs.map(cb => cb.contactId).filter(id => id && String(id) !== String(earliestCb.contactId));

    if (callbackIdsToDelete.length > 0) {
      await callbacksCollection.deleteMany({ _id: { $in: callbackIdsToDelete } });
      console.log(`[CONSOLIDATE] Deleted ${callbackIdsToDelete.length} redundant callbacks.`);
    }

    if (contactIdsToDelete.length > 0) {
      await contactsCollection.deleteMany({ _id: { $in: contactIdsToDelete.map(id => new ObjectId(id)) } });
      console.log(`[CONSOLIDATE] Deleted ${contactIdsToDelete.length} associated contacts.`);
    }

  } catch (error) {
    console.error(`[CONSOLIDATE] Error consolidating callbacks for ${phoneNum}:`, error);
  }
}

/**
 * Deletes all callbacks and their associated cloned contacts for a given phone number.
 * Used when a contact is disposed as something other than CallBack.
 * @param {string} phoneNum 
 */
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

    console.log(`[CLEANUP] Deleted ${callbackIds.length} callbacks for ${normalized}`);
  } catch (error) {
    console.error(`[CLEANUP] Error cleaning up callbacks for ${phoneNum}:`, error);
  }
}

module.exports = {
  normalizePhone,
  consolidateCallbacks,
  cleanupAllCallbacks
};

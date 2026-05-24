// Email functionality has been completely disabled as per user request.
// This stub ensures that any existing routes calling this function will not break.
async function triggerConversionEmail(contactId, receiptImageBase64 = null) {
  console.log(`[Email Disabled] Skipping conversion email for contact ${contactId}`);
  return { success: true, warning: 'Email functionality has been disabled' };
}

module.exports = { triggerConversionEmail };

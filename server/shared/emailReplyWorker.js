const Imap = require('imap');
const { simpleParser } = require('mailparser');
const { prisma } = require('./db');

function stripQuotedText(text) {
  if (!text) return '';
  const lines = text.split(/\r?\n/);
  const cleanLines = [];
  
  for (const line of lines) {
    const trimmed = line.trim();
    // Check for common reply splitters
    if (
      trimmed.match(/^on\s+.*wrote:$/i) || 
      trimmed.match(/^from:.*$/i) ||
      trimmed.startsWith('-----Original Message-----') ||
      trimmed.startsWith('________________________________') ||
      trimmed.startsWith('>')
    ) {
      break;
    }
    cleanLines.push(line);
  }
  
  return cleanLines.join('\n').trim();
}

async function processAdminInbox(admin) {
  return new Promise((resolve, reject) => {
    const imap = new Imap({
      user: admin.smtpGmail.trim(),
      password: admin.smtpPassword.trim(),
      host: 'imap.gmail.com',
      port: 993,
      tls: true,
      tlsOptions: { rejectUnauthorized: false }
    });

    imap.once('ready', () => {
      imap.openBox('INBOX', false, (err, box) => {
        if (err) {
          imap.end();
          return reject(err);
        }

        // Search for all emails with 'Conversion' in the subject received in the last 3 days
        const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
        imap.search([['SUBJECT', 'Conversion'], ['SINCE', threeDaysAgo]], async (err, results) => {
          if (err) {
            imap.end();
            return reject(err);
          }

          if (!results || results.length === 0) {
            imap.end();
            return resolve();
          }

          const f = imap.fetch(results, {
            bodies: '',
            markSeen: false
          });

          let processedCount = 0;
          const totalToProcess = results.length;

          f.on('message', (msg, seqno) => {
            let buffer = '';
            let uid = null;

            msg.on('body', (stream, info) => {
              stream.on('data', (chunk) => {
                buffer += chunk.toString('utf8');
              });
            });

            msg.once('attributes', (attrs) => {
              uid = attrs.uid;
            });

            msg.once('end', async () => {
              try {
                const parsed = await simpleParser(buffer);
                const subject = parsed.subject || '';
                const bodyText = parsed.text || '';
                const bodyHtml = parsed.html || '';
                const from = parsed.from?.text || '';

                const fullContent = `${subject} ${bodyText} ${bodyHtml}`;

                // 1. Locate Lead Reference ID (UUID) in the email subject or body
                const refMatch = fullContent.match(/(?:ref\s*id|ref)[:=\s]*\[?([a-f0-9\-]{36})\]?/i);
                if (refMatch) {
                  const contactId = refMatch[1];
                  const messageId = parsed.messageId || uid.toString();
                  console.log(`[Email Reply Worker] Found Lead Ref ID: ${contactId}, Message ID: ${messageId}`);

                  // 2. Fetch Contact
                  const contact = await prisma.contact.findFirst({
                    where: { id: contactId, adminId: admin.id }
                  });

                  if (contact) {
                    // Check if this message was already processed
                    if (contact.remarks && contact.remarks.includes(messageId)) {
                      console.log(`[Email Reply Worker] Email ${messageId} already processed for contact ${contactId}. Skipping.`);
                      return;
                    }

                    // Try to extract Transaction ID/UTR from the email body text
                    const txMatch = fullContent.match(/(?:utr|transaction\s*id|txn\s*id|ref\s*no|reference|txid)[:=\s]+([a-z0-9\-]{8,24})/i);
                    let extractedTxId = null;
                    if (txMatch) {
                      extractedTxId = txMatch[1].trim();
                    }

                    const replyTextOnly = stripQuotedText(bodyText || bodyHtml.replace(/<[^>]*>/g, '')).trim();
                    const cleanBody = replyTextOnly.substring(0, 300);
                    let replySnippet = '';

                    // 3. Format Reply Snippet (Preserve internal transactionId/UTR intact)
                    if (extractedTxId) {
                      replySnippet = `[Charity Confirmation Email - Detected UTR: ${extractedTxId}] (Reply from ${from} on ${new Date().toLocaleString()}): "${cleanBody}" [MsgID: ${messageId}]\n\n`;
                      console.log(`[Email Reply Worker] Detected charity confirmation email for contact ${contactId} with UTR: ${extractedTxId}. Preserving internal transaction ID.`);
                    } else {
                      replySnippet = `[Charity Email Reply] (Reply from ${from} on ${new Date().toLocaleString()}): "${cleanBody}" [MsgID: ${messageId}]\n\n`;
                    }

                    // 4. Update Remarks for both Contact and Lead
                    const newContactRemarks = contact.remarks 
                      ? `${replySnippet}${contact.remarks}` 
                      : replySnippet;

                    await prisma.contact.update({
                      where: { id: contactId },
                      data: { remarks: newContactRemarks }
                    });

                    const leadRecord = await prisma.lead.findFirst({ where: { contactId } });
                    if (leadRecord) {
                      const newLeadRemarks = leadRecord.remarks 
                        ? `${replySnippet}${leadRecord.remarks}` 
                        : replySnippet;

                      await prisma.lead.update({
                        where: { id: leadRecord.id },
                        data: { remarks: newLeadRemarks }
                      });
                    }

                    // 5. Mark email as Seen
                    imap.addFlags(uid, '\\Seen', (flagErr) => {
                      if (flagErr) console.error(`[Email Reply Worker] Failed to mark email ${uid} seen:`, flagErr);
                    });
                  }
                }
              } catch (parseErr) {
                console.error('[Email Reply Worker] Error parsing message:', parseErr);
              } finally {
                processedCount++;
                if (processedCount === totalToProcess) {
                  imap.end();
                }
              }
            });
          });

          f.once('error', (err) => {
            console.error('[Email Reply Worker] Fetch error:', err);
            imap.end();
            reject(err);
          });
        });
      });
    });

    imap.once('error', (err) => {
      console.error(`[Email Reply Worker] IMAP client error for ${admin.smtpGmail}:`, err.message);
      reject(err);
    });

    imap.once('end', () => {
      resolve();
    });

    imap.connect();
  });
}

async function checkAllAdmins() {
  console.log('[Email Reply Worker] Starting check for new email replies...');
  try {
    const admins = await prisma.user.findMany({
      where: {
        role: 'admin',
        active: true,
        isDeleted: false,
        smtpGmail: { not: null, not: '' },
        smtpPassword: { not: null, not: '' }
      }
    });

    for (const admin of admins) {
      try {
        await processAdminInbox(admin);
      } catch (err) {
        console.error(`[Email Reply Worker] Error processing inbox for ${admin.smtpGmail}:`, err.message);
      }
    }
  } catch (err) {
    console.error('[Email Reply Worker] Error fetching admins:', err.message);
  }
}

function startEmailReplyWorker() {
  // Check every 2 minutes
  console.log('[Email Reply Worker] Initialized background replies tracker.');
  setInterval(checkAllAdmins, 120000);
  
  // Run once on startup after 30 seconds to allow server boot up
  setTimeout(checkAllAdmins, 30000);
}

module.exports = { startEmailReplyWorker };

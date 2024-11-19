import express from 'express';
import {
  syncLogsWithDb,
  fetchLogs,
  processLogs,
  sendWebhooks,
} from './logs.js';
import { dbAll, dbRun, insertStatusStmt } from './db.js';
import { sendEmail } from './mailer.js';

export const router = express();
router.use(express.json());

const colors = {
  processed: 'Gray',
  sent: 'ForestGreen',
  open: 'SteelBlue',
  bounced: 'Crimson',
  dropped: 'Black',
  deferred: 'Sienna',
};

// Home route: Fetch logs, process them, and display results
router.get('/', async (req, res) => {
  try {
    const logs = await fetchLogs();
    const result = await processLogs(logs);

    const query = `
      SELECT 
          mail.recipient, 
          mail.message_id AS messageId, 
          mail_status.status, 
          mail_status.timestamp, 
          mail.queue_id AS queueId,
          tracking_id,
          webhook
      FROM mail_status
      INNER JOIN mail ON mail_status.mail_id = mail.id
      ORDER BY mail_status.timestamp DESC,  mail.timestamp DESC
      LIMIT 100
    `;

    const rows = await dbAll(query);

    const logsHtml = rows
      .map(
        (log) => `
          <tr>
              <td>${log.recipient || 'Unknown'}</td>
              <td><span style="padding: 5px; border-radius: 4px; background-color: ${
                colors[log.status] || 'gray'
              }; color: white;">${log.status}</span></td>
              <td>${new Date(log.timestamp).toLocaleString()}</td>
              <td>${log.queueId}</td>
              <td>${log.webhook}</td>
              <td>${log.messageId || 'Unknown'}</td>
              <td>${log.tracking_id || '-'}</td>
          </tr>
        `,
      )
      .join('');

    res.send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Mail Logs</title>
          <style>
              body { font-family: Arial, sans-serif; margin: 20px; }
              table { width: 100%; border-collapse: collapse; margin-top: 20px; }
              th, td { padding: 10px; border: 1px solid #ddd; text-align: left; }
              th { background-color: #f4f4f4; }
          </style>
      </head>
      <body>
          <h1>Mail Logs</h1>
          <div>Batch processing result:
              <span style="padding: 5px; border-radius: 4px; background-color: ${
                result.newStatuses > 0 ? 'green' : 'gray'
              }; color: white;">${result.newStatuses} new statuses</span>
              <span style="padding: 5px; border-radius: 4px; background-color: ${
                result.webhookSent > 0 ? 'green' : 'gray'
              }; color: white;">${result.webhookSent} webhooks sent</span>
          </div>
          <table>
              <thead>
                  <tr>
                      <th>Recipient</th>
                      <th>Status</th>
                      <th>Timestamp</th>
                      <th>Queue ID</th>
                      <th>Webhook Sent</th>
                      <th>Message ID</th>
                      <th>Tracking ID</th>
                  </tr>
              </thead>
              <tbody>
                  ${logsHtml}
              </tbody>
          </table>
      </body>
      </html>
    `);
  } catch (err) {
    console.error('Error handling / route:', err.message);
    res.status(500).send('Internal server error');
  }
});

// Route: Fetch statuses for a given message ID
router.get('/message', async (req, res) => {
  const messageId = req.query.message_id;

  if (!messageId) {
    return res
      .status(400)
      .json({ error: 'message_id query parameter is required' });
  }

  try {
    const query = `
      SELECT 
          mail_status.timestamp,
          mail_status.status,
          mail_status.description,
          recipient
      FROM mail_status
      INNER JOIN mail ON mail_status.mail_id = mail.id
      WHERE mail.message_id = ?
      ORDER BY mail_status.timestamp ASC
    `;

    const statuses = await dbAll(query, [messageId]);

    if (statuses.length === 0) {
      return res
        .status(404)
        .json({ error: 'No statuses found for the given message_id' });
    }

    res.json({ message_id: messageId, statuses });
  } catch (err) {
    console.error(
      `Error fetching statuses for message_id ${messageId}:`,
      err.message,
    );
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Route: Trigger manual sync
router.get('/sync-logs', async (req, res) => {
  try {
    const result = await syncLogsWithDb();
    res.json(result);
  } catch (err) {
    console.error('Error during manual sync:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/send', async (req, res) => {
  const {
    from,
    to,
    subject,
    cc,
    bcc,
    attachments,
    text,
    html,
    includeTracker,
    password,
  } = req.body;

  // Check if authentication is required
  if (process.env.AUTH_PASSWORD) {
    if (!password || password !== process.env.AUTH_PASSWORD) {
      return res.status(401).json({
        error: 'Unauthorized: Invalid or missing password.',
      });
    }
  }

  if (!from || !to || !subject) {
    return res.status(400).json({
      error: "Missing required fields: 'from', 'to', 'subject'.",
    });
  }

  try {
    const messageId = await sendEmail({
      from,
      to,
      subject,
      cc,
      bcc,
      attachment,
      text,
      html,
      includeTracker,
    });
    return res.status(200).json({ success: true, messageId });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/track', async (req, res) => {
  const { trackingId } = req.query;

  if (trackingId) {
    console.log(`Email opened with tracking ID: ${trackingId}`);

    const query = `SELECT id FROM mail WHERE tracking_id = ?`;

    const rows = await dbAll(query, [trackingId]);

    for (const { id } of rows) {
      await dbRun(insertStatusStmt, [id, new Date().toISOString(), 'open', '']);
    }
    await sendWebhooks();
  }

  // Anti-cache headers
  res.setHeader(
    'Cache-Control',
    'no-store, no-cache, must-revalidate, proxy-revalidate',
  );
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');

  // Return a 1x1 transparent GIF
  const transparentGif = Buffer.from(
    'R0lGODlhAQABAIAAAAUEBAEAAAAACwAAAAAAQABAAACAkQBADs=',
    'base64',
  );
  res.writeHead(200, {
    'Content-Type': 'image/gif',
    'Content-Length': transparentGif.length,
  });
  res.end(transparentGif);
});


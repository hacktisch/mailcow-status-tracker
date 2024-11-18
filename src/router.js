import express from 'express';
import { syncLogsWithDb, fetchLogs, processLogs } from './logs.js';
import { dbAll } from './db.js';

export const router = express();

// Home route: Fetch logs, process them, and display results
router.get('/', async (req, res) => {
  try {
    const domains = ['example.com', 'demo.org', 'test.net'];
    const demoLogs = Array.from({ length: 10 }, (_, index) => ({
      recipient: `user${index + 1}@${domains[index % domains.length]}`,
      messageId: `${Date.now() - index * 60000}.${Math.random().toString(36).slice(2, 12)}@${domains[index % domains.length]}`,
      status: Math.random()>0.3 ? 'sent' : Math.random() > 0.35 ? 'bounced' : 'deferred',
      timestamp: new Date(Date.now() - index * 60000).toISOString(), // timestamps spaced by 1 minute
      queueId: Math.random().toString(36).slice(2, 12).toUpperCase(), // Simulates Postfix queue IDs
      webhook: index % 2 === 0 ? 1 : 0, // Alternate webhook sent status
    }));

    const logsHtml = demoLogs
      .map(
        (log) => `
          <tr>
              <td>${log.recipient || 'Unknown'}</td>
              <td><span style="padding: 5px; border-radius: 4px; background-color: ${
                log.status === 'sent'
                  ? 'green'
                  : log.status === 'bounced'
                  ? 'red'
                  : log.status === 'deferred'
                  ? 'orange'
                  : 'gray'
              }; color: white;">${log.status}</span></td>
              <td>${new Date(log.timestamp).toLocaleString()}</td>
              <td>${log.queueId}</td>
              <td>${log.messageId || 'Unknown'}</td>
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
        
          <table>
              <thead>
                  <tr>
                      <th>Recipient</th>
                      <th>Status</th>
                      <th>Timestamp</th>
                      <th>Queue ID</th>
                      <th>Message ID</th>
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
          mail_status.queue_id,
          mail_status.timestamp,
          mail_status.status,
          mail_status.description,
          recipient
      FROM mail_status
      INNER JOIN mails ON mail_status.queue_id = mails.queue_id
      WHERE mails.message_id = ?
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


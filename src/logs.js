import axios from 'axios';
import { db, dbAll, dbRun } from './db.js';

export async function fetchLogs(pageSize = process.env.LOGS_PER_BATCH) {
  let logsData = [];

  try {
    const API_URL = `${process.env.API_URL_BASE}/${pageSize}`;
    const response = await axios.get(API_URL, {
      headers: { 'X-API-Key': process.env.API_KEY },
    });

    const logs = response.data;

    if (logs) {
      logs.forEach((log) => {
        try {
          const logTime = parseInt(log.time, 10) * 1000; // Convert to milliseconds

          // Dynamically capture any `status=...` value
          const statusMatch = log.message.match(/status=([\w-]+)/);
          const status = statusMatch?.[1];

          const queueIdMatch = log.message.match(/\b[A-F0-9]{10,}\b/); // Match Postfix queue ID
          const queueId = queueIdMatch?.[0] ?? false;
          const messageId =
            log.message.match(/message-id=<([^>]+)>/)?.[1] ?? false;
          const recipient = log.message.match(/to=<([^>]+)>/)?.[1];

          if (queueId && (messageId || status || recipient)) {
            const updates = {
              queueId,
              timestamp: new Date(logTime).toISOString(), // ISO timestamp for consistency
              description: log.message,
            };

            if (messageId) updates.messageId = messageId;
            if (status) updates.status = status;
            if (recipient) updates.recipient = recipient;

            logsData.push(updates);
          }
        } catch (e) {
          console.error(`Error processing log entry: ${e.message}`);
        }
      });

      return logsData;
    }
  } catch (error) {
    console.error('Error fetching logs:', error);
  }

  return [];
}

const prepareStatements = () => ({
  insertMailStmt: db.prepare(`
    INSERT INTO mails (queue_id, timestamp, message_id, recipient)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(queue_id) DO UPDATE SET
      message_id = COALESCE(excluded.message_id, mails.message_id),
      recipient = COALESCE(excluded.recipient, mails.recipient)
  `),
  insertStatusStmt: db.prepare(`
    INSERT INTO mail_status (queue_id, timestamp, status, description)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(queue_id, timestamp, status) DO NOTHING
  `),
  updateWebhookStmt: db.prepare(`
    UPDATE mail_status
    SET webhook = ?
    WHERE queue_id = ? AND timestamp = ? AND status = ?
  `),
});

export async function processLogs(logs) {
  const { insertMailStmt, insertStatusStmt, updateWebhookStmt } =
    prepareStatements();
  let newStatuses = 0,
    webhookSent = 0;

  for (const {
    queueId,
    timestamp,
    messageId,
    recipient,
    status,
    description,
  } of logs) {
    try {
      await dbRun(insertMailStmt, [queueId, timestamp, messageId, recipient]);
      if (status) {
        newStatuses += await dbRun(insertStatusStmt, [
          queueId,
          timestamp,
          status,
          description,
        ]);
      }
    } catch (err) {
      console.error(
        `Error processing log for queueId ${queueId}: ${err.message}`,
      );
    }
  }

  const rowsToProcess = await dbAll(`
    SELECT mails.queue_id, mail_status.timestamp, status, description, message_id, recipient
    FROM mail_status
    JOIN mails ON mail_status.queue_id = mails.queue_id
    WHERE webhook = 0 AND status IS NOT NULL AND message_id IS NOT NULL
  `);

  for (const row of rowsToProcess) {
    const { queue_id, timestamp, status, description, message_id, recipient } =
      row;
    try {
      if (process.env.WEBHOOK) {
        await axios.post(process.env.WEBHOOK, {
          queue_id,
          timestamp,
          status,
          description,
          message_id,
          recipient,
        });
        await dbRun(updateWebhookStmt, [1, queue_id, timestamp, status]);
        webhookSent++;
      } else {
        await dbRun(updateWebhookStmt, [-1, queue_id, timestamp, status]);
      }
    } catch (err) {
      console.error(`Webhook failed for queueId ${queue_id}: ${err.message}`);
    }
  }

  [insertMailStmt, insertStatusStmt, updateWebhookStmt].forEach((stmt) =>
    stmt.finalize(),
  );
  return { newStatuses, webhookSent };
}

export async function syncLogsWithDb() {
  const logs = await fetchLogs();
  return await processLogs(logs);
}


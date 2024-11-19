import axios from 'axios';
import {
  db,
  dbAll,
  dbRun,
  dbGet,
  insertMailStmt,
  insertStatusStmt,
  updateWebhookStmt,
} from './db.js';

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
            log.message
              .match(/message-id=<[^>]+>/)?.[0]
              ?.replace(/^message-id=/, '') ?? false;
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

export async function processLogs(logs) {
  let newStatuses = 0;

  for (const {
    queueId,
    timestamp,
    messageId,
    recipient,
    status,
    description,
  } of logs) {
    try {
      const row = await dbGet(insertMailStmt, [
        queueId,
        messageId,
        recipient,
        null, //tracking_id,
        timestamp,
      ]);

      if (status && row?.id) {
        newStatuses += await dbRun(insertStatusStmt, [
          row.id,
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

  const webhookSent = await sendWebhooks();

  return { newStatuses, webhookSent };
}

export async function sendWebhooks() {
  let webhookSent = 0;
  const rowsToProcess = await dbAll(`
    SELECT mail_status.id, mail.queue_id, mail_status.timestamp, status, description, message_id, recipient
    FROM mail_status
    JOIN mail ON mail_id = mail.id
    WHERE webhook = 0 AND status IS NOT NULL AND message_id IS NOT NULL
  `);

  for (const row of rowsToProcess) {
    const {
      id,
      queue_id,
      timestamp,
      status,
      description,
      message_id,
      recipient,
    } = row;
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
        await dbRun(updateWebhookStmt, [1, id]);
        webhookSent++;
      } else {
        await dbRun(updateWebhookStmt, [-1, id]);
      }
    } catch (err) {
      console.error(`Webhook failed for queueId ${queue_id}: ${err.message}`);
    }
  }

  return webhookSent;
}

export async function syncLogsWithDb() {
  await truncateOldLogs();
  const logs = await fetchLogs();
  return await processLogs(logs);
}

export async function truncateOldLogs() {
  const logRetentionDays = parseInt(process.env.LOG_RETENTION_DAYS, 10) || 7;
  const cutoffDate = new Date(
    Date.now() - logRetentionDays * 24 * 60 * 60 * 1000,
  ).toISOString();

  return new Promise((resolve, reject) => {
    db.serialize(() => {
      // Delete from mail_status
      db.run(
        `DELETE FROM mail_status WHERE timestamp < ?`,
        [cutoffDate],
        function (err) {
          if (err) return reject(err);
          if (this.changes > 0) {
            console.log(`Deleted ${this.changes} rows from mail_status table`);
          }
        },
      );

      // Delete from mail
      db.run(
        `DELETE FROM mail WHERE timestamp < ?`,
        [cutoffDate],
        function (err) {
          if (err) return reject(err);
          if (this.changes > 0) {
            console.log(`Deleted ${this.changes} rows from mail table`);
          }
        },
      );

      resolve();
    });
  });
}


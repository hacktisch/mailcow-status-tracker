import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

// Resolve file paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Database file path
const dbFile = path.join(__dirname, '../db/mail_logs.db');
export const db = new sqlite3.Database(dbFile);

// Initialize database tables and indexes
db.serialize(() => {
  const tables = [
    `CREATE TABLE IF NOT EXISTS mail (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      queue_id TEXT UNIQUE,
      message_id TEXT,
      recipient TEXT,
      tracking_id TEXT,
      timestamp DATETIME NOT NULL,
      UNIQUE(queue_id, message_id)
    );`,
    `CREATE TABLE IF NOT EXISTS mail_status (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mail_id TEXT NOT NULL,
      timestamp DATETIME NOT NULL,
      status TEXT NOT NULL,
      description TEXT,
      webhook INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (mail_id) REFERENCES mail(id),
      UNIQUE(mail_id, timestamp, status)
    );`,
  ];

  const indexes = [
    `CREATE INDEX IF NOT EXISTS idx_mail_timestamp ON mail(timestamp);`,
    `CREATE INDEX IF NOT EXISTS idx_mail_recipient ON mail(recipient);`,
    `CREATE INDEX IF NOT EXISTS idx_mail_tracking_id ON mail(tracking_id);`,
    `CREATE INDEX IF NOT EXISTS idx_mail_status_timestamp ON mail_status(timestamp);`,
    `CREATE INDEX IF NOT EXISTS idx_mail_status_status ON mail_status(status);`,
    `CREATE INDEX IF NOT EXISTS idx_mail_status_webhook ON mail_status(webhook);`,
  ];

  // Create tables
  tables.forEach((query) => db.run(query));

  // Create indexes
  indexes.forEach((query) => db.run(query));
});

export const dbGet = (stmt, params) =>
  new Promise((resolve, reject) =>
    stmt.get(params, function (err, row) {
      if (err) reject(err);
      else resolve(row);
    }),
  );

export const dbRun = (stmt, params) =>
  new Promise((resolve, reject) =>
    stmt.run(params, function (err) {
      if (err) reject(err);
      else resolve(this.changes);
    }),
  );

export const dbAll = (query, params = []) =>
  new Promise((resolve, reject) =>
    db.all(query, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    }),
  );

export const insertMailStmt = db.prepare(`
  INSERT INTO mail (queue_id, message_id, recipient, tracking_id, timestamp)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(queue_id) DO UPDATE SET
      message_id = COALESCE(excluded.message_id, mail.message_id),
      recipient = COALESCE(excluded.recipient, mail.recipient),
      tracking_id = COALESCE(excluded.tracking_id, mail.tracking_id),
      timestamp = COALESCE(excluded.timestamp, mail.timestamp)
    ON CONFLICT(queue_id, message_id) DO UPDATE SET
      recipient = COALESCE(excluded.recipient, mail.recipient),
      tracking_id = COALESCE(excluded.tracking_id, mail.tracking_id),
      timestamp = COALESCE(excluded.timestamp, mail.timestamp)
    RETURNING id;
`);

export const insertStatusStmt = db.prepare(`
  INSERT INTO mail_status (mail_id, timestamp, status, description)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(mail_id, timestamp, status) DO NOTHING
`);

export const updateWebhookStmt = db.prepare(`
  UPDATE mail_status
  SET webhook = ?
  WHERE id = ?
`);

process.on('SIGINT', () => {
  [insertMailStmt, insertStatusStmt, updateWebhookStmt].forEach((stmt) =>
    stmt.finalize(),
  );
  db.close(() => {
    console.log('Database connection closed.');
    process.exit(0);
  });
});

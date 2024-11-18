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
    `CREATE TABLE IF NOT EXISTS mails (
      queue_id TEXT PRIMARY KEY,
      timestamp DATETIME NOT NULL,
      message_id TEXT,
      recipient TEXT
    );`,
    `CREATE TABLE IF NOT EXISTS mail_status (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      queue_id TEXT NOT NULL,
      timestamp DATETIME NOT NULL,
      status TEXT NOT NULL,
      description TEXT,
      webhook INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (queue_id) REFERENCES mails(queue_id),
      UNIQUE(queue_id, timestamp, status)
    );`,
  ];

  const indexes = [
    `CREATE INDEX IF NOT EXISTS idx_mails_timestamp ON mails(timestamp);`,
    `CREATE INDEX IF NOT EXISTS idx_mails_message_id ON mails(message_id);`,
    `CREATE INDEX IF NOT EXISTS idx_mails_recipient ON mails(recipient);`,
    `CREATE INDEX IF NOT EXISTS idx_mail_status_timestamp ON mail_status(timestamp);`,
    `CREATE INDEX IF NOT EXISTS idx_mail_status_status ON mail_status(status);`,
    `CREATE INDEX IF NOT EXISTS idx_mail_status_queue_id ON mail_status(queue_id);`,
    `CREATE INDEX IF NOT EXISTS idx_mail_status_webhook ON mail_status(webhook);`,
  ];

  // Create tables
  tables.forEach((query) => db.run(query));

  // Create indexes
  indexes.forEach((query) => db.run(query));
});

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


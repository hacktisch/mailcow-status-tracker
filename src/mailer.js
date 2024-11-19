import nodemailer from 'nodemailer';
import crypto from 'crypto';
import { dbRun, dbGet, insertMailStmt, insertStatusStmt } from './db.js';

async function sendEmail({ from, to, subject, text, html, includeTracker }) {
  const smtpConfig = {
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT, 10),
    secure: process.env.SMTP_SECURE === 'true',
  };

  const smtpAccounts = process.env.SMTP_ACCOUNTS
    ? JSON.parse(process.env.SMTP_ACCOUNTS)
    : {};

  // Extract email address from 'from' field
  const emailMatch = from.match(/<([^>]+)>/) || [null, from];
  let emailAddress = emailMatch[1]?.trim();

  if (!emailAddress || !smtpAccounts[emailAddress]) {
    if (process.env.SMTP_FALLBACK_ACCOUNT) {
      from = from.replace(
        new RegExp(emailAddress, 'g'),
        process.env.SMTP_FALLBACK_ACCOUNT,
      );
      emailAddress = process.env.SMTP_FALLBACK_ACCOUNT;
    } else {
      throw new Error(`SMTP account for '${emailAddress}' is not configured.`);
    }
  }

  const transporter = nodemailer.createTransport({
    ...smtpConfig,
    auth: {
      user: emailAddress,
      pass: smtpAccounts[emailAddress],
    },
  });

  // Generate a unique tracking pixel URL
  let trackingId;
  let trackingPixel = '';
  if (includeTracker && process.env.APP_URL_ORIGIN) {
    trackingId = crypto.randomUUID();
    trackingPixel = `<img src="${process.env.APP_URL_ORIGIN}/track?trackingId=${trackingId}" style="width:1px;height:1px;display:block;">`;
  }

  // Merge text and HTML content
  const emailContent =
    html || text
      ? html
        ? `${html}${trackingPixel}`
        : `<p>${text}</p>${trackingPixel}`
      : null;

  const mailOptions = {
    from, // Pass the full `from` field, including the name if provided
    to,
    subject,
    text,
    html: emailContent,
  };

  try {
    const info = await transporter.sendMail(mailOptions);

    console.log(`Email sent: ${info.messageId}`);

    if (info.messageId && trackingId) {
      const row = await dbGet(insertMailStmt, [
        null,
        info.messageId,
        to,
        trackingId,
        new Date().toISOString(),
      ]);

      if (row?.id) {
        await dbRun(insertStatusStmt, [
          row.id,
          new Date().toISOString(),
          'processed',
          '',
        ]);
      }
    }

    return info.messageId;
  } catch (error) {
    console.error(`Error sending email from ${from} to ${to}:`, error.message);
    throw error;
  }
}

export { sendEmail };


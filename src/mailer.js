import nodemailer from 'nodemailer';
import crypto from 'crypto';
import { dbRun, dbGet, insertMailStmt, insertStatusStmt } from './db.js';

async function sendEmail({
  from,
  to,
  reply_to,
  cc,
  bcc,
  subject,
  text,
  html,
  includeTracker,
  attachments,
  unsubscribeUrl,
  unsubscribeEmail,
  unsubscribeLinkText
}) {
  console.log(`Sending email from ${from} to ${to} with subject: ${subject}`);
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

  // Add unsubscribe link if requested
  let unsubscribeLink = '';
  if (unsubscribeUrl && unsubscribeLinkText) {
    unsubscribeLink = `
      <div style="margin-top: 20px; padding-top: 10px; border-top: 1px solid #ddd; font-size: 12px; color: #666; text-align: center;">
        <a href="${unsubscribeUrl}" style="color: #666; text-decoration: underline;">${unsubscribeLinkText}</a>
      </div>
    `;
  }

  // Merge text and HTML content
  let emailContent;
  if (html) {
    // If HTML is provided, append tracking pixel and unsubscribe link
    emailContent = `${html}${unsubscribeLink}${trackingPixel}`;
  } else if (text) {
    // If only text is provided, convert to HTML and append tracking pixel and unsubscribe link
    emailContent = `<p>${text}</p>${unsubscribeLink}${trackingPixel}`;
  } else {
    emailContent = null;
  }

  // Update text version too if there's an unsubscribe link
  let textContent = text;
  if (text && unsubscribeUrl && unsubscribeLinkText) {
    textContent = `${text}\n\n${unsubscribeLinkText}: ${unsubscribeUrl}`;
  }

  // Construct mail options
  const mailOptions = {
    from, // Pass the full `from` field, including the name if provided
    to,
    replyTo: reply_to,
    cc: cc?.length ? cc : undefined,
    bcc: bcc?.length ? bcc : undefined,
    subject,
    text: textContent,
    html: emailContent,
    attachments,
  };

  // Add List-Unsubscribe header if provided
  if (unsubscribeUrl || unsubscribeEmail) {
    mailOptions.headers = mailOptions.headers || {};
    
    let unsubscribeHeader = [];
    if (unsubscribeEmail) {
      unsubscribeHeader.push(`mailto:${unsubscribeEmail}`);
    }
    if (unsubscribeUrl) {
      unsubscribeHeader.push(`<${unsubscribeUrl}>`);
    }
    
    mailOptions.headers['List-Unsubscribe'] = unsubscribeHeader.join(', ');
    
    // Add List-Unsubscribe-Post header for one-click unsubscribe if URL is provided
    if (unsubscribeUrl) {
      mailOptions.headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
    }
  }

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


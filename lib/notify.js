'use strict';

const config = require('./config');

let nodemailer;
try { nodemailer = require('nodemailer'); } catch (e) { nodemailer = null; }

function isConfigured() {
  return !!(nodemailer && process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS && config.notifyTo);
}

function transporter() {
  if (!isConfigured()) return null;
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

// ─── Formatting ───────────────────────────────────────────────────────────────

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function prettyDate(isoDate) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function prettyTime(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const suffix = h < 12 ? 'am' : 'pm';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, '0')}${suffix}`;
}

function groupByDate(sessions) {
  const map = new Map();
  for (const s of sessions) {
    if (!map.has(s.date)) map.set(s.date, []);
    map.get(s.date).push(s);
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

function sessionList(sessions) {
  return groupByDate(sessions)
    .map(([date, list]) => {
      const times = list
        .map((s) => `<span style="display:inline-block;background:#eef2ff;color:#1e3a8a;border-radius:5px;padding:3px 9px;margin:2px 4px 2px 0;font-size:14px;">${prettyTime(s.time)}${s.screenType ? ` · ${s.screenType}` : ''}</span>`)
        .join('');
      return `<tr><td style="padding:8px 0;border-bottom:1px solid #eeeeee;"><strong style="font-size:14px;color:#111111;">${prettyDate(date)}</strong><br>${times}</td></tr>`;
    })
    .join('');
}

/**
 * `newDates` are dates that previously had NO sessions at all — that's the headline
 * signal (the cinema opening up a new day), so it comes from the diff rather than
 * being re-derived from `added`, which would also count extra times on known dates.
 */
function buildEmail({ added, removed, total, movieName, cinemaName, newDates = [] }) {
  const subjectBits = [];
  if (added.length) subjectBits.push(`${added.length} new session${added.length === 1 ? '' : 's'}`);
  if (removed.length) subjectBits.push(`${removed.length} removed`);
  const subject = `${movieName} @ ${cinemaName} — ${subjectBits.join(', ')}`;

  // Explicit light background: many clients (and iOS Mail's dark mode) will otherwise
  // paint a dark backdrop behind this near-black text and render it unreadable.
  const html = `
  <div style="background:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#111111;">
    <p style="margin:0 0 4px;font-size:13px;color:#666;text-transform:uppercase;letter-spacing:.06em;">Event Cinemas watch</p>
    <h1 style="margin:0 0 2px;font-size:22px;color:#111111;">${movieName}</h1>
    <p style="margin:0 0 20px;color:#555;font-size:15px;">${cinemaName}</p>

    ${added.length ? `
      <h2 style="font-size:16px;margin:0 0 8px;color:#166534;">${added.length} new session${added.length === 1 ? '' : 's'} added</h2>
      ${newDates.length ? `<p style="margin:0 0 10px;font-size:14px;color:#555;">Includes ${newDates.length} date${newDates.length === 1 ? '' : 's'} that had nothing listed before: <strong>${newDates.map(prettyDate).join(', ')}</strong></p>` : ''}
      <table style="width:100%;border-collapse:collapse;margin-bottom:22px;">${sessionList(added)}</table>` : ''}

    ${removed.length ? `
      <h2 style="font-size:16px;margin:0 0 8px;color:#991b1b;">${removed.length} session${removed.length === 1 ? '' : 's'} no longer listed</h2>
      <table style="width:100%;border-collapse:collapse;margin-bottom:22px;">${sessionList(removed)}</table>` : ''}

    <p style="margin:0 0 20px;font-size:14px;color:#555;">${total} upcoming session${total === 1 ? '' : 's'} now listed in total.</p>

    <a href="${config.movieUrl}#cinemas=${config.cinemaIds.join(',')}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:11px 20px;border-radius:7px;font-size:15px;">Book on Event Cinemas</a>

    <p style="margin:26px 0 0;font-size:12px;color:#999;">Checked every ${config.pollMinutes} min · window ${config.daysAhead} days</p>
  </div>`;

  return { subject, html };
}

async function sendChangeEmail(payload) {
  if (!isConfigured()) {
    console.log('[notify] email not configured (need SMTP_HOST/SMTP_USER/SMTP_PASS + NOTIFY_TO) — skipping send');
    return { sent: false, reason: 'not-configured' };
  }
  const { subject, html } = buildEmail(payload);
  const from = process.env.MAIL_FROM_ADDRESS || process.env.SMTP_USER;
  try {
    await transporter().sendMail({
      from: `Event Cinemas Watch <${from}>`,
      to: config.notifyTo,
      subject,
      html,
    });
    console.log('[notify] emailed', config.notifyTo, '—', subject);
    return { sent: true, subject };
  } catch (err) {
    console.error('[notify] send failed:', err.message);
    return { sent: false, reason: err.message };
  }
}

module.exports = { sendChangeEmail, buildEmail, isConfigured, prettyDate, prettyTime };

'use strict';

const config = require('./config');

let nodemailer;
try { nodemailer = require('nodemailer'); } catch (e) { nodemailer = null; }

// ─── Transport selection ──────────────────────────────────────────────────────
// Resend's HTTP API is preferred over its SMTP bridge: it answers on 443, returns a
// message id, and fails with a readable reason. A watcher whose whole job is to tell
// you something must not lose mail quietly, so the reason gets surfaced to the UI.

function provider() {
  if (process.env.RESEND_API_KEY) return 'resend';
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) return 'smtp';
  return null;
}

const looksLikeEmail = (v) => !!v && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);

/** Resend's SMTP username is the literal string "resend", so it is never a usable From. */
function fromAddress() {
  if (looksLikeEmail(process.env.MAIL_FROM_ADDRESS)) return process.env.MAIL_FROM_ADDRESS;
  if (provider() === 'resend') return 'onboarding@resend.dev';
  return looksLikeEmail(process.env.SMTP_USER) ? process.env.SMTP_USER : null;
}

function isConfigured() {
  const p = provider();
  if (!p || !config.notifyTo || !fromAddress()) return false;
  return p === 'resend' || !!nodemailer;
}

/** Why email can't send, in words the dashboard can show. */
function configProblem() {
  if (!provider()) return 'No RESEND_API_KEY, and no SMTP_HOST/SMTP_USER/SMTP_PASS.';
  if (!config.notifyTo) return 'NOTIFY_TO is not set.';
  if (!fromAddress()) return 'No usable From address — set MAIL_FROM_ADDRESS to a verified sender.';
  if (provider() === 'smtp' && !nodemailer) return 'nodemailer is not installed.';
  return null;
}

async function sendViaResend({ to, from, subject, html }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, to: [to], subject, html }),
    signal: AbortSignal.timeout(20000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    // 403 here is nearly always the resend.dev sandbox: that sender may only mail the
    // address the Resend account was registered with. Since this app only ever mails
    // one person, matching NOTIFY_TO to that address is the fix — not domain setup.
    const hint = res.status === 403 && from.endsWith('@resend.dev')
      ? ` — onboarding@resend.dev can only deliver to the address your Resend account is registered with. Set NOTIFY_TO to that address (currently ${config.notifyTo}).`
      : '';
    throw new Error(`Resend ${res.status}: ${body.message || body.name || 'unknown error'}${hint}`);
  }
  return body.id || null;
}

async function sendViaSmtp({ to, from, subject, html }) {
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const t = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  const info = await t.sendMail({ from, to, subject, html });
  return info.messageId || null;
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
  const at = new Date().toISOString();
  const problem = configProblem();
  if (problem) {
    console.log('[notify] not configured —', problem);
    return { sent: false, at, reason: problem, provider: provider() };
  }

  const { subject, html } = buildEmail(payload);
  const from = `Event Cinemas Watch <${fromAddress()}>`;
  const p = provider();

  try {
    const id = p === 'resend'
      ? await sendViaResend({ to: config.notifyTo, from, subject, html })
      : await sendViaSmtp({ to: config.notifyTo, from, subject, html });
    console.log(`[notify] sent via ${p} to ${config.notifyTo} — ${subject}`);
    return { sent: true, at, subject, id, provider: p };
  } catch (err) {
    console.error(`[notify] send failed via ${p}:`, err.message);
    return { sent: false, at, subject, reason: err.message, provider: p };
  }
}

module.exports = {
  sendChangeEmail, buildEmail, isConfigured, configProblem, provider, fromAddress,
  prettyDate, prettyTime,
};

'use strict';

const webpush = require('web-push');
const config = require('./config');
const store = require('./store');

// VAPID keys are generated on first use and persisted to the volume rather than being
// supplied as env vars. Nobody has to handle the private key, and it never appears in a
// shell history or a chat log. Env vars still win if you ever want a fixed pair.
function keys() {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    return { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY, source: 'env' };
  }
  const state = store.load();
  if (!state.vapid) {
    state.vapid = webpush.generateVAPIDKeys();
    store.save(state);
    console.log('[push] generated a VAPID keypair and saved it to state');
  }
  return { ...state.vapid, source: 'state' };
}

/**
 * Apple rejects any VAPID subject that isn't a mailto: or https: URL with a 403 from
 * web.push.apple.com, so this is deliberately strict rather than using a bare hostname.
 */
function subject() {
  const explicit = process.env.VAPID_SUBJECT;
  if (explicit && /^(mailto:|https:\/\/)/.test(explicit)) return explicit;
  if (config.notifyTo) return `mailto:${config.notifyTo}`;
  return 'https://github.com/philcsn/odysee-imax-checker';
}

function configure() {
  const k = keys();
  webpush.setVapidDetails(subject(), k.publicKey, k.privateKey);
  return k;
}

function publicKey() {
  return keys().publicKey;
}

function listSubscriptions() {
  return store.load().subscriptions || [];
}

function addSubscription(sub) {
  if (!sub || !sub.endpoint) throw new Error('invalid subscription');
  const state = store.load();
  state.subscriptions = (state.subscriptions || []).filter((s) => s.endpoint !== sub.endpoint);
  state.subscriptions.push({ ...sub, addedAt: new Date().toISOString() });
  store.save(state);
  return state.subscriptions.length;
}

function removeSubscription(endpoint) {
  const state = store.load();
  const before = (state.subscriptions || []).length;
  state.subscriptions = (state.subscriptions || []).filter((s) => s.endpoint !== endpoint);
  store.save(state);
  return before - state.subscriptions.length;
}

/**
 * Send to every subscription, dropping the ones the push service says are dead.
 * 404/410 means the user deleted the web app or iOS revoked it — keeping those around
 * would mean retrying a corpse on every change forever.
 */
async function sendPush({ title, body, url }) {
  const subs = listSubscriptions();
  if (!subs.length) return { sent: 0, failed: 0, pruned: 0, at: new Date().toISOString(), reason: 'no-subscriptions' };

  configure();
  const payload = JSON.stringify({ title, body, url: url || '/' });
  let sent = 0, failed = 0, pruned = 0;
  const errors = [];

  for (const sub of subs) {
    try {
      await webpush.sendNotification(sub, payload);
      sent++;
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) {
        removeSubscription(sub.endpoint);
        pruned++;
      } else {
        failed++;
        errors.push(`${err.statusCode || '?'}: ${err.body || err.message}`);
      }
    }
  }

  const result = { sent, failed, pruned, at: new Date().toISOString() };
  if (errors.length) result.reason = errors[0];
  console.log(`[push] sent ${sent}, failed ${failed}, pruned ${pruned}`);
  return result;
}

module.exports = { sendPush, publicKey, addSubscription, removeSubscription, listSubscriptions, subject };

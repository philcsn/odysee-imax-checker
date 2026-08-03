'use strict';

const fs = require('fs');
const path = require('path');
const config = require('./config');

const FILE = path.join(config.stateDir, 'state.json');
const MAX_HISTORY = 200;

const EMPTY = {
  baselined: false, scannedAt: null, sessions: [], history: [],
  lastCheck: null, lastEmail: null, watchingSince: null,
  subscriptions: [], vapid: null, lastPush: null,
};

function load() {
  try {
    return { ...EMPTY, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) };
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('[store] unreadable state, starting fresh:', err.message);
    return { ...EMPTY };
  }
}

function save(state) {
  fs.mkdirSync(config.stateDir, { recursive: true });
  // Write-then-rename so a crash mid-write can't leave a truncated state file behind.
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, FILE);
}

function recordChange(state, change) {
  state.history.unshift(change);
  if (state.history.length > MAX_HISTORY) state.history.length = MAX_HISTORY;
}

/**
 * Compare a fresh scan against stored sessions.
 *
 * Two things keep this from crying wolf:
 *  - `now` scopes removals to sessions still in the future — a session that simply
 *    happened is not a cancellation.
 *  - `scannedDates` scopes removals to dates this run actually fetched, so a timed-out
 *    request reads as "no news" rather than "every showing that day was pulled".
 */
function diff(prevSessions, nextSessions, now, scannedDates) {
  const covered = new Set(scannedDates);
  const prevFuture = prevSessions.filter((s) => s.startTime >= now);
  const prevKeys = new Set(prevFuture.map((s) => s.key));
  const nextKeys = new Set(nextSessions.map((s) => s.key));

  const added = nextSessions.filter((s) => !prevKeys.has(s.key));
  const removed = prevFuture.filter((s) => covered.has(s.date) && !nextKeys.has(s.key));

  const prevDates = new Set(prevFuture.map((s) => s.date));
  const newDates = [...new Set(added.map((s) => s.date))].filter((d) => !prevDates.has(d)).sort();

  return { added, removed, newDates };
}

module.exports = { load, save, diff, recordChange, FILE };

'use strict';

const config = require('./config');
const ec = require('./eventcinemas');
const store = require('./store');
const notify = require('./notify');
const push = require('./push');

let running = false;
let runStartedAt = null;
let runId = 0;
let lastResult = null;

// Belt-and-braces above the scan deadline: if a run somehow outlives any plausible
// scan, a later tick takes over rather than being skipped forever. A stuck flag would
// silently stop every future check — the watcher would look alive and tell you nothing.
const STUCK_AFTER_MS = Math.max(60_000, config.maxScanMinutes * 3 * 60 * 1000);

/**
 * One full scan + diff + (maybe) notify. Safe to call concurrently — overlapping
 * calls return the in-flight marker rather than double-emailing.
 */
async function runCheck({ notifyOnChange = true } = {}) {
  if (running) {
    const stuckFor = runStartedAt ? Date.now() - runStartedAt : 0;
    if (stuckFor < STUCK_AFTER_MS) return { skipped: 'already-running' };
    console.warn(`[watch] previous run has been going ${Math.round(stuckFor / 1000)}s — assuming it wedged and starting fresh`);
  }
  running = true;
  const startedAt = Date.now();
  runStartedAt = startedAt;
  const myRun = ++runId;

  try {
    const scan = await ec.scan();
    const state = store.load();

    // Dates this run failed to fetch keep their previously known sessions, otherwise
    // they'd vanish from state now and reappear as "new" on the next successful run.
    const covered = new Set(scan.scannedDates);
    const carried = state.sessions.filter((s) => s.startTime >= scan.now && !covered.has(s.date));
    const sessions = [...scan.sessions, ...carried].sort(
      (a, b) => a.startTime.localeCompare(b.startTime) || a.key.localeCompare(b.key)
    );

    const result = {
      scannedAt: scan.scannedAt,
      durationMs: Date.now() - startedAt,
      total: sessions.length,
      dates: [...new Set(sessions.map((s) => s.date))].length,
      errors: scan.errors,
      added: [],
      removed: [],
      newDates: [],
      emailed: null,
      baselined: false,
    };

    if (!state.baselined) {
      // First ever run: adopt what's live as the baseline. Emailing 75 "new" sessions
      // the user already knows about would be noise, not a signal.
      console.log(`[watch] baseline established: ${sessions.length} sessions across ${result.dates} dates`);
      state.watchingSince = scan.scannedAt;
      result.baselined = true;
    } else {
      const d = store.diff(state.sessions, sessions, scan.now, scan.scannedDates);
      result.added = d.added;
      result.removed = d.removed;
      result.newDates = d.newDates;

      const worthTelling = d.added.length > 0 || (config.notifyOnRemoved && d.removed.length > 0);
      if (d.added.length || d.removed.length) {
        store.recordChange(state, {
          at: scan.scannedAt,
          added: d.added,
          removed: d.removed,
          newDates: d.newDates,
        });
        console.log(`[watch] change: +${d.added.length} / -${d.removed.length}`);
      }
      if (worthTelling && notifyOnChange) {
        result.emailed = await notify.sendChangeEmail({
          added: d.added,
          removed: config.notifyOnRemoved ? d.removed : [],
          newDates: d.newDates,
          total: sessions.length,
          movieName: sessions[0]?.movieName || config.movieCode,
          cinemaName: sessions[0]?.cinemaName || `Cinema ${config.cinemaIds.join(',')}`,
        });
        // Kept in state so a broken mailer shows up on the dashboard instead of
        // only in logs nobody reads — the failure mode that loses you a session.
        state.lastEmail = result.emailed;

        // Push runs alongside email, never instead of it: iOS subscriptions lapse
        // silently, so email stays the channel that can't quietly stop working.
        const newDateNote = d.newDates.length
          ? ` on ${d.newDates.length} new date${d.newDates.length === 1 ? '' : 's'}`
          : '';
        result.pushed = await push.sendPush({
          title: `${d.added.length} new session${d.added.length === 1 ? '' : 's'} — ${sessions[0]?.movieName || config.movieCode}`,
          body: `${d.added.length} showing${d.added.length === 1 ? '' : 's'} added${newDateNote} at ${sessions[0]?.cinemaName || 'your cinema'}.`,
          url: '/',
        });
        if (result.pushed && result.pushed.reason !== 'no-subscriptions') state.lastPush = result.pushed;
      }
    }

    // A scan holds `state` for ~50s, but /api/push/subscribe and sendPush's pruning both
    // write to the same file in that window. Re-read the fields they own before saving,
    // or this blind write silently drops a just-added subscription — or worse, reverts a
    // freshly generated VAPID keypair and invalidates every existing subscription.
    const onDisk = store.load();
    state.subscriptions = onDisk.subscriptions || state.subscriptions || [];
    state.vapid = onDisk.vapid || state.vapid;

    state.baselined = true;
    state.sessions = sessions;
    state.scannedAt = scan.scannedAt;
    // Backfill for state written before this field existed. Approximate — it marks
    // when the field was added, not the true baseline — but only affects a label.
    if (!state.watchingSince) state.watchingSince = state.lastCheck?.at || scan.scannedAt;
    state.lastCheck = {
      at: scan.scannedAt,
      total: sessions.length,
      dates: result.dates,
      added: result.added.length,
      removed: result.removed.length,
      errors: scan.errors.length,
      durationMs: result.durationMs,
    };
    store.save(state);

    if (scan.errors.length) console.warn(`[watch] ${scan.errors.length} date(s) failed:`, scan.errors.slice(0, 3));
    console.log(`[watch] ok — ${sessions.length} sessions / ${result.dates} dates in ${result.durationMs}ms`);

    lastResult = result;
    return result;
  } finally {
    // Only the newest run may clear the flag. A wedged run finishing later must not
    // release a lock the run that superseded it is now holding.
    if (myRun === runId) {
      running = false;
      runStartedAt = null;
    }
  }
}

function start() {
  const everyMs = config.pollMinutes * 60 * 1000;
  console.log(`[watch] watching ${config.label} — every ${config.pollMinutes} min, ${config.daysAhead} days ahead`);
  console.log(`[watch] email ${notify.isConfigured() ? `→ ${config.notifyTo}` : 'NOT configured'}`);
  runCheck().catch((err) => console.error('[watch] initial check failed:', err.message));
  setInterval(() => {
    runCheck().catch((err) => console.error('[watch] check failed:', err.message));
  }, everyMs);
}

module.exports = { runCheck, start, isRunning: () => running, getLastResult: () => lastResult };

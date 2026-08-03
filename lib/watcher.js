'use strict';

const config = require('./config');
const ec = require('./eventcinemas');
const store = require('./store');
const notify = require('./notify');

let running = false;
let lastResult = null;

/**
 * One full scan + diff + (maybe) notify. Safe to call concurrently — overlapping
 * calls return the in-flight marker rather than double-emailing.
 */
async function runCheck({ notifyOnChange = true } = {}) {
  if (running) return { skipped: 'already-running' };
  running = true;
  const startedAt = Date.now();

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
      }
    }

    state.baselined = true;
    state.sessions = sessions;
    state.scannedAt = scan.scannedAt;
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
    running = false;
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

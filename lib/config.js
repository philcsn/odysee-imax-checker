'use strict';

/**
 * All watcher config lives here so a second movie/cinema is an env change, not a code change.
 */

const num = (v, d) => (v === undefined || v === '' ? d : parseInt(v, 10));

const config = {
  // What to watch
  cinemaIds: (process.env.CINEMA_IDS || '96').split(',').map((s) => s.trim()).filter(Boolean),
  movieCode: process.env.MOVIE_CODE || 'ODYSSEY',
  movieUrl: process.env.MOVIE_URL || 'https://www.eventcinemas.com.au/movie/the-odyssey',

  // How far ahead to look. The cinema currently only publishes ~3 weeks out, so the
  // window has to overshoot to catch dates as they open up.
  daysAhead: num(process.env.DAYS_AHEAD, 70),

  // Cinema-local timezone — decides what "today" means and which sessions are in the past.
  timezone: process.env.TIMEZONE || 'Australia/Sydney',

  // Polling
  pollMinutes: num(process.env.POLL_MINUTES, 30),

  // Notifications
  notifyTo: process.env.NOTIFY_TO || process.env.SMTP_USER || '',
  notifyOnRemoved: process.env.NOTIFY_ON_REMOVED === 'true',

  // Persistence. On Railway, mount a volume and set STATE_DIR to its mount path,
  // otherwise state resets on every deploy and the first run re-baselines silently.
  stateDir: process.env.STATE_DIR || './data',

  port: num(process.env.PORT, 3000),
};

config.label = `${config.movieCode} @ cinema ${config.cinemaIds.join(',')}`;

module.exports = config;

'use strict';

const config = require('./config');

const BASE = 'https://www.eventcinemas.com.au/Cinemas/GetSessions';
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// ─── Cinema-local clock ───────────────────────────────────────────────────────
// Session StartTimes come back as naive local strings ("2026-08-24T10:00"), and the
// server runs in UTC, so every "is this today / in the past" question has to be asked
// in the cinema's timezone or the watcher drops or resurrects sessions around midnight.

function localParts(tz, date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const g = (t) => parts.find((p) => p.type === t).value;
  return { date: `${g('year')}-${g('month')}-${g('day')}`, time: `${g('hour')}:${g('minute')}` };
}

function localToday(tz = config.timezone) {
  return localParts(tz).date;
}

/** "2026-08-03T14:37" in cinema-local time — comparable to a session's StartTime. */
function localNowStamp(tz = config.timezone) {
  const { date, time } = localParts(tz);
  return `${date}T${time}`;
}

function addDays(isoDate, n) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// ─── API ──────────────────────────────────────────────────────────────────────

async function fetchDate(date, { retries = 2 } = {}) {
  const url = `${BASE}?cinemaIds=${config.cinemaIds.join(',')}&date=${date}`;
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: 'application/json' },
        signal: AbortSignal.timeout(25000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (!json || json.Success !== true) throw new Error('API returned Success != true');
      return json;
    } catch (err) {
      if (attempt >= retries) throw new Error(`${date}: ${err.message}`);
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
}

function extractSessions(json, date) {
  const out = [];
  const movies = json?.Data?.Movies || [];
  for (const movie of movies) {
    if (movie.MovieCode !== config.movieCode) continue;
    for (const cinema of movie.CinemaModels || []) {
      for (const s of cinema.Sessions || []) {
        out.push({
          key: `${cinema.Id}|${s.StartTime}|${s.ScreenType || ''}`,
          id: s.Id,
          cinemaId: cinema.Id,
          cinemaName: cinema.Name,
          movieName: movie.Name,
          date,
          startTime: s.StartTime,
          time: (s.StartTime || '').slice(11),
          screenType: s.ScreenType || '',
          soldOut: !!s.SoldOut,
        });
      }
    }
  }
  return out;
}

/**
 * Scan the whole window. Returns only sessions that haven't started yet — past
 * sessions would otherwise churn in and out of the diff as the day advances.
 */
async function scan({ onProgress } = {}) {
  const today = localToday();
  const now = localNowStamp();
  const sessions = [];
  const scannedDates = [];
  const errors = [];

  const deadline = Date.now() + config.maxScanMinutes * 60 * 1000;

  for (let i = 0; i <= config.daysAhead; i++) {
    const date = addDays(today, i);
    // Stopping short is safe: removals are only computed over scannedDates, so an
    // unscanned tail reads as "no news" rather than "everything was cancelled".
    if (Date.now() > deadline) {
      errors.push(`deadline hit after ${i} of ${config.daysAhead + 1} dates`);
      break;
    }
    try {
      const json = await fetchDate(date);
      for (const s of extractSessions(json, date)) {
        if (s.startTime >= now) sessions.push(s);
      }
      scannedDates.push(date);
    } catch (err) {
      errors.push(err.message);
    }
    if (onProgress) onProgress(i + 1, config.daysAhead + 1);
    // The endpoint is CDN-cached (max-age 300) but this is still someone else's box.
    await new Promise((r) => setTimeout(r, 120));
  }

  sessions.sort((a, b) => a.startTime.localeCompare(b.startTime) || a.key.localeCompare(b.key));
  return {
    scannedAt: new Date().toISOString(),
    today,
    now,
    windowEnd: addDays(today, config.daysAhead),
    sessions,
    scannedDates,
    errors,
  };
}

module.exports = { scan, fetchDate, extractSessions, localToday, localNowStamp, addDays };

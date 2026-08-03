'use strict';

const path = require('path');
const express = require('express');
const config = require('./lib/config');
const store = require('./lib/store');
const notify = require('./lib/notify');
const push = require('./lib/push');
const watcher = require('./lib/watcher');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/healthz', (req, res) => res.json({ ok: true, watching: config.label }));

app.get('/api/state', (req, res) => {
  const state = store.load();
  res.json({
    config: {
      movieCode: config.movieCode,
      movieUrl: config.movieUrl,
      cinemaIds: config.cinemaIds,
      daysAhead: config.daysAhead,
      pollMinutes: config.pollMinutes,
      timezone: config.timezone,
      notifyTo: config.notifyTo ? config.notifyTo.replace(/^(.).*(@.*)$/, '$1•••$2') : null,
      emailConfigured: notify.isConfigured(),
      emailProblem: notify.configProblem(),
      emailProvider: notify.provider(),
      mailFrom: notify.fromAddress(),
    },
    lastEmail: state.lastEmail,
    lastPush: state.lastPush,
    pushSubscriptions: (state.subscriptions || []).length,
    lastCheck: state.lastCheck,
    watchingSince: state.watchingSince,
    checking: watcher.isRunning(),
    movieName: state.sessions[0]?.movieName || null,
    cinemaName: state.sessions[0]?.cinemaName || null,
    sessions: state.sessions,
    history: state.history,
  });
});

app.post('/api/check', async (req, res) => {
  try {
    const result = await watcher.runCheck();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Push ─────────────────────────────────────────────────────────────────────

app.get('/api/push/key', (req, res) => res.json({ publicKey: push.publicKey() }));

app.post('/api/push/subscribe', (req, res) => {
  try {
    const count = push.addSubscription(req.body);
    console.log('[push] subscription added, now', count);
    res.json({ ok: true, subscriptions: count });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/push/unsubscribe', (req, res) => {
  const removed = push.removeSubscription(req.body && req.body.endpoint);
  res.json({ ok: true, removed });
});

app.post('/api/push/test', async (req, res) => {
  const result = await push.sendPush({
    title: 'IMAX Watch is connected',
    body: 'This is what a new-showings alert will look like.',
    url: '/',
  });
  const state = store.load();
  state.lastPush = { ...result, test: true };
  store.save(state);
  res.status(result.sent > 0 ? 200 : 503).json(result);
});

app.post('/api/test-email', async (req, res) => {
  const state = store.load();
  const sample = state.sessions.slice(0, 3);
  const result = await notify.sendChangeEmail({
    added: sample,
    removed: [],
    newDates: [...new Set(sample.map((s) => s.date))],
    total: state.sessions.length,
    movieName: sample[0]?.movieName || config.movieCode,
    cinemaName: sample[0]?.cinemaName || `Cinema ${config.cinemaIds.join(',')}`,
  });
  state.lastEmail = { ...result, test: true };
  store.save(state);
  res.status(result.sent ? 200 : 503).json(result);
});

app.listen(config.port, () => {
  console.log(`[server] listening on :${config.port}`);
  watcher.start();
});

'use strict';

// Run a single scan + diff without starting the server. Useful locally and as a
// Railway cron target if you'd rather not keep a process alive.
const watcher = require('../lib/watcher');

watcher
  .runCheck()
  .then((r) => {
    console.log(JSON.stringify({ ...r, added: r.added.length, removed: r.removed.length }, null, 2));
    process.exit(0);
  })
  .catch((err) => {
    console.error('check failed:', err.message);
    process.exit(1);
  });

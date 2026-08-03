# Deploy

Always run from this directory:

```
cd /Users/philcarstensen/Claude/eventcinemas-watch
railway up --service eventcinemas-watch --detach
```

Never run `railway up` from the parent `/Users/philcarstensen/Claude/` — that directory
has its own `package.json` and will deploy the wrong server.

## First-time setup

```bash
cd /Users/philcarstensen/Claude/eventcinemas-watch
railway init                     # or: railway link, to attach to an existing project
railway up --service eventcinemas-watch --detach
railway domain                   # generates the public URL for the dashboard
```

### 1. Add a volume (required)

Without it the container's disk resets on every deploy, the watcher re-baselines, and
**any sessions added during that window are never reported**. In the Railway dashboard:

- Service → **Variables/Settings → Volumes → New Volume**
- Mount path: `/data`

Then set `STATE_DIR=/data`.

### 2. Set variables

```bash
railway variables --set STATE_DIR=/data \
                  --set NOTIFY_TO=you@example.com \
                  --set CINEMA_IDS=96 \
                  --set MOVIE_CODE=ODYSSEY \
                  --set TIMEZONE=Australia/Sydney \
                  --set POLL_MINUTES=30 \
                  --set DAYS_AHEAD=70
```

SMTP — copy the values already working on `atrya-site`:

```bash
railway variables --set SMTP_HOST=... --set SMTP_PORT=587 \
                  --set SMTP_USER=... --set SMTP_PASS=...
```

> iCloud note: if you send via iCloud SMTP (`smtp.mail.me.com:587`), `SMTP_PASS` must be
> an **app-specific password** from appleid.apple.com, not your Apple ID password.

### 3. Verify

```bash
curl https://<your-domain>/healthz
curl -X POST https://<your-domain>/api/test-email    # should land in your inbox
```

Then open the dashboard — the red "email is not configured" banner should be gone, and
the first check will have set the baseline. You'll be emailed on the next real change.

## Notes

- The first deploy sends **no** email by design — it records the current 75 sessions as
  the baseline. The next added showing is what triggers the first alert.
- Each check is ~71 requests over ~10s against a CDN-cached endpoint. At the default
  30-minute cadence that's well within reasonable use; don't drop `POLL_MINUTES` much
  lower without a reason.
- Logs: `railway logs --service eventcinemas-watch`. Each run prints
  `[watch] ok — N sessions / M dates`.

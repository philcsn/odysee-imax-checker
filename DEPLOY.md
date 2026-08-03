# Deploy

**Live:** https://odysee-imax-checker-production.up.railway.app
**Railway project:** `odysee-imax-checker` · service `odysee-imax-checker` · volume mounted at `/data`
**GitHub:** `philcsn/odysee-imax-checker`

> The Railway service is **not** yet connected to the GitHub repo — Railway's GitHub App
> couldn't see the freshly created repo, so this deployed from local source. Until you
> connect it (Railway dashboard → service → Settings → Source → Connect Repo), pushes to
> GitHub will *not* auto-deploy; redeploy with `railway up` from this directory.

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

### Email via Resend (preferred)

```bash
railway variables --set RESEND_API_KEY=re_your_key_here
```

That's enough to start: the sender defaults to `onboarding@resend.dev`, which delivers
**only** to the address your Resend account is registered with. If `NOTIFY_TO` is a
different address you'll get a 403, and the dashboard will say so.

To send from your own domain to any recipient, verify `atrya.io` in Resend
(Domains → Add Domain, then add the SPF + DKIM records it gives you) and set:

```bash
railway variables --set MAIL_FROM_ADDRESS=watch@atrya.io
```

<details><summary>SMTP fallback</summary>

Only used when `RESEND_API_KEY` is unset.

```bash
railway variables --set SMTP_HOST=... --set SMTP_PORT=587 \
                  --set SMTP_USER=... --set SMTP_PASS=...
```

Resend's SMTP username is the literal `resend`, so `MAIL_FROM_ADDRESS` is mandatory there.
For iCloud SMTP (`smtp.mail.me.com:587`), `SMTP_PASS` must be an **app-specific password**
from appleid.apple.com, not your Apple ID password.
</details>

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

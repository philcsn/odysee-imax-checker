# Event Cinemas Watch

Watches Event Cinemas session listings for a given movie + cinema and emails you when
new showings are added — across **all** dates, not just the one in the page URL.

Built for **The Odyssey @ IMAX Sydney (cinema 96)**, but every target is an env var.

## How it works

The booking page loads its showtimes from an unauthenticated JSON endpoint:

```
GET https://www.eventcinemas.com.au/Cinemas/GetSessions?cinemaIds=96&date=2026-08-24
```

It only answers for **one date at a time** — there's no "all dates" mode, and the
movie-level `LastSession` field spans all cinemas so it can't be used as a shortcut.
So each run walks the next `DAYS_AHEAD` dates (~71 requests, about 10 seconds),
collects every session for `MOVIE_CODE`, and diffs the result against the last run.

This matters because the cinema publishes its schedule in waves. At the time of
writing, IMAX Sydney had 75 sessions listed through **26 Aug** and nothing beyond,
even though the film runs into September — the later dates simply hadn't opened yet.
Those are exactly the additions this watches for.

### Not crying wolf

Three things stop routine churn from firing a false alert:

- **Past sessions are pruned, never "removed".** Sessions are compared in the cinema's
  own timezone (`TIMEZONE`), so a 1:50pm showing that simply started is dropped quietly.
- **Failed fetches don't read as cancellations.** Removals are only reported for dates
  the run actually fetched successfully; a timed-out date keeps its previously known
  sessions and is retried next run.
- **The first run never emails.** It adopts whatever is live as the baseline, so you
  don't get one message listing every session you already knew about.

By default only **additions** trigger email. Set `NOTIFY_ON_REMOVED=true` to also be
told when a showing disappears.

## Endpoints

| Route | Purpose |
|---|---|
| `GET /` | Dashboard — sessions by date, change history, last check |
| `GET /api/state` | Full state as JSON |
| `POST /api/check` | Run a check immediately |
| `POST /api/test-email` | Send a sample email to verify SMTP |
| `GET /healthz` | Railway health check |

## Config

See `.env.example`. The ones that matter:

| Var | Default | Notes |
|---|---|---|
| `CINEMA_IDS` | `96` | Comma-separated. 96 = IMAX Sydney |
| `MOVIE_CODE` | `ODYSSEY` | From the API's `MovieCode` field |
| `DAYS_AHEAD` | `70` | Must overshoot the published schedule |
| `POLL_MINUTES` | `30` | |
| `TIMEZONE` | `Australia/Sydney` | Cinema-local, not server-local |
| `NOTIFY_TO` | — | Where alerts go |
| `RESEND_API_KEY` | — | Preferred mailer; wins over SMTP if both are set |
| `MAIL_FROM_ADDRESS` | `onboarding@resend.dev` | Must be a verified Resend sender |
| `SMTP_HOST/PORT/USER/PASS` | — | Fallback. Same vars as `atrya-site` |
| `STATE_DIR` | `./data` | **Point at a Railway volume** — see DEPLOY.md |

## Email

Resend's HTTP API is used in preference to its SMTP bridge: it answers on 443, returns a
message id, and fails with a readable reason. That reason is persisted to state and shown
on the dashboard, because a mailer that fails quietly defeats the point of the watcher.

The default sender `onboarding@resend.dev` is Resend's sandbox — it can **only** deliver
to the address the Resend account was registered with. A 403 from that sender is
explained inline in the error. To send from your own address to anywhere, verify a domain
in Resend and set `MAIL_FROM_ADDRESS` (e.g. `watch@atrya.io`).

Note that Resend's *SMTP* username is the literal string `resend`, which is not a valid
From address — so `MAIL_FROM_ADDRESS` is required on that path, and the app refuses to
start sending rather than emitting a malformed header.

### Watching something else

Find the target's `MovieCode` and cinema id from any listing:

```bash
curl -s 'https://www.eventcinemas.com.au/Cinemas/GetSessions?cinemaIds=96&date=2026-08-24' \
  | python3 -c "import json,sys; [print(m['MovieCode'], '—', m['Name']) for m in json.load(sys.stdin)['Data']['Movies']]"
```

## Local

```bash
npm install
npm run check   # one scan, prints the diff, no server
npm start       # server + dashboard on :3200
```

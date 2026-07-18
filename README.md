# Timesheet Automation

A Playwright-based automation tool that fills and submits a weekly timesheet on an internal ASP.NET WebForms portal — built to eliminate a repetitive daily task that's easy to forget in a busy sprint.

## Why

Manually logging hours every day is small, repetitive, and exactly the kind of task that slips through the cracks when you're deep in PR reviews, debugging, or handling five other things at once. This automates it end-to-end: log in once, and the tool fills a full work week (Mon–Fri), handles validation errors gracefully, and publishes the entries.

## How it works

1. **One-time manual login** (`setup-login.js`) — opens a real browser, you log in by hand exactly as you normally would, and the authenticated session is captured and saved locally.
2. **Automated run** (`run-timesheet.js`) — loads the saved session (no credentials stored or hardcoded anywhere), navigates to the timesheet page, and fills one row per weekday with project, task, hours, and remarks.
3. **Validation-aware** — if a row is rejected (duplicate entry, already-published date, future date, unsaved-row conflict), the script classifies the failure, takes a screenshot for evidence, discards the row cleanly, and moves to the next date instead of crashing.
4. **Publishes** all saved entries for the week and takes a final confirmation screenshot.

## Setup

```bash
npm install
npx playwright install chromium
node setup-login.js   # one-time: log in manually when the browser opens
node run-timesheet.js # fills and publishes the current work week
```

Session is saved to `.auth/session.json` (gitignored — this is a live login token, treat it like a password). Re-run `setup-login.js` whenever the session expires; the main script detects an expired session and tells you to do this rather than failing silently.

## Configuration

Edit the constants at the top of `run-timesheet.js`:

```js
const PROJECT = "Miscellaneous Task";
const TASK = "Random Development Work/Unassigned";
const PERCENT_FINISH = "100%";
const HOURS = "9";
const REMARKS = "Worked on Project UI";
```

Set `HEADLESS=true` in `.env` to run without a visible browser (e.g. for scheduled/unattended runs). Set `WEEK_START=YYYY-MM-DD` (a Monday) to backfill a specific week instead of the current one.

## Scheduling

Runs cleanly under Task Scheduler (Windows) or cron (Mac/Linux) for a hands-off Mon–Fri routine. Session lifetime on ASP.NET WebForms portals varies — if a scheduled run fails, check the log for the "session expired" message and re-run setup.

## Tech

Node.js, Playwright — no framework, no backend, no database. Built for a single ASP.NET WebForms portal; the row-fill logic (dropdown selection, postback timing, date-triggered form resets) is portal-specific and would need adjusting for a different HRMS.

## Roadmap

- Pull actual logged hours from Jira instead of a fixed daily value
- Generalize the row-fill logic for other common HRMS portals (e.g. Keka)

## Note

Built and tested against a single company's internal portal. Not affiliated with or endorsed by that company — shared as a personal automation project and portfolio piece.

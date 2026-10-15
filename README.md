# Office Time Calculator

React + TypeScript app that works out when you can leave the office.

**The rule:** `exit = first punch-in + 8h work + every break minute`

Lunch is just break time — take it whenever. A 15-minute break moves a 9:00 AM
start from 5:00 PM to 5:15 PM. All times and dates are shown in **Indian Standard
Time (UTC+05:30)** on a 12-hour clock, whatever offset the API sends and whatever
time zone the machine is set to.

## Use it

Open **`dist/index.html`** — double-click it. One self-contained file, no server,
no internet needed. Your sessions are saved in the browser, so they survive a refresh.
Every day you load is kept, not just the current one — see **History** below.

The app is a sidebar shell — **Zil Time** — with five places to be. It is black
and white throughout, with raised, lit-from-above surfaces.
The mark beside the name is the same open ring the dashboard draws, and its tip
pulses while a session is running.

| | |
|---|---|
| **Dashboard** | the **HR live** panel at the top ([details](#live-attendance-hr-api)), then the ring counter, date and exit cards, the four stat tiles, Sessions & Breaks and Efficiency |
| **Insights** | what the day says: session lengths, break pattern, what has pushed the exit, plus totals across every stored day |
| **History** | the month/day filter and every stored day; tap one to open it up |
| **Export** | pick which stored day to save, then Drive / CSV / spreadsheet |
| **Settings** | work target and free-break minutes, and clearing stored data |

There is no start/stop timer: punches arrive from the HR API by themselves
(see [Live attendance](#live-attendance-hr-api)), and the foot of the sidebar
shows whether that sync is working. A day is marked **Saved** in History as soon
as every session on it is punched out; punching back in returns it to *In
progress* until the next punch-out.

**Add session** (on the dashboard, and in Export) takes a **date** as well as the
punch times, so a day can be typed in from scratch — including a date you have
nothing stored for. It starts on the day you are looking at, and the app jumps to
whatever day the entry lands on.

Paste your punch API response and hit *Load JSON* (or Ctrl+Enter), or add punches
by hand underneath. A preview under the box tells you what will land before you
commit.

A response carrying `sessions_today` is treated as the authority for that day, so
pasting a newer one **replaces** the day: sessions and breaks both re-derive from
exactly what you pasted. Open sessions gain their `punch_out`, new punches appear,
and anything removed upstream disappears instead of lingering. A response with only
`current_session` merges instead. Either way a punch is identified by the minute it
started, so the same punch never lands twice — even if you typed it by hand first.

## History

Everything you load stays in local storage, filed by date. The **History** view
lists every stored day — first punch to last, work total, break total, and
when that day was last written — and two dropdowns narrow it:

- **Month** — `All months`, or one month, which also narrows the day list.
- **Day** — `Latest day` (follows the newest day you have, so today stays live),
  or a specific date.

The calculator always works on exactly **one** day: picking a day recalculates the
whole page for it — counter, exit time, sessions, summary and the Sheets export
alike. A day that is over stops at its last punch-out rather than counting on, and
a day left open (punched in, never out) freezes at that day's end.

Both dropdowns are remembered, so you come back to what you were looking at, and
the **Day to save** picker in Export is the same choice — the day you export is
the day you are looking at. `Clear day` removes only the day on screen; the `×`
on a row removes that row's day; `Clear history` empties the lot.

**Tap a day** to open it up: first in, last out, every session and break with its
times and length, and the day's work, break, office and exit totals. Each row is
badged **Saved** or **In progress**, and the panel has *Show on dashboard* and
*Edit day*.

## The day sheet

**Add to History**, next to the stat tiles on the dashboard — and *Edit day* in
History — opens the day as an editable sheet, the same shape the export writes:

```
No. | Type | Punch in | Punch out | Duration
```

Every punch is editable, breaks included. A break is only the gap between two
sessions, so editing its start moves the punch-out in front of it and editing its
end moves the punch-in after it. A running session has an empty Punch out with a
*Now* button — this is where the punch-out you forgot gets typed. Rows can be
added and removed, the totals under the sheet re-add themselves as you type, and
the line above the buttons says whether the day reads cleanly.

**Submit to history** writes those punches and marks the day **Saved**. It saves
locally only — exporting stays the deliberate action in Export. Nothing depends on
pressing it: days are still written to storage as they happen. Change a saved day
afterwards, by any route, and it goes back to *In progress* — it is no longer the
day that was signed off.

## The 3D bits

Two pieces are WebGL, drawn with **three.js**:

- **The timer ring** — a torus whose progress arc is a shader that discards the
  fragments past the current angle, so filling it costs one uniform rather than a
  new geometry each frame. The head sphere rides the end of the arc, the shade
  eases between white and grey as the day changes state, and it pulses
  while the clock is running.
- **Insights → Last N stored days** — work and break columns per day against the
  goal line, on a long lens so the outer columns stay upright.

They share `src/three/useScene.ts`, which owns the renderer, the resize observer,
the frame loop and the teardown (geometries, materials, context). Values reach the
loop through refs, so the ticking clock never rebuilds a scene. Idle motion stops
under `prefers-reduced-motion` while values still ease, and if a WebGL context
cannot be created the ring falls back to a plain CSS ring and the chart hides
itself — nothing in the app depends on WebGL being there.

Three.js is why `dist/index.html` is ~890 kB (~247 kB gzipped) rather than ~360 kB.

## Cookies & storage

Saving is automatic: punches, settings and the Apps Script connection are
written to local storage without being asked for, including what the HR sync
brings in every minute. The app sets **no cookies**, loads no third party and
sends nothing anywhere else.

**Settings → Storage → Stop & wipe** turns saving off and deletes everything
already saved (`otc.v3`, the older `otc.v2`/`otc.v1`, and the export connection
keys); the app keeps working for the session. **Save in this browser** turns it
back on. Only that choice is remembered, under `otc.consent`.

## Google Sheets

The **Send to Google Sheet** card exports the day as one row per work session
and per break, with the day totals repeated on every row so the sheet stays
easy to filter and pivot:

```
Date | Day | Type | No. | Punch In | Punch Out | Duration | Minutes | Total Work | Total Break | Time In Office | Can Leave At
```

Three ways out, in order of setup effort:

- **Copy for Sheets** — puts tab-separated rows on the clipboard; paste straight
  into a cell range. No setup at all.
- **Download CSV** — `office-time-07-08-2026.csv`, for File → Import.
- **Append to sheet** — one click, straight into the sheet. Needs the one-time
  Apps Script setup below.

### One-time Apps Script setup

1. In your sheet: **Extensions → Apps Script**.
2. Paste all of `google-apps-script.gs` from this folder.
3. **Deploy → New deployment → Web app**, execute as **Me**, access **Anyone**.
4. Copy the `/exec` URL into the app's "Apps Script web app URL" box — it is
   remembered, so afterwards it is a single click.

The script creates an **Office Time** tab with a frozen header row, and
**replaces** any rows already present for that date, so pressing Append twice
never duplicates a day. Opening the `/exec` URL in a browser returns a small
JSON health check, which is a quick way to confirm the deployment works.

Because Apps Script responds from a host that sends no CORS headers, the append
is deliberately fire-and-forget — the app cannot read the reply, so it reports
"sent" rather than "confirmed". Check the sheet the first time.

## Live attendance (HR API)

The **HR live** panel sits at the top of the Dashboard. It signs in to the HR
API and shows what that API says, so it needs a server component — the rest of
the app does not.

- **Automatic sync** — while signed in, a device pull runs straight away and
  then every 60s, on any screen, followed each time by a re-read of today. What
  comes back goes into the store by itself, so the ring, tiles, Sessions &
  Breaks, History and Export are all live. A bar under the header counts down
  to the next one. Automatic failures show on the panel rather than as a toast.
- **Sync now** — the same thing, out of turn.
- The sign-in dialog opens by itself once; after that, use **Sign in to HR**.
- The four tiles carry **live seconds** on whichever value is actually moving —
  worked while you work, break while you are on one, and the exit time only once
  a break is past the free allowance and genuinely pushing it back.

```
npm run server     # the attendance proxy on :8787
npm run dev        # in a second terminal; /api/punch is proxied to :8787
```

For production, `npm run build` then `npm start` — the same process serves
`dist/` and `/api/punch` on one origin, which is what makes the session cookie work.

### Why a proxy is not optional

Two independent reasons, either one on its own would be enough:

1. **CORS.** `api.hr.zilmoney.com` answers preflights with
   `Access-Control-Allow-Origin: https://hr.zilmoney.com` and nothing else. From
   `localhost:5173`, or from the single-file build on `file://` (Origin `null`),
   the preflight comes back with no allow-origin header at all and the browser
   refuses the request. This cannot be worked around in frontend code.
2. **The token.** Sign-in returns a Sanctum bearer token. Anything the page can
   read, an XSS can read — `localStorage`, `sessionStorage`, a non-httpOnly
   cookie, a JS variable. The token therefore never reaches the browser.

### Where credentials are handled

| Secret | Lives | Notes |
| --- | --- | --- |
| Password | Nowhere | Typed into the form, sent once to `POST /api/punch/login`, never stored |
| HR session cookie | `server/index.mjs`, in memory | The login body carries no token — the credential is the cookie, replayed with `X-XSRF-TOKEN` |
| Session id | httpOnly `punch_sid` cookie | `SameSite=Lax`; JavaScript cannot read it |

`src/api/attendance.ts` only ever calls same-origin `/api/punch/*`. There is no HR
hostname, token, or credential anywhere in `src/`, so nothing sensitive is
compiled into `dist/index.html`.

### Endpoints

| Route | Does |
| --- | --- |
| `POST /api/punch/login` | `{email, password}` → upstream `/api/auth/login`; keeps the session cookie it issues |
| `GET /api/punch/session` | Whether the cookie still maps to a live session |
| `GET /api/punch/today` | → upstream `/api/attendance/my-today` (GET-only) — the punches |
| `POST /api/punch/sync` | `{start_date, end_date}` → upstream `/api/attendance/my-sync` — pulls the devices, returns a report |
| `GET /api/punch/sync-status` | → upstream `/api/attendance/my-sync-status` (GET-only) |
| `POST /api/punch/logout` | Drops the session and clears the cookie |

An upstream 401 deletes the session and returns 401, which drops the UI back to
the sign-in form rather than showing a stale report.

### Configuration

All optional; the defaults match the live API.

| Variable | Default |
| --- | --- |
| `PUNCH_API_BASE` | `https://api.hr.zilmoney.com` |
| `PUNCH_LOGIN_PATH` | `/api/auth/login` |
| `PUNCH_SYNC_PATH` | `/api/attendance/my-sync` |
| `PUNCH_SYNC_STATUS_PATH` | `/api/attendance/my-sync-status` |
| `PUNCH_TODAY_PATH` | `/api/attendance/my-today` |
| `PORT` | `8787` |
| `SESSION_TTL_HOURS` | `8` |
| `COOKIE_SECURE` | unset — set to `1` behind HTTPS |

### Which route does what

The three upstream routes are easy to mix up, and only one of them has data:

- **`my-today`** (GET) — today's punches. It answers in the same `PunchPayload`
  shape the Telemetry box accepts, so `parsePayload` in `src/compute.ts` reads it
  and `computeDay` produces the tiles — no second calculator.
- **`my-sync`** (POST, needs `start_date`/`end_date`) — pulls records off the
  punch devices into HR and returns a report (`Sync completed. Added 0 new
  records.`, plus a per-device breakdown). It returns **no attendance data**;
  **Sync now** calls it and then re-reads `my-today`.
- **`my-sync-status`** (GET) — where the last pull got to.

`my-sync` and `my-sync-status` are method-fussy: POST to the status route, or GET
the sync route, and Laravel answers 405.

### Response shape

 `normalise()` in `src/api/attendance.ts` accepts the shapes a Laravel
resource realistically returns — `{data: []}`, `{data: {records: []}}`,
`{attendance: []}`, a bare array — and the usual field spellings
(`punch_in`/`in_time`/`check_in`, nested `sessions[]`, `total_hours` vs
`total_minutes`). **Show raw response** on the screen prints exactly what came
back; if a field is missing from the tiles, that panel says which key to add.

Note this panel is the one part of the app that needs a server, so it is inert
in the double-clickable `file://` build — everything else still works there.

## Develop

```
npm install
npm run dev        # hot-reloading dev server
npm run server     # the attendance proxy on :8787 (only the Attendance screen needs it)
npm run typecheck  # tsc --noEmit, strict
npm run build      # -> dist/index.html (single file)
npm start          # serve dist/ + /api/punch on one origin
```

## Layout

```
src/
  types.ts               Session, Block, DayResult, the API payload shape
  time.ts                IST formatting + ISO parsing (absolute UTC ms internally)
  compute.ts             the calculation, payload parsing, merge/shift helpers
  history.ts             stored punches -> days and months, and which day is shown
  useStore.ts            localStorage persistence + the shared clock hook
  useConsent.ts          the storage consent, and wiping on reject
  api/attendance.ts      HR API client (same-origin only) + response normalising
  useAttendance.ts       sign-in, date range, and the fetch's loading/error state
  three/useScene.ts      renderer, resize, frame loop and disposal for every canvas
  verdict.ts             the one-line read on the day, shown in the status bar
  App.tsx                shell, view switching, handlers
  components/
    Logo.tsx             the mark — the timer ring reduced to 20px
    Sidebar.tsx          brand, nav, live-sync status
    TopBar.tsx           the day being viewed
    Hero.tsx             ring counter, progress, status, date card, exit card
    Counter.tsx          count-up with per-place digit roll
    StatsStrip.tsx       worked / break / remaining / first in (/ overtime)
    SessionTable.tsx     sessions & derived breaks, Add Manual, Save Day
    Efficiency.tsx       percentage + donut
    StatusBar.tsx        the verdict line under the dashboard
    Insights.tsx         per-day facts + totals across stored days
    HistoryPanel.tsx     month/day filter, stored days, tap to open one up
    DaySheetModal.tsx    the editable day sheet — punches, breaks, totals, submit
    Settings.tsx         work target, free break, storage on/off, clear stored data
    TimerRing3D.tsx      the WebGL progress ring
    DayBars3D.tsx        work and break columns per stored day
    Icons.tsx            inline SVG icon set
    AttendancePanel.tsx  the HR live panel on the dashboard — sync controls, tiles
    HrLoginModal.tsx     the email + password dialog for the HR API
    Toast.tsx            feedback
```

## Notes

- Breaks are never typed in — they are the gaps between sessions.
- While you're on a break the exit time slides later in real time.
- Data from an earlier day freezes instead of counting up forever; a banner
  offers to shift it onto today. The banner stays out of the way while you are
  browsing history on purpose — shifting moves only the day on screen.
- Storage is `otc.v3`; `otc.v2` and `otc.v1` are migrated on first load, and days
  that arrived before the history existed are dated from their last punch.
- `dist/index.html` is emitted as a classic inline script at the end of `<body>`
  so it runs correctly from `file://`.

```
server/
  index.mjs              the attendance proxy: sign-in, token custody, my-sync
```

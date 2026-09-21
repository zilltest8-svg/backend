# Zil Time — Flutter

The office time calculator, ported from the React app in `../src` to Flutter.
It targets **web** and **Windows**. The React app is untouched and still works;
this lives beside it and shares the same attendance proxy (`../server`).

The rule it implements is unchanged:

    exit = first punch-in + work target + every break minute

## Run it

```sh
cd flutter_app
flutter pub get

flutter run -d windows          # desktop
flutter run -d chrome           # web, on http://localhost:5173
flutter test                    # calculator, parser, export, PDF and layout tests
```

Live attendance needs the proxy from the repo root, exactly as the React app does:

```sh
npm run server                  # http://localhost:8787 — needs PUNCH_SECRET, see ../.env.example
```

- **Web** calls `/api/punch/*` on its own origin. In development
  `web_dev_config.yaml` forwards that to `127.0.0.1:8787`, the job
  `vite.config.ts` does for the React app.
- **Windows** calls the address under *Settings → Attendance proxy*
  (`http://localhost:8787` by default; bake in another with
  `--dart-define=PUNCH_PROXY=https://your-host`). A desktop app has no cookie
  jar, so the proxy's sealed session cookie is stored with the app's data and
  you stay signed in across restarts, until the proxy expires it
  (`SESSION_TTL_HOURS`, 8 by default).

Once signed in, the app syncs with the HR API every 60 seconds on its own — on
any screen — and what comes back is saved on this device automatically. There
is no start/stop timer: punches come from HR (or are added by hand).

Everything else — manual sessions, pasting a response, history, CSV
and PDF export — works with no server at all.

## Build

```sh
flutter build windows           # build/windows/x64/runner/Release/
flutter build web               # build/web/
```

The web build has to be served from the same origin as `/api/punch`, because
the session is an httpOnly cookie. On Vercel that means publishing `build/web`
as the static output next to the existing `api/punch` function.

## Layout

| Path | What is in it | Ported from |
| --- | --- | --- |
| `lib/core/` | Pure Dart, no Flutter: IST time formatting, `computeDay`, payload parsing, history, CSV rows, the PDF writer, the Apps Script template | `time.ts`, `compute.ts`, `history.ts`, `export.ts`, `pdf.ts`, `historyPdf.ts`, `appsScript.ts`, `verdict.ts` |
| `lib/state/` | `AppState` (store, consent, filter, toast, clock), the HR attendance client and controller, the Drive connection | `useStore.ts`, `useConsent.ts`, `useAttendance.ts`, `api/attendance.ts`, `useSheet.ts`, `App.tsx` |
| `lib/platform/` | The only web/desktop split: saving a file, reading an Apps Script reply (JSONP in a browser, a plain GET on desktop), reading the React app's old `localStorage` | `saveBlob`, `jsonp` |
| `lib/ui/` | Theme, shared widgets, the shell, the four screens, the dialogs, and the animated visuals | `components/`, `styles.css` |

## What changed in the port

- **3D visuals are 2D.** The three.js backdrop, timer ring, thread and day bars
  are `CustomPainter`s with the same colours, easing and meaning.
- **Icons** are Material icons rather than the hand-drawn SVG set.
- **Time fields** are typed as 24-hour `HH:MM` (the colon is filled in), with a
  clock button for a picker; dates open a calendar.
- **Downloads** go through the browser on web, and into your *Downloads* folder
  on Windows — the toast says where.
- **Storage** uses `shared_preferences` under the same `otc.*` keys. On web,
  data the React app saved in the same browser and origin is read on first run,
  so stored days carry over.
- The unused "append rows to the spreadsheet" and "copy rows" actions, which no
  button in the React app reached, were not ported.

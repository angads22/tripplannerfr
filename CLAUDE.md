# CLAUDE.md

Guidance for working in this repo. Read this first.

## What this is

**Pitstop** (a.k.a. Trip Planner) is a small self-hosted Node.js web app for
planning trips with friends. One person runs it (on their PC or as a packaged
`.exe`); friends sign in with a shared code and collaborate on trips. It is
designed to run with **no database** and **no paid hosting**.

- Backend: Node.js + Express (`server.js`), CommonJS.
- Storage: a single JSON file at `data/db.json` (atomic writes), no DB server.
- Auth: `express-session` + `session-file-store` (sessions on disk), bcryptjs.
- Frontend: static HTML/CSS/JS in `public/` (no framework, no build step).
- Packaging: `pkg` bundles everything into one Windows `.exe`.
- Sharing: a Cloudflare named tunnel serves the local app at a real domain.

## Run / build / release

```bash
npm install
npm start          # node server.js -> http://localhost:4040
npm run build      # pkg -> dist/TripPlanner.exe (Windows)
```

- **Dev**: `node server.js`. `data/`, `public/`, `content/` resolve to the repo.
- **Packaged exe**: paths resolve next to the `.exe` (see `lib/paths.js`,
  which checks `process.pkg`). `public/` and `content/` are bundled inside the
  binary; `data/` is created next to the exe at runtime.
- Always build with `--no-bytecode --public-packages "*" --public` (already in
  `npm run build` and the CI). Plain JS in the binary greatly reduces antivirus
  false positives vs pkg's default bytecode.

## Distribution & the self-updater

- CI (`.github/workflows/build-exe.yml`) builds the exe on every push to
  `main` and publishes a **GitHub Release** tagged `v<run_number>`, with
  `TripPlanner.exe` attached. The exe does NOT live in the repo (gitignored).
- Each build is stamped: CI writes `build-info.json` (`{build, version}`)
  before `pkg`, so the running app knows its own build number.
- In-app updater (`routes/admin.js`): `GET /api/admin/check-update` compares
  the app's build to the latest Release's tag; `POST /api/admin/apply-update`
  (packaged only) downloads the new exe, writes `apply-update.bat` that waits
  for the app to exit, swaps the file, and relaunches.
- **Important:** the updater reads the GitHub Releases API and downloads the
  asset **without auth**, so the repo (or at least its releases) must be
  **public**. For a private repo those calls 403. No secrets live in the repo
  (`data/`, `.env` are gitignored), so public is safe.

## Data model (`data/db.json`)

`{ users: [], trips: [], settings: {} }`

- **user**: `{ id, username, displayName, passwordHash, isAdmin, createdAt }`.
  The first account created becomes the admin.
- **trip**: `{ id, slug, title, subtitle, date, emoji, theme, tags[], crew[],
  members[] (userIds), stops[] {id,time,title,place,note}, mapUrl,
  activity[] {id,ts,userId,userName,text}, shareWithEveryone, pageFile,
  createdBy, createdByName, createdAt, updatedAt }`.
- **settings**: `{ inviteCode, earlyBirdEnabled, earlyBirdCode }`.

## Permissions (see `lib/auth-middleware.js`)

- `canView`: admin | shareWithEveryone | creator | member (legacy allowedUsers).
- Create a trip: any logged-in user (becomes creator + first member).
- `canAddMembers` / `canEditPlan`: admin | creator | any member (anyone on the
  trip can invite others and edit the itinerary/map).
- `canRemoveMembers` / `canManageTrip`: admin | creator only (remove people,
  edit details/theme, delete).
- New trips are **private to the crew** by default (`shareWithEveryone:false`).

## Sign-up

- Shared **invite code** (default from config/`.env`, editable in admin).
- Optional **early-bird code** (default `potato 21`, on by default, toggle in
  admin). `codeAccepted()` accepts either; first user skips the check.

## Theming

- One stylesheet: `public/css/pitstop.css` (Pitstop road-trip aesthetic:
  Anton / Archivo / Permanent Marker, warm gradient + animated blobs,
  glass cards). There is no other stylesheet — every page uses this one.
- Per-trip accent via `[data-theme="..."]` setting `--accent`. Themes:
  `red, blue, green, purple, orange`. Keep new themes on the same aesthetic.
- When adding UI, reuse existing classes (panels, rows, buttons, toggles,
  badges, `card-dark` / `card-light`) so everything stays visually connected.

## Pages & routing

- `public/index.html` (board), `login.html`, `admin.html`, `trip.html`
  (generic trip detail for user-created trips), `404.html`.
- `content/trips/*.html` are rich custom trip pages (e.g. `toronto.html`),
  served behind auth at `/trip/<slug>` when a trip has a `pageFile`. Trips
  without a `pageFile` get the generic `trip.html`.
- API under `/api/{auth,trips,users,admin}` (see `routes/`).

## Deployment (sharing publicly)

- `Go Online (makeitoutthegc.ca).bat` sets up a Cloudflare **named tunnel** to
  serve the local app at `https://makeitoutthegc.ca` (one-time `cloudflared
  tunnel login` against the user's Cloudflare account). Free, HTTPS, hides the
  home IP, no port forwarding.
- The quick `cloudflared tunnel --url` (random `trycloudflare.com`) is the
  no-domain fallback.

## Conventions

- Keep it dependency-light and build-step-free on the frontend.
- Never commit `data/`, `.env`, or the built exe (all gitignored).
- Match the existing code style (CommonJS, small modules, comments that explain
  the "why"). The app must keep working both as `node server.js` and as the
  packaged exe — always route file paths through `lib/paths.js`.

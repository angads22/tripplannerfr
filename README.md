# 🧳 Trip Planner

A cozy, **self-hosted** trip board you run on your own Windows PC. Friends sign in
with a shared invite code, claim their name, and only see the trips you've given
them access to. You get an **admin console** to manage people, the invite code,
and per-trip access — and an easy on/off button.

Trips are **live interactive itineraries** you build right in the app — add days
and stops (time, place, notes, tips, map links) with no HTML and no code.

---

## 🚀 Quick start (Windows)

1. **Install Node.js** once — the **LTS** version from <https://nodejs.org>.
2. **Double-click `Start Trip Planner.bat`.**
   - First run installs dependencies automatically (needs internet, ~30s).
   - A server window opens and your browser pops up at **http://localhost:4040**.
3. **Create your account.** The **first account becomes the admin (you)** — no
   invite code needed.
4. Open the **⚙ Admin** console (top-right) to set your invite code and manage access.
5. To turn it off: **`Stop Trip Planner.bat`** (or the **⏻ Shut down** button in Admin).

---

## 👥 How accounts work

- **You** = the first account = **admin/owner**.
- **Friends** go to your link, click **Create account**, pick a **username + display
  name** ("claim their name"), set a password, and enter the **shared invite code**.
  That code is the one "shared password" everyone uses to get in.
- Passwords are hashed (bcrypt). Nothing is stored in plain text.
- Everyone only sees the trips shared with them. Admins see everything.

## 🛠️ The Admin console (`/admin`, admins only)

- **Invite code** — view and change the shared code at any time.
- **People** — make/remove admins, reset a password, delete an account, or
  pre-create a login for a friend.
- **Trips & access** — for each trip, toggle **Everyone** or tick exactly which
  people can **see** it, and tick who can **edit** it directly. Add or remove
  trips from the board.
- **Change requests** — members who can see a trip (but aren't editors) can
  suggest changes; you review them here and **approve** (applies it) or **reject**.
- **Server power** — shut the whole thing down remotely.

## ➕ Adding & editing trips

Trips are built in-app — no HTML, no files to edit.

1. On the board, click **+ New trip** (admins), name it, and you jump straight
   into the builder. (You can also use the Admin console → **Add a trip**.)
2. In the **builder**, add an overview and as many **days** and **stops** as you
   like. Each stop takes a name, category, **location**, **hours**, notes, and a
   tip. The first stop of a day has a **start time**; every later stop has a
   **"getting here"** leg — set when you **leave** the previous stop and pick the
   mode (walk / transit / train / bus / drive / bike / ferry). Reorder or remove
   anything, hit **Preview map** to check a place, then **Save**.
3. Set who can **see** it and who can **edit** it (board card ✎, or the Admin console).

### 🗺️ Maps & travel times (keyless, no setup)
Type a place into a stop's **location** and the trip page automatically gets a
**Google Maps** link, an embedded map (in the stop's expandable drawer), and a
**Directions from the previous stop** link.

Hit **⟳ Auto** on a leg (or **Auto travel times** for the whole trip) and the
builder estimates how long the leg takes by the mode you picked and fills in the
**arrival time** (arrival = leave time + travel). You choose the leave times; the
arrivals follow from the mode.

> Travel times are **estimates** — computed keyless from OpenStreetMap geocoding
> and a per-mode average speed (no API key, no billing). They're not live transit
> schedules; Google's Directions/transit API needs a paid key, so it can't be
> used keyless. The estimate refreshes whenever you change the mode.

### Who can change a trip
- **Admins** and a trip's **creator** can always edit.
- An admin can **elevate** any member to **editor** for a trip — they then edit
  it directly.
- Everyone else who can see a trip can **Suggest a change** from the trip page;
  it goes to the admin's **Change requests** queue for approval.

> **Legacy custom pages:** older trips can still point at a hand-written HTML file
> in `content/trips/` via a `pageFile` (the seeded Toronto trip works this way).
> Those keep rendering as-is; new trips use the in-app builder.

---

## 🌐 Sharing it beyond your house

### On your home network (no setup)
When the server starts it prints a `http://192.168.x.x:4040` address. Anyone on
the **same Wi-Fi** can use that. Good for in-person planning.

### Over the internet — Cloudflare Tunnel ✅ (recommended)
**Double-click `Go Online (Cloudflare).bat`** (server must be running first).
It downloads a small helper once, then prints a public link like
`https://random-words.trycloudflare.com`. Share **that** link.

Why this and not port forwarding:
- **No domain to buy**, no router changes.
- **Doesn't expose your home IP address** — traffic goes through Cloudflare.
- **Gives you HTTPS automatically**, so logins/passwords aren't sent in the clear.
- Closing the tunnel window takes the public link offline instantly.

This is the safest free option, which is why it's the default.

### Over the internet — Port forwarding ⚠️ (only if you really want it)
You *can* forward a port on your router to this PC instead, but understand the
trade-offs first:

- It **exposes your home IP** and opens a port on your router to the whole internet.
- Plain port forwarding is **HTTP only** — passwords would travel **unencrypted**
  unless you add a TLS reverse proxy (extra work, and HTTPS really wants a domain).
- You become responsible for keeping the box patched against anyone who finds it.

If you accept that, the rough steps are:
1. Give this PC a **static local IP** (or a DHCP reservation in your router).
2. In your router, forward an **external port** (use a non-obvious one, not 4040)
   → this PC's IP, **internal port 4040 (TCP)**.
3. Find your public IP (`https://ifconfig.me`) and share `http://<public-ip>:<port>`.

Safety musts if you go this route: a **strong, long invite code**; strong admin
password; keep Node and Windows updated; turn the forward **off when not needed**;
and prefer the Cloudflare tunnel above for anything sensitive. Honestly — the
tunnel does everything this does, safer and free. Use it instead unless you have
a specific reason not to.

---

## 🔒 Notes on staying safe
- The invite code is your front door — make it long and don't post it publicly.
- `data/` (accounts, sessions, the session secret) is git-ignored. Don't commit it.
- For real internet exposure, use the **Cloudflare tunnel** (HTTPS, hidden IP).

## 📁 Project structure
```
server.js                 Express app: API, auth-gated pages, on/off lifecycle
lib/
  config.js               env/.env + session secret
  db.js                   JSON file store (data/db.json)
  auth-middleware.js      login/admin gates + access rules
  seed.js                 seeds the Toronto trip on first run
routes/
  auth.js                 register / login / logout / me
  users.js                admin: manage accounts + invite code
  trips.js                list visible trips; admin create/edit/share/delete
  admin.js                admin: remote shutdown
content/trips/
  toronto.html            the first trip (a rich interactive page)
public/
  index.html / js/app.js  the trip board
  login.html / js/login.js
  admin.html / js/admin.js the admin console
  css/style.css
Start Trip Planner.bat    turn it ON
Stop Trip Planner.bat     turn it OFF
Go Online (Cloudflare).bat publish a safe public link (no domain needed)
```

## ⚙️ Optional config (`.env`)
Copy `.env.example` to `.env` to change the `PORT`, `HOST`, or starting
`INVITE_CODE`. The app works fine with no `.env` at all.

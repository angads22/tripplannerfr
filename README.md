# 🧳 Trip Board

A tiny, shareable board of trips planned with friends. Each trip is its own
**live, interactive page** — reorder stops, stretch or trim each one, watch the
"day load" meter react, and open turn-by-turn walking directions on the day.

No server, no login, no database. It's just static HTML, so you can host it
anywhere for free and send the link.

```
.
├── index.html          ← the trip board (home page)
├── trips/
│   └── toronto.html    ← Toronto · Wed June 24 (the first trip)
├── .nojekyll           ← tells GitHub Pages to serve files as-is
└── README.md
```

## ✈️ The first trip — Toronto

- **When:** Wednesday, June 24, 2026 (a day trip)
- **Who:** You, Yareem, Noah, Cynthia & Luvena
- **The shape of the day:** GO train into Union → down to the lake → straight up
  Yonge Street (shopping, claw machines, games, dessert) → hot pot → bus home.

The page is fully interactive: tap any stop to see why it's there, drag the day
around, and the schematic map + arrival times + slack-time meter all recompute
together off your chosen train and bus.

---

## 🌐 How to host it (pick one)

### Option A — GitHub Pages (recommended, free, you're already here)

1. Push this repo to GitHub (the branch is already set up).
2. On GitHub, go to **Settings → Pages**.
3. Under **Build and deployment → Source**, choose **Deploy from a branch**.
4. Pick the branch (e.g. `main`) and folder **`/ (root)`**, then **Save**.
5. Wait ~1 minute. Your board goes live at:
   `https://<your-username>.github.io/<repo-name>/`

That's the link you share. Every push updates the site automatically.

> The included `.nojekyll` file makes sure GitHub serves the HTML exactly as
> written (no Jekyll processing).

### Option B — Netlify (drag-and-drop, no Git needed)

1. Go to <https://app.netlify.com/drop>.
2. Drag this whole folder onto the page.
3. You get a live URL instantly. To use your own name, rename the site in
   **Site settings**.

### Option C — Vercel

1. Install once: `npm i -g vercel`
2. Run `vercel` in this folder and follow the prompts. Done.

### Run it locally first (optional)

Any static file server works. With Python (already on most machines):

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000> in your browser.

---

## ➕ Adding another trip

1. Copy `trips/toronto.html` to `trips/your-trip.html` and edit the details
   (the `stops` array near the bottom of the file is the itinerary).
2. In `index.html`, copy the Toronto `<a class="trip">…</a>` card, point its
   `href` at your new page, and update the name, date, and crew.

That's it — commit, push, and the live site picks it up.

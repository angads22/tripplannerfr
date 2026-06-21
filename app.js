<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Trip Planner</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=Poppins:wght@400;500;600;700&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="/css/style.css" />
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🧳</text></svg>" />
</head>
<body>
  <header class="app-header">
    <div class="brand">
      <span class="logo">🧳</span>
      <span>Trip Planner<br /><small>wander together</small></span>
    </div>
    <div class="header-spacer"></div>
    <button class="btn primary" id="newTripBtn">＋ New trip</button>
    <div class="who">
      <span class="avatar" id="avatar">?</span>
      <span id="whoName">…</span>
    </div>
    <button class="btn ghost small" id="logoutBtn">Log out</button>
  </header>

  <main>
    <h1 class="page-title" id="greeting">Where to next?</h1>
    <p class="page-sub">Your shared board of upcoming adventures.</p>

    <div class="toolbar">
      <input class="search" id="search" placeholder="🔎 Search trips by name or place…" />
    </div>

    <div id="boardWrap"></div>
    <div id="emptyState" class="empty" style="display:none">
      <div class="big">🗺️</div>
      <h3>No trips yet</h3>
      <p>Hit <strong>＋ New trip</strong> to start planning your first adventure.</p>
    </div>
  </main>

  <!-- Scrim + sliding sheet (used for both detail + edit) -->
  <div class="scrim" id="scrim"></div>
  <aside class="sheet" id="sheet">
    <div class="sheet-head">
      <h2 id="sheetTitle">Trip</h2>
      <button class="btn ghost small" id="sheetClose">✕ Close</button>
    </div>
    <div class="sheet-body" id="sheetBody"></div>
    <div class="sheet-foot" id="sheetFoot"></div>
  </aside>

  <div class="toast" id="toast"></div>

  <script src="/js/app.js"></script>
</body>
</html>

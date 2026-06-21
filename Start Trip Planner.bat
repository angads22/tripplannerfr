/* =========================================================================
   Trip Planner — aesthetic, warm, travel-journal vibe
   ========================================================================= */

:root {
  --bg: #0f1226;
  --bg-soft: #171a35;
  --card: rgba(255, 255, 255, 0.06);
  --card-solid: #1c2042;
  --stroke: rgba(255, 255, 255, 0.12);
  --text: #f2f3ff;
  --muted: #a6a9cf;
  --accent: #ff8a5b;
  --accent-2: #ffd66b;
  --good: #5be3a6;
  --danger: #ff6b8a;
  --radius: 18px;
  --shadow: 0 18px 50px rgba(0, 0, 0, 0.35);
  --font: "Poppins", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --serif: "Fraunces", Georgia, "Times New Roman", serif;
}

* { box-sizing: border-box; }

html, body {
  margin: 0;
  padding: 0;
  min-height: 100%;
}

body {
  font-family: var(--font);
  color: var(--text);
  background:
    radial-gradient(1200px 600px at 12% -10%, #2a2f63 0%, transparent 55%),
    radial-gradient(1000px 700px at 100% 0%, #3a2350 0%, transparent 50%),
    radial-gradient(900px 900px at 50% 120%, #16284d 0%, transparent 55%),
    var(--bg);
  background-attachment: fixed;
  -webkit-font-smoothing: antialiased;
}

a { color: var(--accent-2); }

/* ---- Layout --------------------------------------------------------------- */

.app-header {
  position: sticky;
  top: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px 28px;
  background: rgba(15, 18, 38, 0.72);
  backdrop-filter: blur(14px);
  border-bottom: 1px solid var(--stroke);
}

.brand {
  display: flex;
  align-items: center;
  gap: 12px;
  font-weight: 700;
  font-size: 20px;
  letter-spacing: 0.2px;
}
.brand .logo {
  width: 38px; height: 38px;
  display: grid; place-items: center;
  border-radius: 12px;
  font-size: 20px;
  background: linear-gradient(135deg, var(--accent), var(--accent-2));
  box-shadow: 0 8px 20px rgba(255, 138, 91, 0.35);
}
.brand small { display: block; font-size: 11px; font-weight: 500; color: var(--muted); letter-spacing: 2px; text-transform: uppercase; }

.header-spacer { flex: 1; }

.who {
  display: flex; align-items: center; gap: 10px;
  color: var(--muted); font-size: 14px;
}
.who .avatar {
  width: 34px; height: 34px; border-radius: 50%;
  display: grid; place-items: center; font-weight: 700; color: #1a1330;
  background: linear-gradient(135deg, var(--accent-2), var(--good));
}

main { max-width: 1080px; margin: 0 auto; padding: 32px 24px 80px; }

.page-title {
  font-family: var(--serif);
  font-weight: 600;
  font-size: clamp(28px, 5vw, 44px);
  margin: 8px 0 4px;
}
.page-sub { color: var(--muted); margin: 0 0 28px; font-size: 16px; }

/* ---- Buttons -------------------------------------------------------------- */

.btn {
  cursor: pointer;
  border: 1px solid var(--stroke);
  background: var(--card);
  color: var(--text);
  font-family: var(--font);
  font-weight: 600;
  font-size: 14px;
  padding: 10px 16px;
  border-radius: 12px;
  transition: transform 0.08s ease, background 0.2s ease, border 0.2s ease;
  display: inline-flex; align-items: center; gap: 8px;
}
.btn:hover { background: rgba(255,255,255,0.12); }
.btn:active { transform: translateY(1px); }
.btn.primary {
  border: none;
  color: #2a160c;
  background: linear-gradient(135deg, var(--accent), var(--accent-2));
  box-shadow: 0 10px 24px rgba(255, 138, 91, 0.3);
}
.btn.ghost { background: transparent; }
.btn.danger { color: var(--danger); border-color: rgba(255,107,138,0.4); }
.btn.small { padding: 6px 11px; font-size: 13px; }

/* ---- Trip grid ------------------------------------------------------------ */

.toolbar { display: flex; align-items: center; gap: 12px; margin-bottom: 22px; flex-wrap: wrap; }
.toolbar .search {
  flex: 1; min-width: 200px;
  background: var(--card); border: 1px solid var(--stroke);
  border-radius: 12px; padding: 10px 14px; color: var(--text);
  font-family: var(--font); font-size: 14px;
}
.toolbar .search::placeholder { color: var(--muted); }

.trip-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(290px, 1fr));
  gap: 22px;
}

.board-section { margin-bottom: 38px; }
.section-heading {
  font-family: var(--serif); font-weight: 600; font-size: 22px;
  margin: 0 0 16px; display: flex; align-items: center; gap: 10px;
}
.section-heading .count {
  font-family: var(--font); font-size: 12px; font-weight: 700;
  color: var(--muted); background: var(--card); border: 1px solid var(--stroke);
  padding: 2px 9px; border-radius: 999px;
}

/* "Who can see this trip" picker */
.share-pick { display: flex; flex-direction: column; gap: 6px; margin-bottom: 6px; }
.share-row {
  display: flex; align-items: center; gap: 10px; cursor: pointer;
  background: var(--card); border: 1px solid var(--stroke);
  border-radius: 10px; padding: 9px 12px; font-size: 14px;
  transition: border 0.15s ease, background 0.15s ease;
}
.share-row.on { border-color: var(--accent); background: rgba(255,138,91,0.10); }
.share-row input { width: 18px; height: 18px; accent-color: var(--accent); }
.share-row input:disabled { opacity: 0.6; }

.trip-card {
  position: relative;
  border-radius: var(--radius);
  overflow: hidden;
  border: 1px solid var(--stroke);
  background: var(--card-solid);
  box-shadow: var(--shadow);
  cursor: pointer;
  transition: transform 0.16s ease, box-shadow 0.16s ease;
  display: flex; flex-direction: column;
  min-height: 230px;
}
.trip-card:hover { transform: translateY(-4px); box-shadow: 0 26px 60px rgba(0,0,0,0.45); }

.trip-cover {
  height: 130px;
  display: flex; align-items: flex-end; justify-content: space-between;
  padding: 14px 16px;
  position: relative;
}
.trip-cover .emoji {
  font-size: 40px;
  filter: drop-shadow(0 6px 10px rgba(0,0,0,0.35));
}
.trip-cover .countdown {
  font-size: 12px; font-weight: 700; letter-spacing: 0.4px;
  background: rgba(0,0,0,0.32); color: #fff;
  padding: 5px 10px; border-radius: 999px;
  backdrop-filter: blur(4px);
}
.trip-body { padding: 16px 18px 18px; display: flex; flex-direction: column; gap: 6px; flex: 1; }
.trip-body h3 { margin: 0; font-size: 19px; font-family: var(--serif); font-weight: 600; }
.trip-meta { color: var(--muted); font-size: 13px; display: flex; gap: 10px; flex-wrap: wrap; }
.trip-body p.snippet { color: var(--muted); font-size: 14px; margin: 6px 0 0; line-height: 1.45;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.trip-foot { margin-top: auto; padding-top: 12px; font-size: 12px; color: var(--muted); display: flex; gap: 8px; align-items: center; }

/* cover color themes */
.cover-sunset { background: linear-gradient(135deg, #ff7e5f, #feb47b); }
.cover-ocean  { background: linear-gradient(135deg, #2193b0, #6dd5ed); }
.cover-forest { background: linear-gradient(135deg, #11998e, #38ef7d); }
.cover-berry  { background: linear-gradient(135deg, #c94b4b, #b06ab3); }
.cover-night  { background: linear-gradient(135deg, #2c3e50, #4ca1af); }
.cover-sand   { background: linear-gradient(135deg, #c79081, #dfa579); }
.cover-grape  { background: linear-gradient(135deg, #654ea3, #eaafc8); }
.cover-citrus { background: linear-gradient(135deg, #f7971e, #ffd200); }

/* ---- Empty state ---------------------------------------------------------- */
.empty {
  text-align: center; padding: 70px 20px; color: var(--muted);
  border: 1px dashed var(--stroke); border-radius: var(--radius);
  background: var(--card);
}
.empty .big { font-size: 52px; margin-bottom: 10px; }

/* ---- Modal / drawer ------------------------------------------------------- */

.scrim {
  position: fixed; inset: 0; z-index: 50;
  background: rgba(6, 7, 18, 0.6);
  backdrop-filter: blur(3px);
  display: none;
}
.scrim.open { display: block; }

.sheet {
  position: fixed; top: 0; right: 0; bottom: 0; z-index: 60;
  width: min(680px, 100%);
  background: var(--bg-soft);
  border-left: 1px solid var(--stroke);
  box-shadow: -20px 0 60px rgba(0,0,0,0.5);
  transform: translateX(100%);
  transition: transform 0.28s cubic-bezier(.2,.7,.2,1);
  display: flex; flex-direction: column;
}
.sheet.open { transform: translateX(0); }
.sheet-head {
  display: flex; align-items: center; gap: 12px;
  padding: 18px 22px; border-bottom: 1px solid var(--stroke);
}
.sheet-head h2 { margin: 0; font-size: 19px; flex: 1; }
.sheet-body { padding: 22px; overflow-y: auto; flex: 1; }
.sheet-foot {
  padding: 14px 22px; border-top: 1px solid var(--stroke);
  display: flex; gap: 10px; justify-content: flex-end;
  background: rgba(0,0,0,0.15);
}

/* ---- Detail view ---------------------------------------------------------- */
.detail-hero {
  border-radius: 16px; padding: 26px; margin-bottom: 22px;
  position: relative; overflow: hidden;
}
.detail-hero h2 { font-family: var(--serif); font-size: 30px; margin: 6px 0; }
.detail-hero .pills { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 10px; }
.pill {
  background: rgba(0,0,0,0.28); color: #fff; font-size: 13px; font-weight: 600;
  padding: 6px 12px; border-radius: 999px; backdrop-filter: blur(4px);
}
.section { margin-bottom: 26px; }
.section h3 { font-size: 15px; text-transform: uppercase; letter-spacing: 1.4px; color: var(--muted); margin: 0 0 12px; }

.day {
  border: 1px solid var(--stroke); border-radius: 14px; padding: 14px 16px;
  margin-bottom: 12px; background: var(--card);
}
.day .day-head { display: flex; align-items: baseline; gap: 10px; margin-bottom: 8px; }
.day .day-head strong { font-size: 16px; }
.day .day-head span { color: var(--muted); font-size: 13px; }
.activity { display: flex; gap: 12px; padding: 7px 0; border-top: 1px dashed rgba(255,255,255,0.08); }
.activity:first-of-type { border-top: none; }
.activity .time { color: var(--accent-2); font-weight: 700; font-size: 13px; min-width: 60px; }
.activity .what strong { display: block; font-size: 14px; }
.activity .what small { color: var(--muted); }

.checklist label { display: flex; align-items: center; gap: 10px; padding: 7px 0; font-size: 15px; cursor: pointer; }
.checklist input { width: 18px; height: 18px; accent-color: var(--good); }
.checklist label.done span { text-decoration: line-through; color: var(--muted); }

.linklist a { display: inline-flex; align-items: center; gap: 8px; margin: 4px 10px 4px 0;
  background: var(--card); padding: 8px 12px; border-radius: 10px; border: 1px solid var(--stroke);
  text-decoration: none; color: var(--text); font-size: 14px; }

.notes { white-space: pre-wrap; line-height: 1.6; color: #e7e8ff; background: var(--card);
  border: 1px solid var(--stroke); border-radius: 12px; padding: 16px; font-size: 15px; }

/* ---- Forms ---------------------------------------------------------------- */
.field { margin-bottom: 16px; }
.field label { display: block; font-size: 13px; color: var(--muted); margin-bottom: 6px; font-weight: 600; }
.field input, .field textarea, .field select {
  width: 100%; background: var(--card); border: 1px solid var(--stroke);
  border-radius: 11px; padding: 11px 13px; color: var(--text);
  font-family: var(--font); font-size: 15px; resize: vertical;
}
.field input:focus, .field textarea:focus, .field select:focus {
  outline: none; border-color: var(--accent); background: rgba(255,255,255,0.09);
}
.row { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.swatches { display: flex; gap: 8px; flex-wrap: wrap; }
.swatch { width: 34px; height: 34px; border-radius: 9px; cursor: pointer; border: 2px solid transparent; }
.swatch.active { border-color: #fff; box-shadow: 0 0 0 2px rgba(255,255,255,0.25); }

.subhead { display: flex; align-items: center; justify-content: space-between; margin: 22px 0 10px; }
.subhead h4 { margin: 0; font-size: 14px; text-transform: uppercase; letter-spacing: 1px; color: var(--muted); }

.editable-row { display: flex; gap: 8px; margin-bottom: 8px; align-items: center; }
.editable-row input { flex: 1; }
.editable-row .grip { color: var(--muted); cursor: default; }
.icon-btn { background: var(--card); border: 1px solid var(--stroke); color: var(--muted);
  border-radius: 9px; width: 36px; height: 36px; cursor: pointer; font-size: 16px; }
.icon-btn:hover { color: var(--danger); border-color: rgba(255,107,138,0.4); }

.day-editor { border: 1px solid var(--stroke); border-radius: 12px; padding: 14px; margin-bottom: 12px; background: var(--card); }

/* ---- Auth ----------------------------------------------------------------- */
.auth-wrap { min-height: 100vh; display: grid; place-items: center; padding: 24px; }
.auth-card {
  width: min(420px, 100%); background: var(--card-solid);
  border: 1px solid var(--stroke); border-radius: 22px; padding: 34px;
  box-shadow: var(--shadow);
}
.auth-card .brand { justify-content: center; margin-bottom: 6px; }
.auth-tag { text-align: center; color: var(--muted); margin: 0 0 24px; }
.tabs { display: flex; gap: 6px; background: var(--card); padding: 5px; border-radius: 12px; margin-bottom: 20px; }
.tabs button { flex: 1; border: none; background: transparent; color: var(--muted); padding: 9px;
  border-radius: 9px; cursor: pointer; font-weight: 600; font-family: var(--font); }
.tabs button.active { background: linear-gradient(135deg, var(--accent), var(--accent-2)); color: #2a160c; }
.auth-card .btn.primary { width: 100%; justify-content: center; margin-top: 6px; padding: 12px; }
.note { font-size: 13px; color: var(--muted); text-align: center; margin-top: 16px; line-height: 1.5; }
.error-msg { background: rgba(255,107,138,0.14); border: 1px solid rgba(255,107,138,0.4);
  color: #ffd0d9; padding: 10px 13px; border-radius: 10px; font-size: 14px; margin-bottom: 14px; display: none; }
.error-msg.show { display: block; }
.setup-banner { background: rgba(91,227,166,0.12); border: 1px solid rgba(91,227,166,0.4);
  color: #c9ffe7; padding: 11px 14px; border-radius: 10px; font-size: 13px; margin-bottom: 16px; line-height: 1.5; }

/* ---- Toast ---------------------------------------------------------------- */
.toast {
  position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%) translateY(20px);
  background: var(--card-solid); border: 1px solid var(--stroke); color: var(--text);
  padding: 12px 20px; border-radius: 12px; box-shadow: var(--shadow);
  opacity: 0; pointer-events: none; transition: all 0.25s ease; z-index: 100; font-size: 14px;
}
.toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }

@media (max-width: 560px) {
  .row { grid-template-columns: 1fr; }
  main { padding: 22px 16px 70px; }
  .app-header { padding: 14px 16px; }
}

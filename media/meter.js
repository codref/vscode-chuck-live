(function () {
  const DB_MIN = -60;
  const DB_MAX = 0;
  const HOLD_MS = 1200;
  const HOLD_DECAY_DB_PER_S = 12;
  const LED_ON_DB = -6;
  const LED_CLIP_DB = -0.1;

  const barL = document.getElementById('barL');
  const barR = document.getElementById('barR');
  const peakL = document.getElementById('peakL');
  const peakR = document.getElementById('peakR');
  const ledL = document.getElementById('ledL');
  const ledR = document.getElementById('ledR');
  const dbL = document.getElementById('dbL');
  const dbR = document.getElementById('dbR');

  let levelL = DB_MIN;
  let levelR = DB_MIN;
  let holdL = DB_MIN;
  let holdR = DB_MIN;
  let holdAtL = 0;
  let holdAtR = 0;
  let lastFrame = performance.now();

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg.type !== 'vu') return;
    const now = performance.now();
    const lDb = linToDb(Number(msg.l) || 0);
    const rDb = linToDb(Number(msg.r) || 0);
    levelL = lDb;
    levelR = rDb;
    if (lDb >= holdL) {
      holdL = lDb;
      holdAtL = now;
    }
    if (rDb >= holdR) {
      holdR = rDb;
      holdAtR = now;
    }
    paint();
  });

  function tick(now) {
    const dt = Math.min(0.05, (now - lastFrame) / 1000);
    lastFrame = now;
    holdL = decayHold(holdL, holdAtL, now, dt);
    holdR = decayHold(holdR, holdAtR, now, dt);
    paint();
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  function decayHold(hold, holdAt, now, dt) {
    if (now - holdAt < HOLD_MS) return hold;
    return Math.max(DB_MIN, hold - HOLD_DECAY_DB_PER_S * dt);
  }

  function paint() {
    setChannel(barL, peakL, ledL, dbL, levelL, holdL);
    setChannel(barR, peakR, ledR, dbR, levelR, holdR);
  }

  function setChannel(bar, peak, led, dbEl, level, hold) {
    if (!bar || !peak || !led || !dbEl) return;
    const pct = dbToPct(level);
    const holdPct = dbToPct(hold);
    bar.style.width = pct + '%';
    peak.style.left = holdPct + '%';
    peak.classList.toggle('on', hold > DB_MIN + 0.5);
    peak.classList.toggle('clip', hold >= LED_CLIP_DB);

    const clip = level >= LED_CLIP_DB || hold >= LED_CLIP_DB;
    const ledOn = hold >= LED_ON_DB;
    led.classList.toggle('on', ledOn && !clip);
    led.classList.toggle('clip', clip);
    bar.classList.toggle('clip', level >= LED_CLIP_DB);

    dbEl.textContent = fmtDb(level);
    dbEl.classList.toggle('clip', clip);
  }

  function linToDb(lin) {
    if (!(lin > 0)) return DB_MIN;
    const db = 20 * Math.log10(lin);
    return Math.max(DB_MIN, Math.min(DB_MAX + 6, db));
  }

  function dbToPct(db) {
    const t = (db - DB_MIN) / (DB_MAX - DB_MIN);
    return Math.max(0, Math.min(100, t * 100));
  }

  function fmtDb(db) {
    if (db <= DB_MIN + 0.05) return '−∞';
    const n = Math.round(db * 10) / 10;
    return (n > 0 ? '+' : '') + n.toFixed(1);
  }
})();

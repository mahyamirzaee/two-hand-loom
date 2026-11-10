// The Two-Hand Loom — main script (Phase 4: start screen, ending, save as PNG)
//
// What this file does, in plain words:
// 1. Start screen explains the loom. "Begin" opens the loom.
// 2. It watches every finger. A finger near the left edge belongs to the LEFT
//    person, near the right edge to the RIGHT person.
// 3. While BOTH edges are held, a shuttle carries the thread across, row by row.
//    Each finished row is one shared beat (pulse, vibration on Android, optional sound).
// 4. If one person lets go, the newest rows slowly unravel, up to a limit.
// 5. "Finish" (or a full loom) opens the end screen, where the pair can save
//    their weave as a PNG image.
//
// Privacy: this file never sends data anywhere. Nothing is stored by the app.
// The PNG goes only where the people saving it choose to put it.

(function () {
  "use strict";

  // ---------- Settings you can tweak ----------
  const ZONE_SHARE     = 0.22; // each edge zone = 22% of screen width (matches CSS)
  const ROW_MS         = 700;  // time to weave one row = one shared beat
  const GRACE_MS       = 600;  // pause before unravelling starts after letting go
  const UNRAVEL_ROW_MS = 1800; // time for one row to unravel (slower than weaving)
  const UNRAVEL_LIMIT  = 6;    // max rows lost each time someone lets go
  const ROW_HEIGHT     = 10;   // height of one weft row, in screen points
  const WARP_GAP       = 10;   // space between warp threads, in screen points
  const VIBRATE_MS     = 15;   // length of the vibration tap (Android only)
  const FULL_WAIT_MS   = 1500; // when the loom is full, wait this long, then show the end
  const EXPORT_SCALE   = 3;    // the saved image is 3x sharper than the screen

  const COLOURS = {
    paper:  "#fbfaf8",
    ink:    "#141418",
    indigo: "#26307f",
  };

  // ---------- Page elements ----------
  const $ = function (id) { return document.getElementById(id); };
  const stage       = $("stage");
  const zoneLeft    = $("zone-left");
  const zoneRight   = $("zone-right");
  const canvas      = $("loom");
  const statusEl    = $("status");
  const soundBtn    = $("sound-toggle");
  const finishBtn   = $("finish");
  const startScreen = $("start-screen");
  const endScreen   = $("end-screen");
  const beginBtn    = $("begin");
  const weaveImg    = $("weave-image");
  const saveBtn     = $("save");
  const backBtn     = $("back");
  const againBtn    = $("again");
  const ctx         = canvas.getContext("2d");

  // ---------- State ----------
  let screen = "start";                        // "start", "loom" or "end"
  const fingers = new Map();                   // finger id -> "left" or "right"
  const keys = { left: false, right: false };  // laptop test keys
  const rows = [];        // finished rows: { dir: 1 or -1, tone: lightness % }
  let current = null;     // the row on the loom right now (half-woven or unravelling)
  let maxRows = 0;
  let apartMs = 0;
  let lostThisTime = 0;
  let pulse = 0;          // 1 right after a beat, fades to 0
  let fullBeatMs = 0;
  let fullMs = 0;         // how long the loom has been full
  let endShownForFull = false;
  let lastFrame = performance.now();
  let lastStatus = "";
  let savedBlob = null;   // the PNG of the weave, made when the end screen opens
  let savedUrl = null;

  let W = 0, H = 0, dpr = 1; // canvas size in screen points

  // ---------- 1. Touch detection ----------
  function zoneAt(x) {
    const width = window.innerWidth;
    if (x < width * ZONE_SHARE) return "left";
    if (x > width * (1 - ZONE_SHARE)) return "right";
    return null;
  }

  stage.addEventListener("pointerdown", function (e) {
    if (screen !== "loom") return;
    const zone = zoneAt(e.clientX);
    if (zone) fingers.set(e.pointerId, zone); // a finger keeps the zone where it landed
  });

  // Listen on the whole window, so a finger lifted over a screen or button is never "stuck".
  function release(e) { fingers.delete(e.pointerId); }
  window.addEventListener("pointerup", release);
  window.addEventListener("pointercancel", release);
  stage.addEventListener("pointerleave", function (e) {
    if (e.pointerType === "mouse") release(e);
  });

  function forgetAll() {
    fingers.clear();
    keys.left = keys.right = false;
  }
  window.addEventListener("blur", forgetAll);
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) forgetAll();
  });

  // Laptop testing: hold A (left person) and L (right person) together.
  window.addEventListener("keydown", function (e) {
    const k = e.key.toLowerCase();
    if (k === "a") keys.left = true;
    if (k === "l") keys.right = true;
  });
  window.addEventListener("keyup", function (e) {
    const k = e.key.toLowerCase();
    if (k === "a") keys.left = false;
    if (k === "l") keys.right = false;
  });

  // iPhone guards: no pinch-zoom, no page bounce, no long-press menu
  // (except on the finished weave image, so it can be saved with a long press).
  document.addEventListener("gesturestart", function (e) { e.preventDefault(); });
  document.addEventListener("touchmove", function (e) { e.preventDefault(); }, { passive: false });
  document.addEventListener("contextmenu", function (e) {
    if (e.target !== weaveImg) e.preventDefault();
  });

  function whoIsTouching() {
    if (screen !== "loom") return { left: false, right: false };
    let left = keys.left, right = keys.right;
    for (const zone of fingers.values()) {
      if (zone === "left") left = true;
      if (zone === "right") right = true;
    }
    return { left: left, right: right };
  }

  // ---------- 2. Sound (optional, off by default) ----------
  let audio = null;
  let soundOn = false;

  soundBtn.addEventListener("click", function () {
    soundOn = !soundOn;
    if (soundOn) {
      if (!audio) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC) audio = new AC();
      }
      if (audio && audio.state === "suspended") audio.resume();
    }
    soundBtn.textContent = soundOn ? "Sound on" : "Sound off";
    soundBtn.setAttribute("aria-pressed", String(soundOn));
  });

  function thock() {
    if (!soundOn || !audio) return;
    const t = audio.currentTime;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(220, t);
    osc.frequency.exponentialRampToValueAtTime(110, t + 0.12);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.12, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    osc.connect(gain);
    gain.connect(audio.destination);
    osc.start(t);
    osc.stop(t + 0.3);
  }

  function beat() {
    pulse = 1;
    if (navigator.vibrate) navigator.vibrate(VIBRATE_MS); // Android; iPhone has no vibrate
    thock();
  }

  // ---------- 3. Canvas size ----------
  function resize() {
    dpr = window.devicePixelRatio || 1;
    W = canvas.clientWidth;
    H = canvas.clientHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    maxRows = Math.max(1, Math.floor(H / ROW_HEIGHT));
    while (rows.length > maxRows) rows.pop();
    if (rows.length >= maxRows) current = null;
  }
  new ResizeObserver(resize).observe(canvas);

  // ---------- 4. Weaving logic (runs every frame) ----------
  function newRow() {
    return {
      dir: rows.length % 2 === 0 ? 1 : -1,   // alternate like a real shuttle
      tone: 73 + Math.random() * 6,         // tiny hand-made colour variation
      p: 0,                                 // how far across (0 to 1)
      wasFinished: false,
    };
  }

  function step(dt, t) {
    if (screen !== "loom") return "idle";
    const together = t.left && t.right;

    if (together) {
      apartMs = 0;
      lostThisTime = 0;

      if (rows.length >= maxRows) {
        fullBeatMs += dt;
        if (fullBeatMs >= ROW_MS) { fullBeatMs -= ROW_MS; beat(); }
        return "full";
      }
      if (!current) current = newRow();
      current.p += dt / ROW_MS;
      if (current.p >= 1) {
        current.p = 1;
        current.wasFinished = true;
        rows.push(current);
        current = null;
        beat();
      }
      return "weaving";
    }

    fullBeatMs = 0;
    apartMs += dt;
    if (apartMs < GRACE_MS) return rows.length >= maxRows ? "full" : "paused";

    if (!current && rows.length > 0 && lostThisTime < UNRAVEL_LIMIT) {
      current = rows.pop();
    }
    if (current) {
      const speed = current.wasFinished ? UNRAVEL_ROW_MS : ROW_MS * 0.6;
      current.p -= dt / speed;
      if (current.p <= 0) {
        if (current.wasFinished) lostThisTime++;
        current = null;
      }
      return "unravelling";
    }
    return rows.length > 0 ? "holding" : "empty";
  }

  // ---------- 5. Drawing (used for the screen AND for the saved image) ----------
  function lilac(tone, alpha) {
    return "hsla(248, 38%, " + tone.toFixed(1) + "%, " + alpha + ")";
  }

  function geometry(width) {
    const cols = Math.max(2, Math.floor(width / WARP_GAP));
    const firstX = (width - (cols - 1) * WARP_GAP) / 2;
    return { cols: cols, firstX: firstX, lastX: firstX + (cols - 1) * WARP_GAP };
  }

  // Draw one weft row on context c. p = how far the thread has travelled (0 to 1).
  function drawRow(c, r, index, p, geo, mode) {
    const y = index * ROW_HEIGHT;
    const len = (geo.lastX - geo.firstX + 6) * p;
    const startX = r.dir === 1 ? geo.firstX - 3 : geo.lastX + 3 - len;
    const tipX = r.dir === 1 ? startX + len : startX;
    const alpha = mode === "unravelling" ? 0.75 : 1;

    c.fillStyle = lilac(r.tone, alpha);
    c.fillRect(startX, y + 1, len, ROW_HEIGHT - 2);

    // warp threads that lie on top of this row (plain weave: every other one)
    c.fillStyle = COLOURS.indigo;
    for (let i = 0; i < geo.cols; i++) {
      if ((i + index) % 2 !== 0) continue;
      const x = geo.firstX + i * WARP_GAP;
      if (x >= startX && x <= startX + len) c.fillRect(x - 1.5, y, 3, ROW_HEIGHT);
    }

    if (p <= 0 || p >= 1) return;

    if (mode === "weaving") {
      // the shuttle
      c.fillStyle = COLOURS.ink;
      c.beginPath();
      c.ellipse(tipX + r.dir * 5, y + ROW_HEIGHT / 2, 7, 3, 0, 0, Math.PI * 2);
      c.fill();
    } else if (mode === "unravelling") {
      // a loose thread end hanging down
      c.strokeStyle = lilac(r.tone, 0.9);
      c.lineWidth = 2;
      c.lineCap = "round";
      c.beginPath();
      c.moveTo(tipX, y + ROW_HEIGHT / 2);
      c.quadraticCurveTo(tipX + r.dir * 8, y + ROW_HEIGHT, tipX + r.dir * 4, y + ROW_HEIGHT * 2.2);
      c.stroke();
    }
  }

  // Warp threads from y=top to y=bottom
  function drawWarp(c, geo, top, bottom, alpha) {
    c.strokeStyle = COLOURS.indigo;
    c.lineWidth = 1.5;
    c.globalAlpha = alpha;
    c.beginPath();
    for (let i = 0; i < geo.cols; i++) {
      const x = geo.firstX + i * WARP_GAP;
      c.moveTo(x, top);
      c.lineTo(x, bottom);
    }
    c.stroke();
    c.globalAlpha = 1;
  }

  function draw(mode) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = COLOURS.paper;
    ctx.fillRect(0, 0, W, H);

    const geo = geometry(W);
    drawWarp(ctx, geo, 0, H, 0.5 + 0.25 * pulse);

    for (let i = 0; i < rows.length; i++) drawRow(ctx, rows[i], i, 1, geo, "done");
    if (current) drawRow(ctx, current, rows.length, current.p, geo, mode);

    // the "beater" line flashing under the newest row at each beat
    if (pulse > 0.01 && rows.length > 0) {
      ctx.globalAlpha = pulse * 0.8;
      ctx.fillStyle = COLOURS.indigo;
      ctx.fillRect(geo.firstX - 6, rows.length * ROW_HEIGHT, geo.lastX - geo.firstX + 12, 1.5);
      ctx.globalAlpha = 1;
    }
  }

  // ---------- 6. The saved image ----------
  function todayText() {
    return new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  }

  function rowsText(n) { return n + (n === 1 ? " row" : " rows"); }

  // Makes a PNG of the finished rows on clean paper, with a small caption.
  function makeImage() {
    const margin = 36, fringe = 22, captionH = 58;
    const geo = geometry(W);
    const weaveH = rows.length * ROW_HEIGHT;
    const outW = Math.round(W + margin * 2);
    const outH = Math.round(margin + fringe + weaveH + fringe + captionH + margin * 0.6);

    const out = document.createElement("canvas");
    out.width = outW * EXPORT_SCALE;
    out.height = outH * EXPORT_SCALE;
    const c = out.getContext("2d");
    c.scale(EXPORT_SCALE, EXPORT_SCALE);

    c.fillStyle = COLOURS.paper;
    c.fillRect(0, 0, outW, outH);

    // the weave, with loose warp ends (fringe) above and below
    c.save();
    c.translate(margin, margin + fringe);
    drawWarp(c, geo, -fringe, weaveH + fringe, 0.55);
    for (let i = 0; i < rows.length; i++) drawRow(c, rows[i], i, 1, geo, "done");
    c.restore();

    // caption
    const capY = margin + fringe * 2 + weaveH + 26;
    c.textAlign = "center";
    c.fillStyle = COLOURS.indigo;
    c.font = "500 15px Literata, Georgia, serif";
    c.fillText("The Two-Hand Loom", outW / 2, capY);
    c.fillStyle = COLOURS.ink;
    c.globalAlpha = 0.6;
    c.font = "11px 'Atkinson Hyperlegible Next', system-ui, sans-serif";
    c.fillText("woven by two hands · " + rowsText(rows.length) + " · " + todayText(), outW / 2, capY + 18);
    c.globalAlpha = 1;

    return new Promise(function (resolve) { out.toBlob(resolve, "image/png"); });
  }

  function fileName() {
    const d = new Date();
    const pad = function (n) { return String(n).padStart(2, "0"); };
    return "two-hand-loom-" + d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) +
      "-" + pad(d.getHours()) + pad(d.getMinutes()) + ".png";
  }

  async function saveImage() {
    if (!savedBlob) return;
    const name = fileName();

    // On phones, the share sheet is the friendliest way to "Save Image" to Photos.
    // It stays on the device unless the people choose to send it somewhere.
    const file = new File([savedBlob], name, { type: "image/png" });
    const isTouch = window.matchMedia("(pointer: coarse)").matches;
    if (isTouch && navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: "Our weave" });
        return;
      } catch (err) {
        if (err && err.name === "AbortError") return; // they closed the sheet
        // otherwise fall through to a normal download
      }
    }

    const a = document.createElement("a");
    a.href = savedUrl;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  // ---------- 7. Screens ----------
  function show(name) {
    screen = name;
    startScreen.hidden = name !== "start";
    endScreen.hidden = name !== "end";
    forgetAll();          // nobody is "holding" across a screen change
    current = (name === "loom") ? current : null; // drop any half-woven row
  }

  async function openEnd() {
    show("end");
    saveBtn.disabled = true;
    saveBtn.textContent = "Preparing…";

    // make sure the fonts are ready before drawing the caption
    try {
      await Promise.all([
        document.fonts.load("500 15px Literata"),
        document.fonts.load("11px 'Atkinson Hyperlegible Next'"),
      ]);
    } catch (e) { /* fallback fonts are fine */ }

    savedBlob = await makeImage();
    if (savedUrl) URL.revokeObjectURL(savedUrl);
    savedUrl = savedBlob ? URL.createObjectURL(savedBlob) : null;
    weaveImg.src = savedUrl || "";
    saveBtn.disabled = !savedBlob;
    saveBtn.textContent = "Save our weave";
  }

  beginBtn.addEventListener("click", function () { show("loom"); });
  finishBtn.addEventListener("click", function () { if (rows.length > 0) openEnd(); });
  saveBtn.addEventListener("click", saveImage);
  backBtn.addEventListener("click", function () { show("loom"); });
  againBtn.addEventListener("click", function () {
    rows.length = 0;
    current = null;
    lostThisTime = 0;
    apartMs = 0;
    endShownForFull = false;
    show("loom");
  });

  // ---------- 8. Status text and zone glow ----------
  function updateStatus(t, mode) {
    zoneLeft.classList.toggle("active", t.left);
    zoneRight.classList.toggle("active", t.right);
    stage.style.setProperty("--pulse", pulse.toFixed(3));
    finishBtn.disabled = rows.length === 0;

    const count = rowsText(rows.length);
    let text;
    if (mode === "full") text = "The loom is full · " + count;
    else if (mode === "weaving") text = "Weaving together · " + count;
    else if (mode === "unravelling") text = "Unravelling…";
    else if (t.left || t.right) text = "Waiting for a second hand";
    else if (mode === "holding") text = "The weave holds · " + count;
    else if (mode === "paused") text = "Paused";
    else text = "Each person: touch one edge";

    if (text !== lastStatus) {
      statusEl.textContent = text;
      lastStatus = text;
    }
  }

  // ---------- 9. The heartbeat: runs every frame ----------
  function frame(now) {
    const dt = Math.min(now - lastFrame, 100);
    lastFrame = now;

    const t = whoIsTouching();
    const mode = step(dt, t);
    pulse = Math.max(0, pulse - dt / 450);

    // A full loom ends the weaving by itself (once), after a short moment.
    if (rows.length >= maxRows && screen === "loom" && !endShownForFull) {
      fullMs += dt;
      if (fullMs >= FULL_WAIT_MS) { endShownForFull = true; fullMs = 0; openEnd(); }
    } else {
      fullMs = 0;
    }

    if (screen === "loom") {
      updateStatus(t, mode);
      draw(mode);
    }
    requestAnimationFrame(frame);
  }

  resize();
  draw("idle");
  requestAnimationFrame(frame);

  // ---------- 10. Offline support ----------
  // Keeps a copy of the app on the device so it opens without internet.
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("sw.js").catch(function () { /* fine without it */ });
  }
})();

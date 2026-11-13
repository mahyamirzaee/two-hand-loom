// The Two-Hand Loom — main script
//
// Two modes share this file:
//
// CLASSIC MODE (the normal link)
//   Start screen → weave while both touch → letting go unravels the newest rows
//   → "Finish" → save the weave as a PNG.
//
// EXHIBITION MODE: "TACT"  (link ending in ?mode=exhibition)
//   The loom waits, responds and remembers. It does not ask, reward or judge.
//   • No instructions on screen. Hidden artist menu: hold the top centre for a
//     moment (or press M on a laptop) to save the cloth or start a new day.
//   • One touch: the free warp threads are pulled gently towards that hand and
//     tremble, like yarn under a finger. A faint light gathers at that edge.
//   • Two touches: the threads go taut, light travels from both edges towards
//     the centre, and only when it meets does the shuttle start, slowly at first.
//     While both stay, the threads grow gradually more luminous; each finished
//     row is a beat: a light runs along the new thread.
//   • Letting go: nothing is erased. The row stays as far as it got, with a
//     loose thread end. A dark "header" pick marks where each encounter began.
//   • One cloth for the whole day, kept only on this device. The woven cloth
//     rolls up like on a real loom, so there is always free warp waiting.
//
// Privacy: this file never sends data anywhere. The cloth (threads only, no
// information about people) is kept in this browser's storage on this device.

(function () {
  "use strict";

  const PARAMS = new URLSearchParams(location.search);
  const EXHIBITION = PARAMS.get("mode") === "exhibition";
  // demo=1: used when the loom is embedded in the project page. It behaves like the
  // exhibition, but keeps nothing (so it never mixes with a real exhibition cloth).
  const DEMO = PARAMS.get("demo") === "1";

  // ---------- Settings you can tweak ----------
  const ROW_MS           = 700;   // time to weave one row = one shared beat
  const GRACE_MS         = 600;   // a slip of the hand shorter than this is forgiven
  const UNRAVEL_ROW_MS   = 1800;  // classic: time for one row to unravel
  const UNRAVEL_LIMIT    = 6;     // classic: max rows lost each time someone lets go
  const ROW_HEIGHT       = 10;    // height of one weft row, in screen points
  const WARP_GAP         = 10;    // space between warp threads, in screen points
  const VIBRATE_MS       = 15;    // vibration tap (Android only)
  const FULL_WAIT_MS     = 1500;  // classic: full loom → end screen after this
  const EXPORT_SCALE     = 3;     // saved image sharpness (lowered for very long cloths)
  const ENCOUNTER_GAP_MS = 20000; // exhibition: 20 s with nobody weaving = next encounter
  const MENU_HOLD_MS     = 1200;  // exhibition: hold the top centre this long → artist menu
  const STORE_KEY        = "two-hand-loom-day-v1";
  const JOIN_MS          = 900;   // light travels from both edges to the centre, then weaving starts
  const LIGHT_FADE_MS    = 1600;  // after parting, the light slowly withdraws to the edges
  const SHARED_RISE_MS   = 3500;  // the threads grow more luminous during shared weaving
  const RAMP_MS          = 1200;  // the shuttle starts slowly, then finds the rhythm
  const FELL_AT          = 0.62;  // exhibition: the weaving line rests at 62% of the height

  const COLOURS = { paper: "#fbfaf8", ink: "#141418", indigo: "#26307f" };

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
  const artistMenu  = $("artist-menu");
  const beginBtn    = $("begin");
  const endTitle    = $("end-title");
  const weaveImg    = $("weave-image");
  const saveBtn     = $("save");
  const backBtn     = $("back");
  const againBtn    = $("again");
  const menuInfo    = $("menu-info");
  const menuSave    = $("menu-save");
  const menuSound   = $("menu-sound");
  const menuBack    = $("menu-back");
  const menuNewDay  = $("menu-new-day");
  const ctx         = canvas.getContext("2d");

  // The finished cloth is drawn once into this hidden canvas and reused every frame.
  const clothCanvas = document.createElement("canvas");
  const cctx = clothCanvas.getContext("2d");

  if (EXHIBITION) {
    document.body.classList.add("exhibition");
    document.title = "TACT";
    if (DEMO) {
      // the shared demo link: quiet edge marks A and B, and one line of guidance
      document.body.classList.add("demo");
      const labels = document.querySelectorAll(".zone-label");
      if (labels[0]) labels[0].textContent = "A";
      if (labels[1]) labels[1].textContent = "B";
      document.getElementById("status").textContent =
        "Touch or click the spots on both edges, A and B, to weave. More fingers, other patterns. " +
        "Keyboard: A S D and J K L.";
    }
    if (!DEMO) {
      // lets the tablet add the exhibition as a full-screen home-screen app
      const link = document.createElement("link");
      link.rel = "manifest";
      link.href = "manifest.webmanifest";
      document.head.appendChild(link);
    }
  }

  // ---------- State ----------
  let screen = EXHIBITION ? "loom" : "start";   // "start", "loom", "end" or "menu"
  const fingers = new Map();                     // finger id -> { zone, y }
  const keys = { left: false, right: false };    // laptop test keys (any key of that side held)
  // Finger spots (exhibition): three on each side, like the treadles of a loom.
  // Keyboard: A S D = left spots, J K L = right spots. Mouse: a click keeps a spot held.
  const SPOT_KEYS = { a: ["left", 0], s: ["left", 1], d: ["left", 2], j: ["right", 0], k: ["right", 1], l: ["right", 2] };
  const keySpots = { left: new Set(), right: new Set() };
  const sticky = { left: new Set(), right: new Set() };
  const spotEls = { left: [], right: [] };
  let fingersNow = 0;   // how many fingers/spots take part right now (chooses the pattern)
  let hintMs = 0, hintGone = false;
  const rows = [];      // woven rows: { dir, hue, tone, p, loose, head, wob, wasFinished }
  let current = null;   // the row on the loom right now
  let clothVersion = 0; // goes up whenever the finished cloth changes (redraw needed)
  let maxRows = 0;
  let pulse = 0;        // 1 right after a beat, fades to 0
  let clock = 0;        // running time, for thread movement
  let lastFrame = performance.now();
  let lastStatus = "";
  let savedBlob = null, savedUrl = null;
  let wasTogether = false;
  let weaveMs = 0;      // how long the current shared weaving has run (for the slow start)

  // light and tension (all 0–1, eased every frame)
  let join = 0;         // how far the light has travelled from the edges towards the centre
  let shared = 0;       // luminosity of the threads during shared weaving
  let pullL = 0, pullR = 0;          // threads pulled towards a single hand
  let yL = 0, yR = 0;                // where that hand is, in canvas coordinates
  let rowLight = null;               // a light running along the newest row after a beat

  // classic mode
  let apartMs = 0, lostThisTime = 0, fullBeatMs = 0, fullMs = 0, endShownForFull = false;

  // exhibition mode
  let parted = true;                    // true when nobody is weaving together
  let quietMs = ENCOUNTER_GAP_MS;       // time since anyone last wove together
  let encounters = 0;
  let band = newBand();                 // colour of the current encounter
  let headNext = false;                 // the next row opens a new encounter
  let day = todayISO();
  let viewTop = 0;                      // how far the cloth has rolled up, in rows

  let W = 0, H = 0, dpr = 1, canvasTop = 0;

  // ---------- 1. Touch detection ----------
  // Landscape: 16% zones; portrait: 22% (matches style.css).
  function zoneShare() { return window.innerWidth > window.innerHeight ? 0.16 : 0.22; }

  function zoneAt(x) {
    const width = window.innerWidth, s = zoneShare();
    if (x < width * s) return "left";
    if (x > width * (1 - s)) return "right";
    return null;
  }

  let menuTimer = null, menuPointer = null, menuStart = null;
  function cancelMenuHold() {
    if (menuTimer) clearTimeout(menuTimer);
    menuTimer = null;
    menuPointer = null;
  }

  stage.addEventListener("pointerdown", function (e) {
    keepAwake();
    if (screen !== "loom") return;
    const zone = zoneAt(e.clientX);
    if (zone && EXHIBITION && e.pointerType === "mouse") {
      // on a laptop one mouse can't hold two edges, so a click keeps the nearest
      // finger spot "held" until it is clicked again
      const i = spotNear(zone, e.clientY);
      if (sticky[zone].has(i)) sticky[zone].delete(i); else sticky[zone].add(i);
    } else if (zone) {
      fingers.set(e.pointerId, { zone: zone, y: e.clientY }); // keeps the zone where it landed
    } else if (EXHIBITION && !DEMO && e.clientY < window.innerHeight * 0.3) {
      cancelMenuHold();
      menuPointer = e.pointerId;
      menuStart = { x: e.clientX, y: e.clientY };
      menuTimer = setTimeout(function () { menuTimer = null; show("menu"); }, MENU_HOLD_MS);
    }
  });

  stage.addEventListener("pointermove", function (e) {
    const f = fingers.get(e.pointerId);
    if (f) f.y = e.clientY;
    if (e.pointerId === menuPointer && menuStart &&
        Math.hypot(e.clientX - menuStart.x, e.clientY - menuStart.y) > 20) cancelMenuHold();
  });

  function release(e) {
    fingers.delete(e.pointerId);
    if (e.pointerId === menuPointer) cancelMenuHold();
  }
  window.addEventListener("pointerup", release);
  window.addEventListener("pointercancel", release);
  stage.addEventListener("pointerleave", function (e) {
    if (e.pointerType === "mouse") release(e);
  });

  function forgetAll() {
    fingers.clear();
    keys.left = keys.right = false;
    keySpots.left.clear();
    keySpots.right.clear();
    cancelMenuHold();
  }
  window.addEventListener("blur", forgetAll);
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) forgetAll(); else keepAwake();
  });

  // Keyboard: hold A S D (left person) and J K L (right person). More keys = more fingers.
  // M = artist menu (exhibition, not in the demo).
  window.addEventListener("keydown", function (e) {
    const k = e.key.toLowerCase();
    const s = SPOT_KEYS[k];
    if (s) { keySpots[s[0]].add(s[1]); keys[s[0]] = true; }
    if (k === "m" && EXHIBITION && !DEMO && !e.repeat) show(screen === "menu" ? "loom" : "menu");
  });
  window.addEventListener("keyup", function (e) {
    const k = e.key.toLowerCase();
    const s = SPOT_KEYS[k];
    if (s) { keySpots[s[0]].delete(s[1]); keys[s[0]] = keySpots[s[0]].size > 0; }
  });

  // The finger spots: three small circles inside each hand zone (exhibition only).
  if (EXHIBITION) {
    ["left", "right"].forEach(function (side) {
      const zone = side === "left" ? zoneLeft : zoneRight;
      const box = document.createElement("div");
      box.className = "spots";
      for (let i = 0; i < 3; i++) {
        const s = document.createElement("span");
        s.className = "spot";
        box.appendChild(s);
        spotEls[side].push(s);
      }
      zone.appendChild(box);
    });
  }
  function spotY(side, i) {
    const el = spotEls[side][i];
    if (!el) return window.innerHeight / 2;
    const r = el.getBoundingClientRect();
    return r.top + r.height / 2;
  }
  function spotNear(side, y) {
    let best = 0, bestD = Infinity;
    for (let i = 0; i < 3; i++) {
      const d = Math.abs(spotY(side, i) - y);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }
  let litKey = "";
  function lightSpots(lit) {
    const key = [...lit.left].sort().join() + "|" + [...lit.right].sort().join();
    if (key === litKey) return;
    litKey = key;
    ["left", "right"].forEach(function (side) {
      spotEls[side].forEach(function (el, i) { el.classList.toggle("on", lit[side].has(i)); });
    });
  }

  // Which weave structure a row gets, from how many fingers take part (2 to 6).
  // 2 = plain weave, 3 = twill, 4 = basket weave, 5–6 = diamond (point twill).
  function patternFor(n) {
    if (n <= 2) return 0;
    if (n === 3) return 1;
    if (n === 4) return 2;
    return 3;
  }
  function warpOnTop(pat, i, row) {
    if (pat === 1) return (i + row) % 4 < 2;                                   // twill: diagonals
    if (pat === 2) return (Math.floor(i / 2) + Math.floor(row / 2)) % 2 === 0; // basket: 2 × 2
    if (pat === 3) return (Math.abs((i % 8) - 4) + row) % 4 < 2;               // diamond: zigzag
    return (i + row) % 2 === 0;                                                // plain weave
  }

  // iPhone/iPad guards: no pinch-zoom, no page bounce, no long-press menu
  // (except on the finished image, so it can be saved with a long press).
  document.addEventListener("gesturestart", function (e) { e.preventDefault(); });
  document.addEventListener("touchmove", function (e) { e.preventDefault(); }, { passive: false });
  document.addEventListener("contextmenu", function (e) {
    if (e.target !== weaveImg) e.preventDefault();
  });

  // Who is touching, and where (height) on each side.
  function whoIsTouching() {
    const t = { left: false, right: false, yL: H * 0.75, yR: H * 0.75 };
    if (screen !== "loom") return t;
    let nL = 0, nR = 0, sL = 0, sR = 0;
    const lit = { left: new Set(), right: new Set() };
    for (const f of fingers.values()) {
      if (f.zone === "left") { nL++; sL += f.y; } else { nR++; sR += f.y; }
      if (EXHIBITION) {
        // each finger lights its nearest free spot
        let i = spotNear(f.zone, f.y);
        for (let k = 0; k < 3 && lit[f.zone].has(i); k++) i = (i + 1) % 3;
        lit[f.zone].add(i);
      }
    }
    ["left", "right"].forEach(function (side) {
      keySpots[side].forEach(function (i) { lit[side].add(i); });
      sticky[side].forEach(function (i) { lit[side].add(i); });
    });
    t.left = nL > 0 || keys.left || lit.left.size > 0;
    t.right = nR > 0 || keys.right || lit.right.size > 0;
    if (EXHIBITION) {
      lightSpots(lit);
      if (!nL && lit.left.size) t.yL = spotY("left", [...lit.left][0]) - canvasTop;
      if (!nR && lit.right.size) t.yR = spotY("right", [...lit.right][0]) - canvasTop;
    }
    if (nL) t.yL = sL / nL - canvasTop;
    if (nR) t.yR = sR / nR - canvasTop;
    fingersNow = Math.min(3, Math.max(nL, lit.left.size)) + Math.min(3, Math.max(nR, lit.right.size));
    return t;
  }

  // Keep the tablet screen awake during an exhibition (where supported).
  let wakeLock = null;
  function keepAwake() {
    if (!EXHIBITION || DEMO || document.hidden || !("wakeLock" in navigator)) return;
    if (wakeLock && !wakeLock.released) return;
    navigator.wakeLock.request("screen").then(function (l) { wakeLock = l; }).catch(function () {});
  }

  // ---------- 2. Sound (optional, off by default) ----------
  let audio = null;
  let soundOn = false;

  function setSound(on) {
    soundOn = on;
    if (soundOn) {
      if (!audio) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC) audio = new AC();
      }
      if (audio && audio.state === "suspended") audio.resume();
    }
    soundBtn.textContent = soundOn ? "Sound on" : "Sound off";
    soundBtn.setAttribute("aria-pressed", String(soundOn));
    menuSound.textContent = soundOn ? "Sound: on" : "Sound: off";
  }
  soundBtn.addEventListener("click", function () { setSound(!soundOn); });
  menuSound.addEventListener("click", function () { setSound(!soundOn); });

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

  // One beat = one finished row: light runs along the new thread, threads brighten,
  // a tiny vibration on Android, and (if on) a soft sound. Light and sound share the beat.
  function beat() {
    pulse = 1;
    if (rows.length) rowLight = { index: rows.length - 1, t: 0 };
    if (navigator.vibrate) navigator.vibrate(VIBRATE_MS);
    thock();
  }

  // ---------- 3. Keeping the day's cloth on this device (exhibition only) ----------
  function todayISO() {
    const d = new Date();
    const pad = function (n) { return String(n).padStart(2, "0"); };
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  function saveDay() {
    if (!EXHIBITION || DEMO) return;
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        v: 2, day: day, encounters: encounters,
        rows: rows.map(function (r) {
          return [r.dir, +r.hue.toFixed(1), +r.tone.toFixed(1), +r.p.toFixed(3),
            r.loose ? 1 : 0, r.head ? 1 : 0, r.wob | 0, r.pat | 0];
        }),
      }));
    } catch (e) { /* storage unavailable: the cloth simply isn't kept after reload */ }
  }

  function loadDay() {
    if (DEMO) return;
    try {
      const d = JSON.parse(localStorage.getItem(STORE_KEY));
      if (!d || (d.v !== 1 && d.v !== 2) || !Array.isArray(d.rows)) return;
      day = typeof d.day === "string" ? d.day : day;
      encounters = d.encounters | 0;
      for (const a of d.rows) {
        if (!Array.isArray(a)) continue;
        rows.push({
          dir: a[0] === -1 ? -1 : 1,
          hue: +a[1] || 248,
          tone: +a[2] || 74,
          p: Math.min(1, Math.max(0.04, +a[3] || 1)),
          loose: !!a[4],
          head: !!a[5],
          wob: Math.min(3, a[6] | 0),
          pat: Math.min(3, a[7] | 0),
          wasFinished: true,
        });
      }
      clothVersion++;
    } catch (e) { /* nothing saved yet, or storage unavailable */ }
  }

  function newDay() {
    rows.length = 0;
    current = null;
    encounters = 0;
    parted = true;
    quietMs = ENCOUNTER_GAP_MS;
    day = todayISO();
    viewTop = 0;
    clothVersion++;
    saveDay();
  }

  // ---------- 4. Canvas size (also handles turning the tablet) ----------
  function resize() {
    dpr = window.devicePixelRatio || 1;
    W = canvas.clientWidth;
    H = canvas.clientHeight;
    canvasTop = canvas.getBoundingClientRect().top;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    maxRows = Math.max(1, Math.floor(H / ROW_HEIGHT));
    if (!EXHIBITION) {
      while (rows.length > maxRows) rows.pop();
      if (rows.length >= maxRows) current = null;
    }
    clothVersion++;
  }
  new ResizeObserver(resize).observe(canvas);

  // ---------- 5. Weaving logic (runs every frame) ----------
  function newBand() {
    // each encounter gets its own shade, within the lilac family
    return { hue: 238 + Math.random() * 24, tone: 68 + Math.random() * 11 };
  }

  function newRow() {
    const r = {
      dir: rows.length % 2 === 0 ? 1 : -1,   // alternate like a real shuttle
      hue: EXHIBITION ? band.hue : 248,
      tone: EXHIBITION ? band.tone + (Math.random() - 0.5) * 2.5 : 73 + Math.random() * 6,
      p: 0, loose: false, head: false, wob: 0, wasFinished: false,
    };
    if (EXHIBITION && headNext) { r.head = true; headNext = false; }
    r.pat = EXHIBITION ? patternFor(fingersNow) : 0;   // more fingers, another weave structure
    return r;
  }

  function weaveForward(dt) {
    weaveMs += dt;
    const ramp = Math.min(1, weaveMs / RAMP_MS);
    const speed = 0.3 + 0.7 * ramp * ramp;        // slow first passes, then the rhythm
    if (!current) current = newRow();
    current.p += (dt / ROW_MS) * speed;
    if (current.p >= 1) {
      current.p = 1;
      current.wasFinished = true;
      rows.push(current);
      current = null;
      clothVersion++;
      beat();
      saveDay();
    }
  }

  // Exhibition: when two people part, the cloth keeps a loose thread end.
  function part() {
    if (current && current.p > 0.04) {
      current.loose = true;          // the half-woven row stays half-woven
      rows.push(current);
    } else if (rows.length > 0) {
      rows[rows.length - 1].loose = true;
    }
    current = null;
    parted = true;
    apartMs = 0;
    clothVersion++;
    saveDay();
  }

  function stepExhibition(dt, together) {
    if (together) {
      if (parted) {
        if (quietMs >= ENCOUNTER_GAP_MS || encounters === 0) {
          encounters++;
          band = newBand();
          headNext = true;           // a dark pick will mark where this encounter begins
        }
        parted = false;
      } else if (apartMs > 0 && current) {
        current.wob = Math.min(3, (current.wob | 0) + 1); // a hesitation leaves the row a little uneven
      }
      apartMs = 0;
      quietMs = 0;
      if (join < 1) return "joining";
      weaveForward(dt);
      return "weaving";
    }
    if (!parted) {
      apartMs += dt;
      if (apartMs >= GRACE_MS) part();
      return "paused";
    }
    quietMs += dt;
    return "waiting";
  }

  function stepClassic(dt, together) {
    if (together) {
      apartMs = 0;
      lostThisTime = 0;
      if (rows.length >= maxRows) {
        fullBeatMs += dt;
        if (fullBeatMs >= ROW_MS) { fullBeatMs -= ROW_MS; beat(); }
        return "full";
      }
      if (join < 1) return "joining";
      weaveForward(dt);
      return "weaving";
    }

    fullBeatMs = 0;
    apartMs += dt;
    if (apartMs < GRACE_MS) return rows.length >= maxRows ? "full" : "paused";

    if (!current && rows.length > 0 && lostThisTime < UNRAVEL_LIMIT) {
      current = rows.pop();
      clothVersion++;
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

  function step(dt, t) {
    if (screen !== "loom") return "idle";
    const together = t.left && t.right;
    if (together && !wasTogether) weaveMs = 0;
    wasTogether = together;
    return EXHIBITION ? stepExhibition(dt, together) : stepClassic(dt, together);
  }

  // ---------- 6. Thread drawing (screen AND saved image) ----------
  // Small, repeatable "irregularity" for each thread, so the cloth looks hand-made
  // but always looks the same for the same row and thread.
  function rand2(a, b) {
    let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }

  function threadColour(r, alpha, dl) {
    if (r.head) return "hsla(236, 42%, " + (28 + (dl || 0) * 0.6).toFixed(1) + "%, " + alpha + ")";
    return "hsla(" + r.hue.toFixed(1) + ", 38%, " + (r.tone + (dl || 0)).toFixed(1) + "%, " + alpha + ")";
  }

  // Warp positions: evenly spaced with a slight hand-made irregularity.
  let geoCache = null;
  function geometry(width) {
    if (geoCache && geoCache.width === width) return geoCache;
    const cols = Math.max(2, Math.floor(width / WARP_GAP));
    const firstX = (width - (cols - 1) * WARP_GAP) / 2;
    const xs = [], ws = [];
    for (let i = 0; i < cols; i++) {
      xs.push(firstX + i * WARP_GAP + (rand2(i, 1) - 0.5) * 1.1);
      ws.push(1.35 + rand2(i, 2) * 0.5);
    }
    geoCache = { width: width, cols: cols, xs: xs, ws: ws, firstX: firstX, lastX: firstX + (cols - 1) * WARP_GAP };
    return geoCache;
  }

  function pill(c, x, y, w, h) {
    if (w <= 0) return;
    if (c.roundRect) c.roundRect(x, y, w, h, Math.min(h / 2, w / 2));
    else c.rect(x, y, w, h);
  }

  // A loose thread end hanging from the tip of a row
  function looseEnd(c, r, tipX, y) {
    c.strokeStyle = threadColour(r, 0.9, 0);
    c.lineWidth = r.head ? 1.4 : 2;
    c.lineCap = "round";
    c.beginPath();
    c.moveTo(tipX, y + ROW_HEIGHT / 2);
    c.quadraticCurveTo(tipX + r.dir * 9, y + ROW_HEIGHT * 1.2, tipX + r.dir * 3, y + ROW_HEIGHT * 2.6);
    c.stroke();
  }

  // One weft row, interlaced with the warp (plain weave).
  // The weft floats over one warp thread and dips under the next. Where it passes under,
  // the warp lies on top (indigo) with a small shadow on the weft; where it rides over,
  // a soft highlight shows the bump of the thread. wave = looseness before the row is beaten in.
  // Returns the x of the thread's tip.
  function drawWeft(c, r, index, y, p, geo, wave) {
    const len = (geo.lastX - geo.firstX + 6) * p;
    const x0 = r.dir === 1 ? geo.firstX - 3 : geo.lastX + 3 - len;
    const x1 = x0 + len;
    const tipX = r.dir === 1 ? x1 : x0;
    if (len <= 0.5) return tipX;

    const cy = y + ROW_HEIGHT / 2;
    const thick = r.head ? 3.6 : 6.3 + rand2(index, 7) * 1.9;   // yarn thickness varies per row
    const amp = wave + (r.wob | 0) * 0.55;                     // hesitations make a row uneven

    // where the warp lies on top of this row
    const over = [];
    for (let i = 0; i < geo.cols; i++) if (warpOnTop(r.pat | 0, i, index)) over.push(i);
    const bounds = [geo.firstX - 3];
    for (const i of over) bounds.push(geo.xs[i]);
    bounds.push(geo.lastX + 3);

    // 1. the floats of weft between crossings
    const floats = [];
    c.fillStyle = threadColour(r, 1, 0);
    c.beginPath();
    for (let k = 0; k < bounds.length - 1; k++) {
      const a = Math.max(bounds[k], x0), b = Math.min(bounds[k + 1], x1);
      if (b - a < 0.3) continue;
      const tv = thick * (0.9 + rand2(index * 97 + k, 11) * 0.2);
      const yOff = amp * Math.sin(k * 1.7 + index * 0.9) + (rand2(index, k + 40) - 0.5) * 0.7;
      pill(c, a - 0.6, cy - tv / 2 + yOff, b - a + 1.2, tv);
      floats.push([a, b, tv, yOff]);
    }
    c.fill();

    // 2. highlight where the weft rides over a warp thread (the bump of the yarn)
    if (!r.head) {
      c.fillStyle = threadColour(r, 0.55, 10);
      c.beginPath();
      for (const f of floats) {
        const w = (f[1] - f[0]) * 0.42;
        if (w < 1) continue;
        pill(c, (f[0] + f[1]) / 2 - w / 2, cy - f[2] * 0.36 + f[3], w, f[2] * 0.3);
      }
      c.fill();
    }

    // 3. shadow on the weft beside each warp that lies on top, then the warp itself
    c.fillStyle = threadColour(r, 0.6, -14);
    c.beginPath();
    for (const i of over) {
      const x = geo.xs[i];
      if (x < x0 || x > x1) continue;
      const hw = geo.ws[i] / 2 + 0.6;
      c.rect(x - hw - 1.1, cy - thick / 2, 1.1, thick);
      c.rect(x + hw, cy - thick / 2, 1.1, thick);
    }
    c.fill();

    c.fillStyle = COLOURS.indigo;
    c.beginPath();
    for (const i of over) {
      const x = geo.xs[i];
      if (x < x0 || x > x1) continue;
      const w = geo.ws[i] + 1.2;
      pill(c, x - w / 2, y - 0.3, w, ROW_HEIGHT + 0.6);
    }
    c.fill();

    return tipX;
  }

  // Straight warp threads behind the woven cloth.
  function drawWarpStraight(c, geo, top, bottom, alpha) {
    if (bottom <= top) return;
    c.strokeStyle = COLOURS.indigo;
    c.globalAlpha = alpha;
    c.lineWidth = 1.5;
    c.beginPath();
    for (let i = 0; i < geo.cols; i++) {
      c.moveTo(geo.xs[i], top);
      c.lineTo(geo.xs[i], bottom);
    }
    c.stroke();
    c.globalAlpha = 1;
  }

  // Draw the finished cloth into the hidden canvas, only when something changed.
  let clothKey = "";
  function renderCloth(geo, top) {
    const key = clothVersion + "|" + top + "|" + W + "|" + H + "|" + dpr;
    if (key === clothKey || W < 1 || H < 1) return;
    clothKey = key;
    const ch = H + ROW_HEIGHT * 4;
    clothCanvas.width = Math.round(W * dpr);
    clothCanvas.height = Math.round(ch * dpr);
    const c = cctx;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, W, ch);
    const bottom = Math.min(ch, (rows.length - top) * ROW_HEIGHT);
    drawWarpStraight(c, geo, 0, bottom, 0.5);
    const end = Math.min(rows.length, top + Math.ceil(ch / ROW_HEIGHT) + 1);
    for (let i = Math.max(0, top - 1); i < end; i++) {
      const y = (i - top) * ROW_HEIGHT;
      const tip = drawWeft(c, rows[i], i, y, rows[i].p, geo, 0);
      if (rows[i].loose) looseEnd(c, rows[i], tip, y);
    }
  }

  // ---------- 7. Free warp: tension, trembling and light ----------
  // The free warp hangs between the cloth (top) and the warp beam (bottom of the screen).
  // Like real yarn, it is fixed at both ends and moves most in the middle.
  function lightAt(i, geo) {
    const f = i / (geo.cols - 1);
    const d = Math.min(f, 1 - f) * 2;              // 0 at the edges, 1 in the centre
    const front = clamp01((join * 1.2 - d) / 0.2); // the light front moving inwards
    let L = front * (0.45 + 0.4 * shared + 0.25 * pulse);
    // a faint gathering of light at the edge of a single hand
    L = Math.max(L, 0.32 * pullL * clamp01(1 - f / 0.07), 0.32 * pullR * clamp01(1 - (1 - f) / 0.07));
    return L;
  }

  function offsetAt(i, y, geo, top, bottom) {
    const f = i / (geo.cols - 1);
    const s = clamp01((y - top) / (bottom - top));
    const env = Math.pow(Math.sin(Math.PI * s), 0.8);  // fixed at both ends
    let dx = 0;
    if (pullL > 0.01) {
      const fall = Math.pow(1 - f, 2.2), bell = Math.exp(-Math.pow((y - yL) / 150, 2));
      dx -= pullL * fall * (9 * bell + 1.1 * Math.sin(clock * 0.008 + y * 0.045 + i * 0.9));
    }
    if (pullR > 0.01) {
      const fall = Math.pow(f, 2.2), bell = Math.exp(-Math.pow((y - yR) / 150, 2));
      dx += pullR * fall * (9 * bell + 1.1 * Math.sin(clock * 0.008 + y * 0.045 + i * 1.3));
    }
    if (pulse > 0.02 && join > 0.5) dx += pulse * 0.8 * Math.sin(y * 0.07 + clock * 0.03 + i); // the beat runs through taut threads
    return dx * env;
  }

  function drawFreeWarp(c, geo, top, bottom) {
    if (bottom - top < 2) return;
    const moving = pullL > 0.01 || pullR > 0.01 || (pulse > 0.02 && join > 0.5);
    // group threads by brightness, so each group is drawn in one stroke
    const groups = [[], [], [], [], []];
    for (let i = 0; i < geo.cols; i++) {
      const L = lightAt(i, geo);
      groups[L < 0.04 ? 0 : Math.min(4, 1 + Math.floor(L * 3.2))].push(i);
    }
    for (let g = 0; g < groups.length; g++) {
      if (!groups[g].length) continue;
      const L = g === 0 ? 0 : g / 3.6;
      // indigo → a luminous violet, with a soft lilac halo: light inside the thread
      const rr = Math.round(38 + 82 * L), gg = Math.round(48 + 60 * L), bb = Math.round(127 + 93 * L);
      c.strokeStyle = "rgb(" + rr + "," + gg + "," + bb + ")";
      c.globalAlpha = g === 0 ? 0.5 + 0.15 * pulse : 0.7 + 0.3 * L;
      c.lineWidth = 1.5 + 0.5 * L;
      c.shadowColor = "rgba(179, 173, 216, 0.7)";
      c.shadowBlur = g === 0 ? 0 : 2 + 4 * L;
      c.beginPath();
      for (const i of groups[g]) {
        const x0 = geo.xs[i];
        if (!moving) { c.moveTo(x0, top); c.lineTo(x0, bottom); continue; }
        for (let y = top; ; y += 10) {
          const yy = Math.min(y, bottom);
          const x = x0 + offsetAt(i, yy, geo, top, bottom);
          if (y === top) c.moveTo(x, yy); else c.lineTo(x, yy);
          if (yy >= bottom) break;
        }
      }
      c.stroke();
    }
    c.shadowBlur = 0;
    c.globalAlpha = 1;
  }

  // ---------- 8. The frame drawing ----------
  function draw(mode, dt) {
    if (W < 1 || H < 1) return; // not laid out yet (e.g. hidden tab)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = COLOURS.paper;
    ctx.fillRect(0, 0, W, H);

    const geo = geometry(W);
    const top = Math.max(0, Math.floor(viewTop));
    renderCloth(geo, top);
    const shift = (viewTop - top) * ROW_HEIGHT;
    if (clothCanvas.width > 0 && clothCanvas.height > 0) {
      ctx.drawImage(clothCanvas, 0, -shift, W, clothCanvas.height / dpr);
    }

    const fellY = (rows.length - viewTop) * ROW_HEIGHT;   // where the newest row will go
    drawFreeWarp(ctx, geo, fellY, H);

    // a soft light gathering at the weaving line while two people weave together
    const glow = 0.1 * shared + 0.08 * pulse * shared;
    if (glow > 0.005) {
      const g = ctx.createLinearGradient(0, fellY - 36, 0, fellY + 36);
      g.addColorStop(0, "rgba(179,173,216,0)");
      g.addColorStop(0.5, "rgba(179,173,216," + glow.toFixed(3) + ")");
      g.addColorStop(1, "rgba(179,173,216,0)");
      ctx.fillStyle = g;
      ctx.fillRect(geo.firstX - 10, fellY - 36, geo.lastX - geo.firstX + 20, 72);
    }

    // the row on the loom now: a little loose while it is being woven
    if (current) {
      if (mode === "unravelling") ctx.globalAlpha = 0.75;
      const tip = drawWeft(ctx, current, rows.length, fellY, current.p, geo, mode === "weaving" ? 1 : 0.6);
      ctx.globalAlpha = 1;
      if (mode === "weaving" && current.p < 1) {
        ctx.fillStyle = COLOURS.ink;                      // the shuttle
        ctx.beginPath();
        ctx.ellipse(tip + current.dir * 5, fellY + ROW_HEIGHT / 2, 7, 2.6, 0, 0, Math.PI * 2);
        ctx.fill();
      } else if (mode === "unravelling") {
        looseEnd(ctx, current, tip, fellY);
      }
    }

    // after each beat, a light runs along the new thread from where the shuttle started
    if (rowLight) {
      rowLight.t += dt;
      const k = rowLight.t / 650;
      const r = rows[rowLight.index];
      if (k >= 1 || !r) rowLight = null;
      else {
        const y = (rowLight.index - viewTop) * ROW_HEIGHT;
        const span = geo.lastX - geo.firstX;
        const x = r.dir === 1 ? geo.firstX + span * k : geo.lastX - span * k;
        const g = ctx.createLinearGradient(x - 22, 0, x + 22, 0);
        const a = (0.8 * (1 - k)).toFixed(3);
        g.addColorStop(0, "rgba(255,255,255,0)");
        g.addColorStop(0.5, "rgba(255,255,255," + a + ")");
        g.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = g;
        ctx.fillRect(x - 22, y + 1.5, 44, ROW_HEIGHT - 3);
      }
    }
  }

  // ---------- 9. The saved image ----------
  function dateText(iso) {
    const d = iso ? new Date(iso + "T12:00:00") : new Date();
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  }
  function rowsText(n) { return n + (n === 1 ? " row" : " rows"); }
  function encountersText(n) { return n + (n === 1 ? " encounter" : " encounters"); }

  function makeImage(list, title, subtitle) {
    const margin = 36, fringe = 22, captionH = 58;
    const geo = geometry(W);
    const weaveH = list.length * ROW_HEIGHT;
    const outW = Math.round(W + margin * 2);
    const outH = Math.round(margin + fringe + weaveH + fringe + captionH + margin * 0.6);

    // very long cloths are saved a little less sharp, so tablets can handle them
    const scale = Math.max(0.5, Math.min(EXPORT_SCALE,
      Math.sqrt(16e6 / (outW * outH)), 16000 / outH));

    const out = document.createElement("canvas");
    out.width = Math.round(outW * scale);
    out.height = Math.round(outH * scale);
    const c = out.getContext("2d");
    c.scale(scale, scale);

    c.fillStyle = COLOURS.paper;
    c.fillRect(0, 0, outW, outH);

    c.save();
    c.translate(margin, margin + fringe);
    drawWarpStraight(c, geo, -fringe, weaveH + fringe, 0.55);
    for (let i = 0; i < list.length; i++) {
      const y = i * ROW_HEIGHT;
      const tip = drawWeft(c, list[i], i, y, list[i].p, geo, 0);
      if (list[i].loose) looseEnd(c, list[i], tip, y);
    }
    c.restore();

    const capY = margin + fringe * 2 + weaveH + 26;
    c.textAlign = "center";
    c.fillStyle = COLOURS.indigo;
    c.font = "500 15px Literata, Georgia, serif";
    c.fillText(title, outW / 2, capY);
    c.fillStyle = COLOURS.ink;
    c.globalAlpha = 0.6;
    c.font = "11px 'Atkinson Hyperlegible Next', system-ui, sans-serif";
    c.fillText(subtitle, outW / 2, capY + 18);
    c.globalAlpha = 1;

    return new Promise(function (resolve) { out.toBlob(resolve, "image/png"); });
  }

  function fileName() {
    const d = new Date();
    const pad = function (n) { return String(n).padStart(2, "0"); };
    const stamp = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) +
      "-" + pad(d.getHours()) + pad(d.getMinutes());
    return (EXHIBITION ? "tact-" : "two-hand-loom-") + stamp + ".png";
  }

  async function saveImage() {
    if (!savedBlob) return;
    const name = fileName();
    const file = new File([savedBlob], name, { type: "image/png" });
    const isTouch = window.matchMedia("(pointer: coarse)").matches;
    if (isTouch && navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: EXHIBITION ? "The day's cloth" : "Our weave" });
        return;
      } catch (err) {
        if (err && err.name === "AbortError") return;
      }
    }
    const a = document.createElement("a");
    a.href = savedUrl;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  // ---------- 10. Screens ----------
  function show(name) {
    if (EXHIBITION && name !== "loom" && !parted) part();
    if (!EXHIBITION && name !== "loom") current = null;
    screen = name;
    startScreen.hidden = name !== "start";
    endScreen.hidden = name !== "end";
    artistMenu.hidden = name !== "menu";
    forgetAll();
    if (name === "menu") {
      menuInfo.textContent = "Cloth of " + dateText(day) + " · " + rowsText(rows.length) +
        " · " + encountersText(encounters) + ". Kept only on this device.";
      menuSave.disabled = rows.length === 0;
    }
  }

  async function openEnd() {
    show("end");
    saveBtn.disabled = true;
    saveBtn.textContent = "Preparing…";

    try {
      await Promise.all([
        document.fonts.load("500 15px Literata"),
        document.fonts.load("11px 'Atkinson Hyperlegible Next'"),
      ]);
    } catch (e) { /* fallback fonts are fine */ }

    const title = EXHIBITION ? "TACT" : "The Two-Hand Loom";
    const subtitle = EXHIBITION
      ? "the cloth of " + dateText(day) + " · " + rowsText(rows.length) + " · " + encountersText(encounters)
      : "woven by two hands · " + rowsText(rows.length) + " · " + dateText();

    savedBlob = await makeImage(rows.slice(), title, subtitle);
    if (savedUrl) URL.revokeObjectURL(savedUrl);
    savedUrl = savedBlob ? URL.createObjectURL(savedBlob) : null;
    weaveImg.src = savedUrl || "";
    saveBtn.disabled = !savedBlob;
    saveBtn.textContent = EXHIBITION ? "Save the day's cloth" : "Save our weave";
  }

  function confirmNewDay() {
    const ok = window.confirm(
      "Start a new day?\n\nToday's cloth will be cleared from this device. Save it first if you want to keep it.");
    if (ok) newDay();
    return ok;
  }

  if (EXHIBITION) {
    endTitle.textContent = "The day's cloth";
    againBtn.textContent = "Start a new day";
  }

  beginBtn.addEventListener("click", function () { show("loom"); });
  finishBtn.addEventListener("click", function () { if (rows.length > 0) openEnd(); });
  saveBtn.addEventListener("click", saveImage);
  backBtn.addEventListener("click", function () { show("loom"); });
  againBtn.addEventListener("click", function () {
    if (EXHIBITION) {
      if (confirmNewDay()) show("loom");
      return;
    }
    rows.length = 0;
    current = null;
    lostThisTime = 0;
    apartMs = 0;
    endShownForFull = false;
    clothVersion++;
    show("loom");
  });
  menuSave.addEventListener("click", function () { if (rows.length > 0) openEnd(); });
  menuBack.addEventListener("click", function () { show("loom"); });
  menuNewDay.addEventListener("click", function () { if (confirmNewDay()) show("loom"); });

  // ---------- 11. Status text (classic mode only) ----------
  function updateStatus(t, mode) {
    zoneLeft.classList.toggle("active", t.left);
    zoneRight.classList.toggle("active", t.right);
    stage.style.setProperty("--pulse", pulse.toFixed(3));
    if (EXHIBITION) return; // no words on screen in exhibition mode

    finishBtn.disabled = rows.length === 0;
    const count = rowsText(rows.length);
    let text;
    if (mode === "full") text = "The loom is full · " + count;
    else if (mode === "weaving" || mode === "joining") text = "Weaving together · " + count;
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

  // ---------- 12. The heartbeat: runs every frame ----------
  function frame(now) {
    const dt = Math.min(now - lastFrame, 100);
    lastFrame = now;
    clock += dt;

    const t = whoIsTouching();
    const together = t.left && t.right;

    // light travels in when both touch, and withdraws slowly when they part
    join = together ? Math.min(1, join + dt / JOIN_MS) : Math.max(0, join - dt / LIGHT_FADE_MS);

    const mode = step(dt, t);
    pulse = Math.max(0, pulse - dt / 450);
    shared = mode === "weaving" || mode === "full"
      ? Math.min(1, shared + dt / SHARED_RISE_MS)
      : Math.max(0, shared - dt / 2000);

    // a single hand pulls the threads towards it; with two hands they go taut
    const ease = Math.min(1, dt / 300);
    pullL += ((t.left && !t.right ? 1 : 0) - pullL) * ease;
    pullR += ((t.right && !t.left ? 1 : 0) - pullR) * ease;
    if (t.left) yL += (t.yL - yL) * ease;
    if (t.right) yR += (t.yR - yR) * ease;

    if (EXHIBITION) {
      // the woven cloth rolls up, like onto a cloth beam, so free warp always waits below
      const target = Math.max(0, rows.length + 1 - Math.floor(maxRows * FELL_AT));
      viewTop += (target - viewTop) * Math.min(1, dt / 400);
    } else if (rows.length >= maxRows && screen === "loom" && !endShownForFull) {
      fullMs += dt;
      if (fullMs >= FULL_WAIT_MS) { endShownForFull = true; fullMs = 0; openEnd(); }
    } else {
      fullMs = 0;
    }

    if (screen === "loom") {
      // demo: the one-line hint is only for the first glance; it fades once people weave
      if (DEMO && mode === "weaving" && !hintGone) {
        hintMs += dt;
        if (hintMs > 4000) { hintGone = true; statusEl.classList.add("faded"); }
      }
      updateStatus(t, mode);
      draw(mode, dt);
    }
    requestAnimationFrame(frame);
  }

  if (EXHIBITION) {
    loadDay();
    show("loom");
    keepAwake();
  }
  resize();
  yL = yR = H * 0.75;
  if (EXHIBITION) viewTop = Math.max(0, rows.length + 1 - Math.floor(maxRows * FELL_AT));
  draw("idle", 0);
  requestAnimationFrame(frame);

  // ---------- 13. Offline support ----------
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("sw.js").catch(function () { /* fine without it */ });
  }
})();

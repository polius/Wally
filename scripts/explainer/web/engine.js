/* Wally film — deterministic render engine.
 *
 * Everything on screen is a pure function of the video timestamp t. The capture
 * harness calls window.__render(t) once per frame and screenshots the page; no
 * wall-clock animation is ever used, so every frame is reproducible. When a
 * frame swaps an image (a typing step, a scroll position), __render returns a
 * promise that settles once the new image is decoded, and the harness waits.
 *
 * Scenes register into window.SCENES (see scenes.js). Each gets its own layer
 * with an inner camera. The engine owns what is Wally's own:
 *   - the cut: a till receipt goes by in front of the scene, printed with the
 *     next chapter as a line item, while the scenes cross behind it;
 *   - the ledger: a category bar along the bottom that gains a segment, in the
 *     app's category colours, every time a receipt goes by;
 *   - the background: the app's pale canvas, a ledger's dot grid that ink runs
 *     through at every cut, and two soft glows (wallet tan, Wally indigo);
 *   - rolling digits (an odometer) for every amount the film writes itself;
 *   - the sound-effect cue registry, read by sfx.py.
 */
(function () {
  const SCENES = (window.SCENES = {});

  // ---- math / easing ------------------------------------------------------
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const lerp = (a, b, t) => a + (b - a) * t;
  const ramp = (t, a, b) => (b <= a ? (t >= b ? 1 : 0) : clamp((t - a) / (b - a)));
  const outQuint = (t) => 1 - Math.pow(1 - clamp(t), 5);
  const outCubic = (t) => 1 - Math.pow(1 - clamp(t), 3);
  const outExpo = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * clamp(t)));
  const inCubic = (t) => Math.pow(clamp(t), 3);
  const inOutCubic = (t) => { t = clamp(t); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
  const inOutSine = (t) => -(Math.cos(Math.PI * clamp(t)) - 1) / 2;
  const outBack = (t, s = 1.4) => { t = clamp(t); return 1 + (s + 1) * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2); };
  const spring = (t, k = 9, z = 6) => (t <= 0 ? 0 : 1 - Math.exp(-z * t) * Math.cos(k * t));

  // seeded noise, so "random" things are identical on every render
  function rnd(i) { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }

  /* fade + rise (+ scale, + a short de-blur) from p = 0..1 */
  function reveal(node, p, o = {}) {
    if (!node) return p;
    const e = (o.ease || outQuint)(p);
    if (p <= 0) { node.style.visibility = "hidden"; return p; }
    node.style.visibility = "visible";
    node.style.opacity = clamp(e * (o.alpha ?? 1)).toFixed(4);
    const dy = (o.dy ?? 30) * (1 - e), dx = (o.dx ?? 0) * (1 - e);
    const sc = lerp(o.scale ?? 1, 1, e);
    node.style.transform = `${o.base || ""} translate3d(${dx.toFixed(2)}px, ${dy.toFixed(2)}px, 0) scale(${sc.toFixed(4)})`;
    const bl = (o.blur ?? 0) * (1 - e);
    node.style.filter = bl > 0.3 ? `blur(${bl.toFixed(2)}px)` : "none";
    return p;
  }
  function show(node, on) { node.style.visibility = on ? "visible" : "hidden"; }

  // ---- DOM helpers ----------------------------------------------------------
  const NS = "http://www.w3.org/2000/svg";
  function el(tag, cls, parent, html) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    if (parent) parent.appendChild(n);
    return n;
  }
  function svg(tag, attrs, parent) {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  /* centre-anchored box at (x, y); its own transform stays free for reveal() */
  function at(parent, x, y, cls, html) {
    const wrap = el("div", "ctr", parent);
    wrap.style.left = x + "px"; wrap.style.top = y + "px";
    return el("div", cls || "", wrap, html);
  }
  function box(parent, x, y, w, h, cls) {
    const n = el("div", "abs " + (cls || ""), parent);
    Object.assign(n.style, { left: x + "px", top: y + "px", width: w + "px", height: h + "px" });
    return n;
  }
  const cache = new WeakMap();
  function setText(node, s) { if (cache.get(node) !== s) { node.textContent = s; cache.set(node, s); } }
  function setHTML(node, s) { if (cache.get(node) !== s) { node.innerHTML = s; cache.set(node, s); } }
  /* a Lucide icon from the app's own sprite */
  function icon(name, size = 32, stroke = 2) {
    return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round"><use href="/icons/lucide.svg#${name}"/></svg>`;
  }

  /* kinetic words: split `html` words into masked spans. Words may carry a class: "went|acc" */
  function words(parent, text) {
    return text.split(" ").map((w, i, all) => {
      const [word, cls] = w.split("|");
      const k = el("span", "kt", parent);
      const s = el("span", cls || "", k);
      s.textContent = word;
      if (i < all.length - 1) parent.appendChild(document.createTextNode(" "));
      return s;
    });
  }
  /* rise each word out of its mask, staggered from t0; leave upwards from `out` */
  function kin(spans, t, t0, stagger = 0.05, dur = 0.55, out = null) {
    spans.forEach((s, i) => {
      const p = outQuint(ramp(t, t0 + i * stagger, t0 + i * stagger + dur));
      let y = (1 - p) * 115;
      if (out != null) y -= inCubic(ramp(t, out + i * stagger * 0.4, out + i * stagger * 0.4 + 0.32)) * 115;
      s.style.transform = `translateY(${y.toFixed(2)}%)`;
    });
  }

  // ---- images: every swap is awaited before the frame is captured ----------
  const PENDING = [];
  const WAIT = [];
  function setSrc(img, url) {
    if (img.dataset.src === url) return;
    img.dataset.src = url;
    img.src = url;
    PENDING.push(img.decode().catch(() => {}));
  }
  function image(parent, url, cls) {
    const img = el("img", cls || "", parent);
    img.decoding = "sync";
    img.dataset.src = url;
    img.src = url;
    WAIT.push(img.decode().catch(() => {}));
    return img;
  }
  /* preload images that will be swapped in later, so a swap never waits on the network */
  function preload(urls) { urls.forEach((u) => { const i = new Image(); i.src = u; WAIT.push(i.decode().catch(() => {})); }); }

  /* ---- rolling digits ----------------------------------------------------------
     odometer(parent, "2,658 €"): every digit is a column 0..9 that rolls up to
     its value, the rightmost first, like a till's drum counter. set(p): 0..1. */
  function odometer(parent, text, o = {}) {
    const n = el("span", "odo " + (o.cls || ""), parent);
    const cols = [];
    let digitIndex = 0;
    const totalDigits = [...text].filter((c) => /\d/.test(c)).length;
    for (const ch of text) {
      if (/\d/.test(ch)) {
        const c = el("span", "col", n);
        const strip = el("span", "", c);
        for (let k = 0; k <= 19; k++) el("b", "", strip, String(k % 10));
        // more turns for the high digits: the leftmost spins least
        const turns = 1 + Math.floor((totalDigits - digitIndex - 1) / 2);
        cols.push({ strip, target: +ch + 10 * Math.min(1, turns), i: digitIndex });
        digitIndex++;
      } else {
        el("span", "ch", n).textContent = ch;
      }
    }
    return {
      node: n,
      set(p) {
        cols.forEach((c) => {
          // the rightmost digits start first and travel furthest
          const k = (totalDigits - 1 - c.i) / Math.max(1, totalDigits - 1);
          const q = outCubic(ramp(p, (1 - k) * 0.25, 0.75 + (1 - k) * 0.25));
          c.strip.style.transform = `translateY(${(-q * c.target).toFixed(3)}em)`;
        });
      },
    };
  }

  const A = { clamp, lerp, ramp, rnd, outQuint, outCubic, outExpo, inCubic, inOutCubic, inOutSine, outBack, spring,
              reveal, show, el, svg, at, box, setText, setHTML, icon, words, kin, image, setSrc, preload, odometer };
  window.Toolkit = A;

  // ---- timeline, cues ------------------------------------------------------------
  let TL = null;
  const CUES = [];                 // sound effects: { t, type, gain }
  const PULSES = [];               // [t, gain, x, y]: ink spreading through the dot grid
  let DATA = {};

  function api(scene, layer, cam) {
    const t0 = scene.start;
    return Object.assign({
      tl: TL.d, scene, layer, cam, t0, W: 1920, H: 1080, data: DATA,
      dur: scene.end - scene.start,
      on: (id, label) => TL.byId[id].onsets[label] - t0,
      segStart: (id) => TL.byId[id].start - t0,
      segEnd: (id) => TL.byId[id].end - t0,
      cue: (type, t, gain = 1) => CUES.push({ t: +(t0 + t).toFixed(3), type, gain }),
      pulse: (t, gain = 1, x = 960, y = 540) => PULSES.push([t0 + t, gain, x, y]),
    }, A);
  }

  // ---- background: a ledger's dot grid that ink runs through ----------------
  const PITCH = 32, DOT = 3;
  let dctx = null, DPR = 1;
  function paintBackground(t) {
    const bg = document.getElementById("bg");
    const g1 = bg.querySelector(".g1"), g2 = bg.querySelector(".g2");
    g1.style.transform = `translate(${(-560 + 160 * Math.sin(t * 0.11)).toFixed(1)}px, ${(-820 + 130 * Math.cos(t * 0.09)).toFixed(1)}px)`;
    g2.style.transform = `translate(${(1060 + 140 * Math.sin(t * 0.08 + 2)).toFixed(1)}px, ${(-40 + 120 * Math.sin(t * 0.07 + 1)).toFixed(1)}px)`;
    const c = dctx;
    c.setTransform(DPR, 0, 0, DPR, 0, 0);
    c.clearRect(0, 0, 1920, 1080);
    const live = PULSES.filter(([t0]) => t >= t0 - 0.05 && t < t0 + 2.4);
    for (let y = PITCH / 2; y < 1080; y += PITCH) {
      for (let x = PITCH / 2; x < 1920; x += PITCH) {
        let a = 0.075, ink = 0;
        for (const [t0, gain, px, py] of live) {
          const front = (t - t0) * 1300;
          const d = Math.hypot(x - px, y - py);
          ink += gain * Math.exp(-(((d - front) / 80) ** 2)) * Math.exp(-(t - t0) * 1.1);
        }
        ink = Math.min(1, ink);
        if (ink > 0.02) {
          c.fillStyle = `rgba(79,91,213,${(a + ink * 0.5).toFixed(3)})`;
          const s = DOT + ink * 2.2;
          c.fillRect(x - s / 2, y - s / 2, s, s);
        } else {
          c.fillStyle = `rgba(20,22,40,${a})`;
          c.fillRect(x - DOT / 2, y - DOT / 2, DOT, DOT);
        }
      }
    }
  }

  /* ---- the receipt ---------------------------------------------------------------
     At every cut a strip of till paper rises through the frame, printed with the
     next chapter as a line item ("October ........ 2,658.00"). It slows as it
     passes the middle, so the line can be read, then tears off upwards. The
     scenes cross behind it. */
  const RW = 780, RH = 520, TOOTH = 26, DEPTH = 13;
  const CUT_IN = 0.55, CUT_OUT = 0.55;
  function zigzag(w, h) {
    const pts = [];
    const n = Math.round(w / TOOTH);
    for (let i = 0; i <= n; i++) pts.push(`${(i * w / n).toFixed(1)}px ${i % 2 ? DEPTH : 0}px`);
    for (let i = n; i >= 0; i--) pts.push(`${(i * w / n).toFixed(1)}px ${h - (i % 2 ? DEPTH : 0)}px`);
    return `polygon(${pts.join(",")})`;
  }
  const RECEIPTS = [];
  function buildReceipt(cut, idx) {
    const root = document.getElementById("receipts");
    const wrap = el("div", "abs", root);
    Object.assign(wrap.style, { left: (960 - RW / 2) + "px", top: "0px", width: RW + "px", height: RH + "px" });
    const p = el("div", "paper", wrap);
    Object.assign(p.style, { left: 0, top: 0, width: RW + "px", height: RH + "px", clipPath: zigzag(RW, RH) });
    // the thermal paper's faint tone, darker towards the tear
    el("div", "abs", p).style.cssText = "inset:0;background:linear-gradient(180deg,rgba(20,22,40,.035),transparent 18%,transparent 82%,rgba(20,22,40,.035))";
    const pad = 56;
    const head = box(p, pad, 64, RW - 2 * pad, 40);
    head.style.cssText += ";display:flex;justify-content:space-between;font:500 22px/1 var(--mono);color:#8a8f9b;letter-spacing:.14em";
    head.innerHTML = `<span>WALLY</span><span>No. ${String(idx + 1).padStart(2, "0")}</span>`;
    const rule = (y) => { const r = box(p, pad, y, RW - 2 * pad, 2); r.style.cssText += ";background-image:linear-gradient(90deg,#c9ccd4 50%,transparent 50%);background-size:12px 2px"; };
    rule(122);
    const title = box(p, pad, 160, RW - 2 * pad, 40);
    title.style.cssText += ";font:600 26px/1 var(--mono);color:#5b606c;letter-spacing:.22em";
    title.textContent = cut.title.toUpperCase();
    const item = box(p, pad, 230, RW - 2 * pad, 60);
    item.style.cssText += ";display:flex;align-items:baseline;gap:14px;font:600 46px/1 var(--mono);color:#14161b;letter-spacing:-.01em";
    item.innerHTML = `<span>${cut.item}</span><span style="flex:1;border-bottom:3px dotted #b9bdc6;transform:translateY(-10px)"></span><span style="color:${cut.color || "#14161b"}">${cut.value}</span>`;
    rule(330);
    const foot = box(p, pad, 372, RW - 2 * pad, 30);
    foot.style.cssText += ";display:flex;justify-content:space-between;font:500 22px/1 var(--mono);color:#8a8f9b;letter-spacing:.12em";
    foot.innerHTML = `<span>${cut.note || ""}</span><span>${String(idx + 1).padStart(2, "0")}/${String(N_RECEIPTS()).padStart(2, "0")}</span>`;
    // a barcode, for the till
    const bars = box(p, pad, 422, RW - 2 * pad, 40);
    let x = 0, html = "";
    for (let k = 0; x < RW - 2 * pad - 6; k++) {
      const w = 2 + Math.floor(rnd(k * 7.7 + idx) * 4);
      if (rnd(k * 3.1 + idx * 5) > 0.35) html += `<i style="position:absolute;left:${x}px;top:0;width:${w}px;height:40px;background:#2b2e36"></i>`;
      x += w + 2;
    }
    bars.innerHTML = html;
    RECEIPTS.push({ wrap, start: cut.start, idx });
  }
  /* rise from below, slow through the middle (readable), off the top */
  function receiptY(t, s0) {
    const a = s0 - CUT_IN, b = s0 + CUT_OUT;
    if (t < a || t > b) return null;
    const u = (t - a) / (b - a);
    // a position curve with a gentle plateau at the middle
    const k = u < 0.5 ? 0.5 * outCubic(u / 0.5) : 0.5 + 0.5 * inCubic((u - 0.5) / 0.5);
    const yMid = 540 - RH / 2;
    const y = u < 0.5 ? lerp(1100, yMid, k / 0.5) : lerp(yMid, -RH - 60, (k - 0.5) / 0.5);
    return { y, u };
  }
  function paintReceipts(t) {
    for (const r of RECEIPTS) {
      const q = receiptY(t, r.start);
      if (!q) { r.wrap.style.visibility = "hidden"; continue; }
      r.wrap.style.visibility = "visible";
      const rot = lerp(-2.4, 1.6, q.u) * (r.idx % 2 ? -1 : 1);
      r.wrap.style.transform = `translate3d(0, ${q.y.toFixed(1)}px, 0) rotate(${rot.toFixed(3)}deg)`;
    }
  }

  // ---- the ledger: the film's own category bar ------------------------------------
  const KCOL = ["#EB3745", "#FA872A", "#F0C800", "#8DB600", "#009238", "#00B09F", "#1CBDEB", "#0074C2", "#3443D6", "#9058E7", "#D957C4", "#FF85A8"];
  let LEDGER = [];
  function buildLedger() {
    const root = document.getElementById("ledger");
    const scenes = TL.scenes, end = TL.d.video_end;
    LEDGER = scenes.map((s, i) => {
      const seg = el("i", "", root);
      seg.style.background = KCOL[i % KCOL.length];
      return { seg, s, frac: (s.end - s.start) / end };
    });
  }
  function paintLedger(t) {
    const end = TL.d.video_end;
    const hideP = ramp(t, end - 2.6, end - 2.0);             // the end card takes the bar over
    document.getElementById("ledger").style.opacity = (1 - hideP).toFixed(3);
    LEDGER.forEach(({ seg, s, frac }) => {
      const p = clamp((t - s.start) / (s.end - s.start));
      seg.style.width = (frac * p * 100).toFixed(4) + "%";
    });
  }

  // ---- build + render -----------------------------------------------------------
  let built = null;
  const CUTS = {
    add: { title: "Add", item: "Apple", value: "18.50", note: "1 ITEM" },
    summary: { title: "Summary", item: "October", value: "2,658.00", note: "SPENT" },
    search: { title: "Search", item: "#holiday", value: "9", note: "FOUND" },
    recurring: { title: "Recurring", item: "Spotify", value: "+1.00", color: "#d13b40", note: "PRICE UP" },
    household: { title: "Household", item: "Alex · Ana", value: "2", note: "PEOPLE" },
    phone: { title: "On your phone", item: "Languages", value: "13", note: "INSTALLED" },
    private: { title: "Private", item: "Amounts", value: "••••••", note: "ENCRYPTED" },
    selfhost: { title: "Yours to host", item: "Price", value: "0.00", color: "#14804a", note: "MIT" },
    outro: null,   // no receipt into the end card: the self-host scene crosses straight into it
  };
  const N_RECEIPTS = () => TL.scenes.slice(1).filter((s) => CUTS[s.name] !== null).length;

  function build() {
    const root = document.getElementById("scenes");
    built = [];
    TL.scenes.forEach((scene, idx) => {
      const layer = el("div", "layer", root);
      layer.style.zIndex = 10 + idx;
      const cam = el("div", "cam", layer);
      const render = SCENES[scene.name](cam, api(scene, layer, cam));
      built.push({ scene, layer, render });
      if (idx > 0 && CUTS[scene.name] !== null) {
        const cut = CUTS[scene.name] || { title: scene.name, item: scene.name, value: "" };
        buildReceipt(Object.assign({ start: scene.start }, cut), idx - 1);
        CUES.push({ t: +(scene.start - CUT_IN).toFixed(3), type: "print", gain: 1 });
        CUES.push({ t: +(scene.start + 0.06).toFixed(3), type: "tear", gain: 1 });
        PULSES.push([scene.start, 1, 960, 540]);
      }
    });
    buildLedger();
    CUES.sort((a, b) => a.t - b.t);
  }

  function render(t) {
    PENDING.length = 0;
    paintBackground(t);
    for (let i = 0; i < built.length; i++) {
      const { scene: s, layer, render: r } = built[i];
      const first = i === 0, last = i === built.length - 1;
      // the scenes cross behind the receipt: out with a little sink, in with a little rise
      const from = first ? -1 : s.start - 0.22, to = last ? 1e9 : s.end + 0.22;
      if (t < from || t >= to) { layer.style.display = "none"; continue; }
      layer.style.display = "";
      const inP = first ? 1 : outCubic(ramp(t, s.start - 0.22, s.start + 0.34));
      const outP = last ? 0 : inCubic(ramp(t, s.end - 0.34, s.end + 0.22));
      layer.style.opacity = (inP * (1 - outP)).toFixed(4);
      const sc = lerp(1.035, 1, inP) * lerp(1, 0.965, outP);
      const dy = (1 - inP) * 26 - outP * 26;
      layer.style.transform = `translate3d(0, ${dy.toFixed(2)}px, 0) scale(${sc.toFixed(5)})`;
      layer.style.filter = (1 - inP) + outP > 0.02 ? `blur(${(((1 - inP) + outP) * 6).toFixed(2)}px)` : "none";
      r(t - s.start, t);
    }
    paintReceipts(t);
    paintLedger(t);
    // fade in from the canvas, and back to it at the very end
    const end = TL.d.video_end;
    const f = 1 - ramp(t, 0.0, 0.5) + ramp(t, end - 0.55, end - 0.05);
    document.getElementById("fade").style.opacity = clamp(f).toFixed(4);
    return PENDING.length ? Promise.all(PENDING).then(() => true) : true;
  }

  // ---- capture API --------------------------------------------------------------
  window.__init = async function (data) {
    const byId = {};
    data.segments.forEach((s) => (byId[s.id] = s));
    TL = { d: data, byId, scenes: data.scenes };
    DATA = { shots: await (await fetch("/app/shots.json")).json() };
    DPR = window.devicePixelRatio || 1;
    const cv = document.getElementById("dots");
    cv.width = 1920 * DPR; cv.height = 1080 * DPR;
    dctx = cv.getContext("2d");
    build();
    window.__ready = Promise.all([
      document.fonts.load('700 92px "Geist"'),
      document.fonts.load('500 32px "Geist"'),
      document.fonts.load('600 46px "Geist Mono"'),
      document.fonts.load('500 22px "Geist Mono"'),
      ...WAIT,
    ]).then(() => document.fonts.ready).then(() => true);
  };
  window.__render = render;
  window.__cues = () => CUES;
  window.__duration = () => (TL ? TL.d.video_end : 0);
  window.__poster = function (x = 960, y = 540, d = 170) {
    const b = el("div", "", document.getElementById("stage"));
    b.id = "poster-play";
    b.style.setProperty("--d", d + "px");
    b.style.setProperty("--x", x + "px");
    b.style.setProperty("--y", y + "px");
  };
})();

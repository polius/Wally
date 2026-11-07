/* Wally film — the scenes.
 *
 * Every scene is a function (cam, api) -> render(t) where t is seconds since the
 * scene's start. `cam` is the scene's camera: transform it to push, pan or
 * drift the whole shot. Moments come from the narration via api.on(line,
 * anchor) / api.segStart(line), so a frame is a pure function of t and the
 * visuals track the voice. Sound effects are registered up front with
 * api.cue(type, t) and mixed by sfx.py.
 *
 * What's on the screens is the real app in its light theme, filmed from the
 * demo household by capture_app.py: the Summary, Month in review, searches as
 * they're typed, Recurring, the person switcher, and the phone's Add sheet
 * key by key.
 */
(function () {
  const A = window.Toolkit;
  const { clamp, lerp, ramp, rnd, outQuint, outCubic, outExpo, inCubic, inOutCubic, inOutSine, outBack, spring,
          reveal, show, el, svg, at, box, setText, setHTML, icon, words, kin, image, setSrc, preload, odometer } = A;

  const ACCENT = "#4f5bd5", GOOD = "#14804a", BAD = "#d13b40", INK = "#14161b", INK2 = "#5b606c", INK3 = "#8a8f9b";
  const KCOL = ["#EB3745", "#FA872A", "#F0C800", "#8DB600", "#009238", "#00B09F", "#1CBDEB", "#0074C2", "#3443D6", "#9058E7", "#D957C4", "#FF85A8"];
  const NB = " ";

  /* ------------------------------------------------------------------ *
   *  the logo: Wally's wallet, built from its own SVG (web/icons/wally.svg)
   * ------------------------------------------------------------------ */
  const STRAP = "M704.5,515.5 H848.5 Q870.5,515.5 870.5,537.5 V661.5 Q870.5,683.5 848.5,683.5 H704.5 A84,84 0 0 1 704.5,515.5 Z";
  let WALLETS = 0;
  function wallet(parent, size) {
    const s = svg("svg", { viewBox: "108 98 816 816", width: size, height: size, style: "overflow:visible;display:block" }, parent);
    const u = "w" + (++WALLETS);   // ids are per wallet: two wallets in one page must not share a clip path
    s.innerHTML = `
      <defs>
        <linearGradient id="${u}back" x1="175" y1="0" x2="838" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#B57745"/><stop offset="1" stop-color="#9E6A3E"/></linearGradient>
        <clipPath id="${u}inside"><path d="M190,391 H762 A60,60 0 0 1 822,451 V782 A67,67 0 0 1 755,849 H257 A67,67 0 0 1 190,782 Z"/></clipPath>
        <clipPath id="${u}strapc"><path d="${STRAP}"/></clipPath>
      </defs>
      <g class="back"><rect x="175" y="325" width="663" height="520" rx="52" fill="url(#${u}back)" stroke="#3F342C" stroke-width="26"/></g>
      <g class="n1"><polygon points="246.3,294.0 592.9,166.4 693.6,440.0 300.0,440.0" fill="#3F342C" stroke="#3F342C" stroke-width="76" stroke-linejoin="round"/>
        <polygon points="246.3,294.0 592.9,166.4 693.6,440.0 300.0,440.0" fill="#81AF85" stroke="#81AF85" stroke-width="20" stroke-linejoin="round"/></g>
      <g class="n2"><polygon points="345.1,304.6 703.4,234.2 735.1,440.0 361.4,440.0" fill="#3F342C" stroke="#3F342C" stroke-width="76" stroke-linejoin="round"/>
        <polygon points="345.1,304.6 703.4,234.2 735.1,440.0 361.4,440.0" fill="#81AF85" stroke="#81AF85" stroke-width="20" stroke-linejoin="round"/>
        <path d="M403,420 L403,361 L421,323 Q426,314 436,312 L612,283 Q628,280 638,289 L656,306 Q662,312 671,313 Q680,315 682,324 L700,420 Z" fill="#679B75"/></g>
      <g class="pocket">
        <path d="M177,378.5 H762 A73,73 0 0 1 835,451.5 V795 A67,67 0 0 1 768,862 H244 A67,67 0 0 1 177,795 Z" fill="#E1A365" stroke="#3F342C" stroke-width="26" stroke-linejoin="round"/>
        <g clip-path="url(#${u}inside)">
          <path d="M150,810 H770 C800,810 816,800 822,770 V880 H150 Z" fill="#CA8A51"/>
          <path d="M150,422 H770 Q792,422 792,444 V780 Q792,812 760,812 H150 Z" fill="#D99857"/>
          <path class="shadow" d="${STRAP}" transform="translate(-8 16)" fill="#C4874F" stroke="#C4874F" stroke-width="25" stroke-linejoin="round"/>
        </g>
      </g>
      <g class="strap">
        <path d="${STRAP}" fill="#D99857"/>
        <rect x="829" y="500" width="60" height="200" fill="#C98A52" clip-path="url(#${u}strapc)"/>
        <path d="${STRAP}" fill="none" stroke="#3F342C" stroke-width="25" stroke-linejoin="round"/>
        <circle class="snap" cx="705.5" cy="600.5" r="30.5" fill="#A36E42" stroke="#3F342C" stroke-width="20"/>
      </g>`;
    const g = (c) => s.querySelector("." + c);
    const parts = { back: g("back"), n1: g("n1"), n2: g("n2"), pocket: g("pocket"), strap: g("strap"), snap: g("snap"), shadow: g("shadow") };
    const tf = (node, x, y, r = 0, sc = 1, ox = 516, oy = 506, op = 1) => {
      node.setAttribute("transform", `translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${r.toFixed(3)} ${ox} ${oy}) translate(${ox} ${oy}) scale(${sc.toFixed(4)}) translate(${-ox} ${-oy})`);
      node.setAttribute("opacity", clamp(op).toFixed(3));
    };
    return {
      node: s,
      /* t0: when it starts; returns the moment the strap snaps shut */
      set(t, t0, speed = 1) {
        const T = (x) => t0 + x / speed;
        const pb = outBack(ramp(t, T(0.0), T(0.45)), 1.2);
        tf(parts.back, 0, (1 - pb) * 120, 0, lerp(0.86, 1, pb), 506, 845, ramp(t, T(0), T(0.18)));
        const p1 = outBack(ramp(t, T(0.35), T(0.85)), 1.1), p2 = outBack(ramp(t, T(0.55), T(1.05)), 1.1);
        tf(parts.n1, 0, (1 - p1) * -520, (1 - p1) * -16, 1, 470, 300, ramp(t, T(0.35), T(0.45)));
        tf(parts.n2, 0, (1 - p2) * -560, (1 - p2) * 14, 1, 540, 330, ramp(t, T(0.55), T(0.65)));
        const pp = outBack(ramp(t, T(0.95), T(1.4)), 1.3);
        tf(parts.pocket, 0, (1 - pp) * 170, 0, lerp(0.92, 1, pp), 506, 862, ramp(t, T(0.95), T(1.08)));
        // the strap swings over from the right and snaps onto the pocket
        const ps = ramp(t, T(1.35), T(1.8));
        const sw = outBack(ps, 1.6);
        tf(parts.strap, (1 - sw) * 220, (1 - sw) * -60, (1 - sw) * 38, 1, 870, 600, ramp(t, T(1.35), T(1.45)));
        parts.shadow.setAttribute("opacity", ramp(t, T(1.7), T(1.85)).toFixed(3));
        const snap = T(1.8);
        const bump = Math.exp(-Math.max(0, t - snap) * 14) * (t >= snap ? 1 : 0);
        parts.snap.setAttribute("r", (30.5 * (1 + 0.35 * bump)).toFixed(2));
        return snap;
      },
      snapAt: (t0, speed = 1) => t0 + 1.8 / speed,
    };
  }

  /* "Wally", the wordmark: letters rise out of a mask */
  function wordmark(parent, size) {
    const n = el("div", "word", parent);
    n.style.fontSize = size + "px";
    const letters = "Wally".split("").map((c) => el("span", "", el("span", "kt", n), c));
    return { node: n, letters };
  }

  /* ------------------------------------------------------------------ *
   *  devices
   * ------------------------------------------------------------------ */
  function browser(parent, x, y, viewW, title = "Wally") {
    const viewH = Math.round(viewW * 900 / 1440);
    const n = el("div", "browser", parent);
    Object.assign(n.style, { left: x - viewW / 2 + "px", top: y - (viewH + 46) / 2 + "px", width: viewW + "px", height: viewH + 46 + "px" });
    const chrome = el("div", "chrome", n);
    el("div", "lights", chrome, "<i></i><i></i><i></i>");
    const tab = el("div", "tab", chrome, `<img src="/icons/favicon-32.png" alt=""><span></span>`);
    setText(tab.querySelector("span"), title);
    const view = el("div", "view", n);
    const k = viewW / 1440;
    // the page: scrolls inside the view; overlays go in page coordinates (CSS px of the app)
    const page = el("div", "abs", view);
    Object.assign(page.style, { left: 0, top: 0, width: "1440px", transformOrigin: "0 0" });
    return {
      node: n, view, page, k, viewW, viewH, tab: tab.querySelector("span"),
      scroll(y) { page.style.transform = `scale(${k}) translate(0, ${(-y).toFixed(2)}px)`; },
      shot(url) { const img = image(page, url, "shot"); img.style.width = "1440px"; return img; },
      /* the app's sidebar is sticky: it stays put while the page scrolls under it */
      pin(url, w = 212, h = 900) {
        const s = el("div", "abs", view);
        Object.assign(s.style, { left: 0, top: 0, width: w * k + "px", height: h * k + "px", zIndex: 3,
                                 backgroundImage: `url(${url})`, backgroundSize: `${1440 * k}px auto`, backgroundPosition: "0 0" });
        return s;
      },
    };
  }

  function phone(parent) {
    const wrap = el("div", "abs", parent);
    const n = el("div", "phone", wrap);
    Object.assign(n.style, { width: "418px", height: "872px", left: "-209px", top: "-436px" });
    const screen = el("div", "screen", n);
    el("div", "island", n);
    for (const [side, top, h] of [["left", 190, 60], ["left", 270, 92], ["left", 378, 92], ["right", 292, 132]]) {
      const b = el("div", "btn", n);
      Object.assign(b.style, { [side]: "-4px", top: top + "px", height: h + "px" });
    }
    return { wrap, node: n, screen };
  }

  /* position by left/top, so reveal() keeps the transform */
  function pos(node, x, y) { node.style.left = x.toFixed(2) + "px"; node.style.top = y.toFixed(2) + "px"; }
  function place(node, x, y, s = 1, r = 0) {
    node.style.transform = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) rotate(${r.toFixed(3)}deg) scale(${s.toFixed(5)})`;
  }

  function camera(cam, t, keys, drift = 1) {
    let s = keys[0][1], x = keys[0][2], y = keys[0][3];
    for (let i = 1; i < keys.length; i++) {
      const [t1, s1, x1, y1, d = 0.9] = keys[i];
      const p = inOutCubic(ramp(t, t1, t1 + d));
      s = lerp(s, s1, p); x = lerp(x, x1, p); y = lerp(y, y1, p);
    }
    x += drift * 4 * Math.sin(t * 0.45); y += drift * 3 * Math.cos(t * 0.37);
    cam.style.transform = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) scale(${s.toFixed(5)})`;
  }

  function headline(parent, x, y, text, cls = "headline") {
    const n = at(parent, x, y, cls);
    return { node: n, w: words(n, text) };
  }

  /* a soft ring that draws attention to a box (page coords), then lets go */
  function ring(parent, [x, y, w, h], pad = 8, radius = 14) {
    const r = el("div", "ring", parent);
    Object.assign(r.style, { left: x - pad + "px", top: y - pad + "px", width: w + 2 * pad + "px", height: h + 2 * pad + "px", borderRadius: radius + "px" });
    return {
      node: r,
      set(t, t0, t1) {
        const p = outCubic(ramp(t, t0, t0 + 0.35)), q = ramp(t, t1, t1 + 0.3);
        r.style.opacity = (p * (1 - q)).toFixed(3);
        r.style.transform = `scale(${lerp(1.08, 1, p).toFixed(4)})`;
        r.style.boxShadow = `0 0 0 ${(10 * (1 - p) + 6).toFixed(1)}px rgba(79,91,213,${(0.14 * p).toFixed(3)})`;
      },
    };
  }
  /* a tap: a dot that lands and ripples */
  function tap(parent, x, y) {
    const n = el("div", "tap", parent);
    Object.assign(n.style, { left: x + "px", top: y + "px" });
    return {
      set(t, t0) {
        const p = ramp(t, t0 - 0.12, t0), q = ramp(t, t0, t0 + 0.5);
        if (t < t0 - 0.12 || q >= 1) { n.style.visibility = "hidden"; return; }
        n.style.visibility = "visible";
        n.style.opacity = (p * (1 - q)).toFixed(3);
        n.style.transform = `scale(${(t < t0 ? lerp(1.4, 0.8, p) : lerp(0.8, 2.2, q)).toFixed(3)})`;
      },
    };
  }
  function typeCues(api, t0, n, rate, type = "key", gain = 0.55) {
    for (let i = 0; i < n; i++) api.cue(type, t0 + i * rate + (rnd(i * 3.1 + t0) - 0.5) * rate * 0.25, gain);
  }
  const money = (s) => String(s || "").replace(/\s/g, NB);

  /* ------------------------------------------------------------------ *
   *  1. open — the wallet puts itself together; "This is Wally."
   * ------------------------------------------------------------------ */
  SCENES.open = (cam, api) => {
    const nameAt = api.on("open1", "name");
    const o2 = api.segStart("open2"), hhAt = api.on("open2", "household");
    const inAt = api.on("open2", "in"), wentAt = api.on("open2", "went"), comingAt = api.on("open2", "coming");
    const W0 = 0.35;
    const group = el("div", "abs", cam);
    const logoBox = el("div", "abs", group);
    const logo = wallet(logoBox, 320);
    const HIT = logo.snapAt(W0);
    const wordBox = el("div", "abs", group);
    const wm = wordmark(wordBox, 220);
    // the household: a chip under the lockup, its two people popping in one after the other
    const ppl = at(group, 984, 742, "");
    ppl.style.cssText += ";display:flex;align-items:center;gap:20px;padding:14px 34px 14px 14px;border-radius:999px;background:#fff;box-shadow:0 0 0 1px rgba(20,22,40,.06),var(--shadow);white-space:nowrap";
    const avs = el("span", "", ppl);
    avs.style.cssText = "display:flex;align-items:center";
    const avA = el("span", "av alex", avs, "A"), avB = el("span", "av ana", avs, "A");
    for (const a of [avA, avB]) Object.assign(a.style, { width: "68px", height: "68px", fontSize: "30px", boxShadow: "0 0 0 5px #fff" });
    avB.style.marginLeft = "-14px";
    const pplLbl = el("span", "", ppl, "Alex <span style=\"color:#8a8f9b;font-weight:500\">&amp;</span> Ana");
    pplLbl.style.cssText = "font:600 36px/1 var(--ui);color:#14161b;letter-spacing:-.02em";

    // the three things Wally keeps: came in, went out, coming up
    const sum = api.data.shots.summary || {}, txt = sum.text || {};
    const bar = (txt.bar || []).slice(0, 8);
    const cardsAt = [inAt, wentAt, comingAt];
    const cards = [
      { label: "Came in", value: "+5,230", color: GOOD, note: "Two salaries · October" },
      { label: "Where it went", value: money(txt.big || "2,658 €").replace(/\s?€/, ""), color: INK, note: "", bar: true },
      { label: "Coming up", value: "1,250", color: INK, note: "Rent · Dec 1" },
    ].map((c, i) => {
      const n = box(cam, 960 + (i - 1) * 520 - 235, 690, 470, 236, "card");
      const lbl = el("div", "abs", n, c.label);
      lbl.style.cssText += ";left:34px;top:32px;font:500 26px/1 var(--ui);color:#5b606c;letter-spacing:-.01em";
      const v = el("div", "abs", n);
      v.style.cssText += `;left:32px;top:78px;font:700 70px/1 var(--ui);letter-spacing:-.045em;color:${c.color}`;
      const odo = odometer(v, c.value);
      const cur = el("span", "", v, NB + "€");
      cur.style.cssText = "font-size:.6em;letter-spacing:-.02em;margin-left:4px";
      const note = el("div", "abs", n, c.note);
      note.style.cssText += ";left:34px;top:172px;font:500 24px/1 var(--ui);color:#8a8f9b";
      const segs = [];
      if (c.bar) {
        const b = box(n, 34, 176, 402, 12);
        b.style.cssText += ";display:flex;gap:3px;border-radius:6px;overflow:hidden;background:rgba(20,22,27,.055)";
        const tot = bar.reduce((s, x) => s + x.flex, 0) || 1;
        bar.forEach((x) => { const sg = el("i", "", b); sg.style.cssText = `display:block;height:100%;flex:0 0 ${(x.flex / tot * 100).toFixed(3)}%;background:${x.color}`; segs.push(sg); });
      }
      if (i === 2) {
        const ic = el("div", "abs", n, icon("calendar-days", 34, 2.2));
        ic.style.cssText += ";right:34px;top:28px;color:#4f5bd5";
      }
      if (i === 0) {
        const ic = el("div", "abs", n, icon("arrow-down", 34, 2.4));
        ic.style.cssText += ";right:34px;top:28px;color:#14804a";
      }
      api.cue("pop", cardsAt[i] - 0.05, 0.8);
      api.cue("tick", cardsAt[i] + 0.12, 0.7);
      return { n, odo, segs, at: cardsAt[i] };
    });

    api.cue("thump", W0 + 0.05, 0.8);
    api.cue("rustle", W0 + 0.38, 0.9);
    api.cue("rustle", W0 + 0.6, 0.7);
    api.cue("thump", W0 + 1.0, 0.9);
    api.cue("swish", W0 + 1.36, 0.6);
    api.cue("snap", HIT, 1);
    api.cue("hit", HIT, 1);
    api.pulse(HIT, 1.2, 960, 520);
    api.cue("pop", hhAt - 0.05, 0.6);
    api.cue("pop", hhAt + 0.1, 0.45);

    return (t) => {
      logo.set(t, W0);
      // after the snap the wallet steps left and the name comes in beside it
      const go = inOutCubic(ramp(t, HIT + 0.05, HIT + 0.75));
      const up = inOutCubic(ramp(t, o2 - 0.25, o2 + 0.6));
      const lx = lerp(960, 670, go), ly = lerp(530, 500, go);
      place(logoBox, lx - 160, ly - 160, 1);
      place(wordBox, lx + 190, ly - 110, 1);
      wordBox.style.opacity = ramp(t, HIT + 0.12, HIT + 0.3).toFixed(3);
      kin(wm.letters, t, HIT + 0.16, 0.045, 0.6);
      // "This is Wally": the name gives a little bounce on the word
      const b = Math.exp(-Math.max(0, t - nameAt) * 7) * Math.sin(Math.max(0, t - nameAt) * 18) * (t >= nameAt ? 1 : 0);
      wordBox.style.transform += ` scale(${(1 + 0.025 * b).toFixed(4)})`;
      // for the tagline the lockup lifts and makes room for the cards
      group.style.transform = `translate(0, ${(-170 * up).toFixed(2)}px) scale(${lerp(1, 0.82, up).toFixed(4)})`;
      group.style.transformOrigin = "960px 420px";
      reveal(ppl, ramp(t, hhAt - 0.12, hhAt + 0.45), { dy: 24, scale: 0.92, ease: (p) => outBack(p, 1.1) });
      [avA, avB].forEach((a, i) => { const q = outBack(ramp(t, hhAt + 0.02 + i * 0.12, hhAt + 0.4 + i * 0.12), 1.8); a.style.transform = `scale(${(0.4 + 0.6 * q).toFixed(4)})`; });
      reveal(pplLbl, ramp(t, hhAt + 0.15, hhAt + 0.6), { dy: 0, dx: -12 });
      cards.forEach((c, i) => {
        reveal(c.n, ramp(t, c.at - 0.12, c.at + 0.5), { dy: 60, scale: 0.94, ease: (p) => outBack(p, 1.3) });
        c.odo.set(ramp(t, c.at, c.at + 0.9));
        c.segs.forEach((s, k) => { s.style.transform = `scaleX(${outCubic(ramp(t, c.at + 0.15 + k * 0.06, c.at + 0.55 + k * 0.06)).toFixed(3)})`; s.style.transformOrigin = "0 50%"; });
      });
      camera(cam, t, [[0, 1, 0, 0]], 0.6);
    };
  };

  /* ------------------------------------------------------------------ *
   *  2. add — the phone's Add sheet, key by key; it remembers the rest;
   *     then the same receipt is split, shared and tagged, and saved
   * ------------------------------------------------------------------ */
  SCENES.add = (cam, api) => {
    const s1 = api.segStart("add1");
    const s2 = api.segStart("add2"), e2 = api.segEnd("add2");
    const splitAt = api.on("add2", "split"), shareAt = api.on("add2", "share"), tagAt = api.on("add2", "tag");
    const M = api.data.shots.m_add || {}, N = M.frames || [], BX = M.box || {};
    const frames = N.map((_, i) => `/app/m_add/${String(i).padStart(2, "0")}.png`);
    preload(frames);
    const ph = phone(cam);
    const img = image(ph.screen, frames[0]);
    // when each captured state shows: keys, Next, the name letter by letter; then the split,
    // shared, the tag letter by letter, and Save
    const kt = s1 + 0.15, TR = 0.06;
    const NL = N.filter((l) => l.startsWith("name ")).length; // letters in the shop's name
    const tagT = tagAt - 0.05;
    const savedAt = e2 + 0.2;
    const when = N.map((lbl, i) => {
      if (i === 0) return 0;
      if (lbl.startsWith("key")) return kt + (i - 1) * 0.13;
      if (lbl === "next") return kt + 0.8;
      if (lbl.startsWith("name")) return kt + 1.0 + (lbl.length - 6) * 0.075;
      if (lbl === "named") return kt + 1.0 + NL * 0.075 + 0.25;
      if (lbl === "split") return splitAt + 0.02;
      if (lbl === "shared") return shareAt + 0.02;
      if (lbl.startsWith("tag ")) return tagT + (lbl.length - 5) * TR;
      if (lbl === "tagged") return tagT + 7 * TR + 0.06;
      if (lbl === "saved") return savedAt;
      return 1e9;
    });
    typeCues(api, kt, 5, 0.13, "key", 0.7);
    api.cue("tap", kt + 0.8, 0.6);
    typeCues(api, kt + 1.0, NL, 0.075, "type", 0.5);
    const namedAt = when[N.indexOf("named")] || kt + 1.9;
    // the taps that cause each change, on the real rows
    const ctr = (b) => [b[0] + b[2] / 2, b[1] + b[3] / 2];
    const nb = BX.named || {}, sb = BX.split || {}, hb = BX.shared || {}, gb = BX.tagged || {};
    const taps = [
      [ctr(nb.cat || [16, 274, 358, 45]), splitAt - 0.12],
      [[322, (sb.who || [0, 503, 0, 52])[1] + 26], shareAt - 0.1],
      [[318, (hb.tags || [0, 727, 0, 44])[1] + 22], tagT - 0.12],
      [ctr(gb.go || [16, 792, 358, 52]), savedAt - 0.08],
    ].map(([[x, y], tt]) => { api.cue("tap", tt, 0.6); return { tp: tap(ph.screen, x, y), tt }; });
    typeCues(api, tagT, 7, TR, "type", 0.45);
    api.cue("pop", tagT + 7 * TR + 0.06, 0.5);
    api.cue("coin", savedAt + 0.02, 0.9);
    // what each change touched, ringed on the phone
    const rings = [
      [sb.parts || [16, 274, 358, 229], splitAt + 0.05, shareAt - 0.12],
      [[16, (hb.who || [0, 503])[1], 358, ((hb.note || [0, 651, 0, 18])[1] + 18) - (hb.who || [0, 503])[1]], shareAt + 0.05, tagT - 0.1],
      [gb.tags || [16, 727, 358, 48], tagT + 0.1, savedAt - 0.15],
    ].map(([bx, t0, t1]) => ({ r: ring(ph.screen, bx, 4, 14), t0, t1 }));
    // "It remembers": the category and the person came from last time, as the app filled them in
    const memoText = (m) => !m || !m.cat ? "Shopping and Ana" : !m.who ? m.cat : m.who === "Shared" ? `${m.cat}, shared` : `${m.cat} and ${m.who}`;
    const memo = el("div", "abs", cam);
    memo.innerHTML = `<div class="chip" style="font-size:26px;padding:16px 24px;gap:12px"><span style="color:#4f5bd5">${icon("sparkles", 28, 2.2)}</span><span>${memoText(M.memo)}, from last time</span></div>`;
    api.cue("pop", namedAt + 0.05, 0.6);

    const h1 = headline(cam, 1290, 470, "Add what you spend", "headline md");
    const h1b = headline(cam, 1290, 552, "in a few seconds.", "headline md");
    h1b.w.forEach((s, i) => { if (i >= 2) s.classList.add("acc"); });
    const h2 = headline(cam, 1290, 512, "Split, share, or tag it.", "headline md");
    // each verb lights up as the phone does it
    const lit = [[h2.w[0], splitAt], [h2.w[1], shareAt], [h2.w[3], tagAt]];
    const mix = (p) => `rgb(${Math.round(lerp(20, 79, p))},${Math.round(lerp(22, 91, p))},${Math.round(lerp(27, 213, p))})`;

    return (t) => {
      let k = 0;
      for (let i = 0; i < when.length; i++) if (t >= when[i]) k = i;
      setSrc(img, frames[k]);
      // the phone: rises in, settles left of centre; leans in a little for the details
      const pin = outQuint(ramp(t, 0, 0.7));
      const zp = inOutCubic(ramp(t, s2 - 0.3, s2 + 0.5)) * (1 - inOutCubic(ramp(t, savedAt - 0.1, savedAt + 0.5)));
      place(ph.wrap, 640 + 20 * zp, 560 + (1 - pin) * 60 - 6 * zp, 1 + 0.08 * zp, (1 - pin) * -3);
      taps.forEach((o) => o.tp.set(t, o.tt));
      rings.forEach((o) => o.r.set(t, o.t0, o.t1));
      const mp = ramp(t, namedAt, namedAt + 0.45), mq = ramp(t, s2 - 0.45, s2 - 0.15);
      pos(memo, 872, 352);
      reveal(memo, mp * (1 - mq), { dx: -24, dy: 0, scale: 0.96 });
      kin(h1.w, t, s1 - 0.1, 0.05, 0.55, s2 - 0.4);
      kin(h1b.w, t, s1 + 0.05, 0.05, 0.55, s2 - 0.35);
      kin(h2.w, t, s2 - 0.1, 0.05, 0.55);
      lit.forEach(([w, tt]) => (w.style.color = mix(ramp(t, tt - 0.05, tt + 0.2))));
      camera(cam, t, [[0, 1, 0, 0]], 0.7);
    };
  };

  /* ------------------------------------------------------------------ *
   *  3. summary — where it went, against last month; and the recap
   * ------------------------------------------------------------------ */
  SCENES.summary = (cam, api) => {
    const S = api.data.shots.summary, R = api.data.shots.review;
    const s1 = api.segStart("sum1"), wentAt = api.on("sum1", "went"), lastAt = api.on("sum1", "last");
    const s2 = api.segStart("sum2"), firstAt = api.on("sum2", "first"), recapAt = api.on("sum2", "recap");
    const B = S.box;
    const h1 = headline(cam, 960, 104, "Where it all went.", "headline md");
    h1.w[3].classList.add("acc");
    const h2 = headline(cam, 960, 104, "A recap on the 1st.", "headline md");
    h2.w[4].classList.add("acc");
    const br = browser(cam, 960, 600, 1300);
    const sum = br.shot("/app/summary.png");
    const rev = br.shot("/app/review.png");
    rev.style.top = "0px";
    br.pin("/app/summary.png");
    // the category bar draws itself: a white veil over it slides away
    const veil = el("div", "abs", br.page);
    Object.assign(veil.style, { left: B.bar[0] - 2 + "px", top: B.bar[1] - 3 + "px", width: B.bar[2] + 4 + "px", height: B.bar[3] + 6 + "px", background: "#fff" });
    // against last month: the change beside each category
    const cmp = [B.cats[0] + B.cats[2] - 150, B.cats[1] + 70, 136, B.cats[3] - 110];
    const rCmp = ring(br.page, cmp, 6, 14);
    const rBar = ring(br.page, B.bar, 12, 12);
    const rRecap = ring(br.page, B.recap, 4, 18);
    const tp = tap(br.page, B.recap[0] + B.recap[2] * 0.5, B.recap[1] + B.recap[3] * 0.5);
    api.cue("swish", wentAt - 0.1, 0.5);
    api.cue("draw", wentAt + 0.05, 0.8);
    api.cue("ding", lastAt + 0.05, 0.5);
    api.cue("tap", recapAt - 0.05, 0.7);
    api.cue("whoosh", recapAt + 0.12, 0.5);
    const revH = R.size[1];

    return (t) => {
      kin(h1.w, t, s1 - 0.25, 0.05, 0.55, s2 - 0.3);
      kin(h2.w, t, s2 - 0.05, 0.05, 0.55);
      const pin = outQuint(ramp(t, 0, 0.8));
      br.node.style.transform = `translateY(${((1 - pin) * 70).toFixed(2)}px)`;
      // scroll: the hero first, then down to the categories, back up to the recap
      const sc = lerp(0, 130, inOutCubic(ramp(t, wentAt - 0.35, wentAt + 0.5))) * (1 - inOutCubic(ramp(t, firstAt - 0.4, firstAt + 0.35)));
      const navP = outCubic(ramp(t, recapAt + 0.1, recapAt + 0.6));
      // Month in review slides up over the Summary, then reads down the page
      const revScroll = lerp(0, Math.min(520, revH - 900), inOutSine(ramp(t, recapAt + 0.8, api.dur + 0.2)));
      br.scroll(sc);
      sum.style.opacity = (1 - navP * 0.0).toFixed(3);
      rev.style.visibility = navP > 0 ? "visible" : "hidden";
      rev.style.transform = `translateY(${((1 - navP) * 900 + sc - revScroll).toFixed(2)}px)`;
      rev.style.boxShadow = "0 -20px 40px -20px rgba(20,22,40,.18)";
      // the veil's left edge sweeps right: the bar appears behind it, left to right
      const vp = outCubic(ramp(t, wentAt + 0.05, wentAt + 0.75));
      veil.style.left = (B.bar[0] - 2 + vp * (B.bar[2] + 4)).toFixed(2) + "px";
      veil.style.width = ((B.bar[2] + 4) * (1 - vp)).toFixed(2) + "px";
      veil.style.visibility = navP > 0.5 || vp >= 1 ? "hidden" : "visible";
      rBar.set(t, wentAt + 0.1, lastAt - 0.1);
      rCmp.set(t, lastAt, s2 - 0.1);
      rRecap.set(t, firstAt + 0.2, recapAt + 0.15);
      tp.set(t, recapAt);
      camera(cam, t, [[0, 1, 0, 0], [wentAt - 0.3, 1.05, -20, 12, 1.0], [firstAt - 0.3, 1.04, -50, 24, 0.9], [recapAt + 0.3, 1, 0, 0, 0.9]], 0.5);
    };
  };

  /* ------------------------------------------------------------------ *
   *  4. search — every month at once: a shop, a tag, a person, an amount
   * ------------------------------------------------------------------ */
  SCENES.search = (cam, api) => {
    const s = api.segStart("find1");
    const shopAt = api.on("find1", "shop"), tagAt = api.on("find1", "tag"), personAt = api.on("find1", "person"), amountAt = api.on("find1", "amount");
    const F = api.data.shots.search.frames;
    const frames = F.map((_, i) => `/app/search/${String(i).padStart(2, "0")}.png`);
    preload(frames);
    const h = headline(cam, 960, 96, "Search every month at once.", "headline md");
    h.w[1].classList.add("acc"); h.w[2].classList.add("acc");
    const toks = [["apple", shopAt], ["#holiday", tagAt], ["@ana", personAt], [">50", amountAt]].map(([q, tt], i) => {
      const n = at(cam, 960 + (i - 1.5) * 250, 196, "tok", q);
      return { n, tt, q };
    });
    const br = browser(cam, 960, 640, 1180);
    const img = br.shot(frames[0]);
    br.scroll(0);
    // which captured frame shows when: the shop is typed, the rest swap in on their word
    const typed = F.findIndex((f) => f.q === "apple");
    const tStart = shopAt - 0.06 * typed - 0.1;
    typeCues(api, tStart, typed, 0.06, "type", 0.5);
    api.cue("tick", tagAt, 0.6); api.cue("tick", personAt, 0.6); api.cue("tick", amountAt, 0.6);
    const qBox = api.data.shots.search.box.q;
    const rq = ring(br.page, qBox, 6, 22);

    return (t) => {
      kin(h.w, t, s - 0.3, 0.05, 0.55);
      let k = 0;
      if (t >= tStart) k = Math.min(typed, 1 + Math.floor((t - tStart) / 0.06));
      if (t >= tagAt) k = typed + 1;
      if (t >= personAt) k = typed + 2;
      if (t >= amountAt) k = typed + 3;
      setSrc(img, frames[Math.min(k, frames.length - 1)]);
      const pin = outQuint(ramp(t, 0, 0.8));
      br.node.style.transform = `translateY(${((1 - pin) * 70).toFixed(2)}px)`;
      const active = t >= amountAt ? 3 : t >= personAt ? 2 : t >= tagAt ? 1 : t >= shopAt - 0.2 ? 0 : -1;
      toks.forEach((o, i) => {
        reveal(o.n, ramp(t, s + 0.1 + i * 0.08, s + 0.6 + i * 0.08), { dy: 16 });
        o.n.classList.toggle("on", i === active);
      });
      rq.set(t, tStart - 0.1, api.dur);
      camera(cam, t, [[0, 1, 0, 0], [shopAt, 1.03, -20, -10, 1.6]], 0.5);
    };
  };

  /* ------------------------------------------------------------------ *
   *  5. recurring — they add themselves; a price rise stands out
   * ------------------------------------------------------------------ */
  SCENES.recurring = (cam, api) => {
    const s1 = api.segStart("rec1");
    const rentAt = api.on("rec1", "rent"), subsAt = api.on("rec1", "subs"), salAt = api.on("rec1", "salaries"), dayAt = api.on("rec1", "day");
    const s2 = api.segStart("rec2"), priceAt = api.on("rec2", "price"), seeAt = api.on("rec2", "see");
    const RB = api.data.shots.rec;
    const h1 = headline(cam, 960, 96, "They add themselves.", "headline md");
    h1.w[2].classList.add("acc");
    const h2 = headline(cam, 960, 96, "A price goes up? You'll see it.", "headline md");
    h2.w[2].classList.add("bad"); h2.w[3].classList.add("bad");
    const kinds = [["house", "Rent", rentAt], ["tv", "Subscriptions", subsAt], ["wallet", "Salaries", salAt]].map(([ic, lbl, tt], i) => {
      const n = at(cam, 960 + (i - 1) * 300, 196, "chip", `<span style="color:#4f5bd5;display:flex">${icon(ic, 30, 2.2)}</span>${lbl}`);
      api.cue("pop", tt - 0.04, 0.6);
      return { n, tt };
    });
    const br = browser(cam, 960, 640, 1180);
    const a = br.shot("/app/rec.png"), b = br.shot("/app/rec_spotify.png");
    br.scroll(0);
    // on their day: the app's own toast, as a rule adds itself
    const toast = el("div", "abs", cam);
    toast.innerHTML = `<div style="display:flex;align-items:center;gap:16px;padding:18px 26px;border-radius:18px;background:#1c1e24;color:#fff;font:500 26px/1 var(--ui);box-shadow:0 20px 50px -16px rgba(20,22,40,.45)"><span style="color:#9ea6ff;display:flex">${icon("repeat", 28, 2.2)}</span>Added Rent, 1,250.00 €<span style="color:#9ea6ff;margin-left:8px;font-weight:600">Dec 1</span></div>`;
    api.cue("coin", dayAt + 0.05, 0.7);
    const rRow = ring(br.page, RB.spotify, 4, 14);
    const rCard = ring(br.page, RB.box.pcard, 8, 14);
    api.cue("ding", priceAt + 0.05, 1);
    api.cue("tap", priceAt - 0.25, 0.6);

    return (t) => {
      kin(h1.w, t, s1 - 0.3, 0.05, 0.55, s2 - 0.35);
      kin(h2.w, t, s2 - 0.05, 0.05, 0.55);
      kinds.forEach((k, i) => reveal(k.n, ramp(t, k.tt - 0.1, k.tt + 0.4) * (1 - ramp(t, s2 - 0.4, s2 - 0.1)), { dy: 18, ease: (p) => outBack(p, 1.3) }));
      const pin = outQuint(ramp(t, 0, 0.8));
      br.node.style.transform = `translateY(${((1 - pin) * 70).toFixed(2)}px)`;
      const sw = t >= priceAt - 0.25;
      a.style.visibility = sw ? "hidden" : "visible";
      b.style.visibility = sw ? "visible" : "hidden";
      pos(toast, 1100, 930);
      reveal(toast, ramp(t, dayAt - 0.05, dayAt + 0.4) * (1 - ramp(t, s2 - 0.35, s2 - 0.05)), { dy: 40 });
      rRow.set(t, priceAt, api.dur);
      rCard.set(t, seeAt - 0.15, api.dur);
      camera(cam, t, [[0, 1, 0, 0], [priceAt - 0.3, 1.18, -10, 120, 0.9], [seeAt - 0.2, 1.18, -160, 140, 0.8]], 0.4);
    };
  };

  /* ------------------------------------------------------------------ *
   *  6. household — everyone's own view; shared costs, three ways
   * ------------------------------------------------------------------ */
  SCENES.household = (cam, api) => {
    const s1 = api.segStart("home1"), evAt = api.on("home1", "everyone"), ownAt = api.on("home1", "own");
    const s2 = api.segStart("home2");
    const evenAt = api.on("home2", "evenly"), incAt = api.on("home2", "income"), handAt = api.on("home2", "hand");
    const H = api.data.shots.home;
    const h1 = headline(cam, 960, 96, "Everyone gets their own view.", "headline md");
    h1.w[3].classList.add("acc"); h1.w[4].classList.add("acc");
    const h2 = headline(cam, 960, 96, "Shared costs, split your way.", "headline md");
    h2.w[3].classList.add("acc"); h2.w[4].classList.add("acc");
    const br = browser(cam, 960, 640, 1180);
    const imgs = ["all", "1", "2"].map((k) => { const i = br.shot(`/app/home_${k}.png`); return i; });
    br.scroll(0);
    // the app's person menu, opened from its button
    const sw = H.all.box.switch;
    const menu = el("div", "abs", br.page);
    Object.assign(menu.style, { left: sw[0] + sw[2] - 250 + "px", top: sw[1] + sw[3] + 10 + "px", width: "250px", padding: "8px", borderRadius: "16px", background: "#fff",
                                boxShadow: "0 0 0 1px rgba(20,22,40,.08), 0 20px 50px -12px rgba(20,22,40,.3)" });
    const rows = [["Everyone", ""], ["Alex", "alex"], ["Ana", "ana"]].map(([n, c]) => {
      const r = el("div", "", menu);
      r.style.cssText = "display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:10px;font:500 17px/1 -apple-system,var(--ui);color:#14161b";
      r.innerHTML = c ? `<span class="av ${c}" style="width:26px;height:26px;font-size:12px">A</span><span>${n}</span>`
        : `<span style="display:flex"><span class="av alex" style="width:26px;height:26px;font-size:12px;box-shadow:0 0 0 2px #fff">A</span><span class="av ana" style="width:26px;height:26px;font-size:12px;margin-left:-8px;box-shadow:0 0 0 2px #fff">A</span></span><span>${n}</span>`;
      return r;
    });
    const pick = [evAt + 0.1, ownAt - 0.15, ownAt + 0.75];
    pick.forEach((tt) => api.cue("tap", tt, 0.5));
    // a shared bill in the real Add sheet, split evenly, by income, by hand. The sheet opens over
    // Ana's Summary, as it does in the app, and comes up close enough to read.
    const SP = api.data.shots.split || {};
    const SB = (SP.even || {}).sheet || [490, 72, 460, 709];
    const SC = 1.12;
    const dim = el("div", "abs", br.view);
    Object.assign(dim.style, { inset: 0, background: "rgba(24,26,34,.30)", zIndex: 4 });
    const sheet = el("div", "abs", cam);
    Object.assign(sheet.style, { left: 960 - SB[2] * SC / 2 + "px", width: SB[2] * SC + "px", overflow: "hidden",
                                 borderRadius: 20 * SC + "px", background: "#fff",
                                 boxShadow: "0 0 0 1px rgba(20,22,40,.06), 0 50px 100px -30px rgba(20,22,40,.45)" });
    const inner = el("div", "abs", sheet);
    Object.assign(inner.style, { left: 0, top: 0, width: SB[2] + "px", transformOrigin: "0 0", transform: `scale(${SC})` });
    const sImgs = ["even", "income", "hand"].map((k) => {
      const im = image(inner, `/app/split_${k}.png`);
      Object.assign(im.style, { position: "absolute", width: "1440px", left: -SB[0] + "px", top: -SB[1] + "px", maxWidth: "none" });
      return im;
    });
    const H0 = SB[3], H2 = ((SP.hand || {}).sheet || SB)[3];
    // the Split row, the line under it, and the parts typed by hand (sheet coords)
    const rel = (bx) => [bx[0] - SB[0], bx[1] - SB[1], bx[2], bx[3]];
    const ev = SP.even || {}, hd = SP.hand || {};
    const smRow = ev.split ? [ev.split[0] - SB[0], ev.split[1] - SB[1], ev.split[2], 48] : [18, 294, 424, 48];
    const noteB = ev.note ? rel(ev.note) : [18, 399, 424, 18];
    const custB = hd.split ? [hd.split[0] - SB[0], hd.split[1] - SB[1] + 96, hd.split[2], hd.split[3] - 96] : [18, 390, 424, 96];
    // evenly: the line that says half each; by income: the Split row and its line; by hand: the parts
    const rNote = ring(inner, [noteB[0], noteB[1] - 8, noteB[2], noteB[3] + 16], 4, 10);
    const rSm = ring(inner, [smRow[0], smRow[1], smRow[2], noteB[1] + noteB[3] + 8 - smRow[1]], 4, 12);
    const rCust = ring(inner, custB, 4, 12);
    const sm = ev.sm ? [ev.sm[0] - SB[0] + ev.sm[2] - 30, ev.sm[1] - SB[1] + ev.sm[3] / 2] : [372, 318];
    const modeAt = [evenAt, incAt, handAt];
    const taps2 = [incAt - 0.12, handAt - 0.12].map((tt) => { api.cue("tap", tt, 0.55); return { tp: tap(inner, sm[0], sm[1]), tt }; });
    modeAt.forEach((tt) => api.cue("tick", tt, 0.7));
    typeCues(api, handAt + 0.05, 3, 0.07, "key", 0.5);
    const openT = s2 - 0.25;
    api.cue("swish", openT, 0.5);
    api.cue("pop", openT + 0.08, 0.6);

    return (t) => {
      kin(h1.w, t, s1 - 0.3, 0.05, 0.55, s2 - 0.35);
      kin(h2.w, t, s2 - 0.05, 0.05, 0.55);
      let who = 0;
      if (t >= pick[1]) who = 1;
      if (t >= pick[2]) who = 2;
      imgs.forEach((im, i) => (im.style.visibility = i === who ? "visible" : "hidden"));
      const open = t >= evAt - 0.05 && t < pick[2] + 0.35;
      reveal(menu, open ? outCubic(ramp(t, evAt - 0.05, evAt + 0.2)) : 0, { dy: -8, scale: 0.97 });
      rows.forEach((r, i) => (r.style.background = (i === who && open) ? "#e8eafb" : "transparent"));
      // the sheet opens: the page dims behind it and it rises up to the camera
      const pin = outQuint(ramp(t, 0, 0.8));
      const op = ramp(t, openT, openT + 0.5);
      const bk = inOutCubic(ramp(t, openT, openT + 0.6));
      br.node.style.transform = `translateY(${((1 - pin) * 70 + 40 * bk).toFixed(2)}px) scale(${lerp(1, 0.94, bk).toFixed(4)})`;
      br.node.style.transformOrigin = "50% 50%";
      dim.style.opacity = (0.95 * outCubic(op)).toFixed(3);
      let m = 0;
      if (t >= incAt) m = 1;
      if (t >= handAt) m = 2;
      // (a child set visible would show through its hidden parent, so the sheet's own state gates them)
      sImgs.forEach((im, i) => (im.style.visibility = i === m && op > 0 ? "visible" : "hidden"));
      const hp = outCubic(ramp(t, handAt, handAt + 0.35));
      const hgt = lerp(H0, H2, hp) * SC;
      sheet.style.height = hgt.toFixed(2) + "px";
      sheet.style.top = (600 - hgt / 2).toFixed(2) + "px";
      reveal(sheet, op, { dy: 120, scale: 0.92, ease: (p) => outBack(p, 1.05) });
      rNote.set(t, evenAt - 0.05, incAt - 0.15);
      rSm.set(t, incAt - 0.02, handAt - 0.15);
      rCust.set(t, handAt + 0.1, api.dur);
      taps2.forEach((o) => o.tp.set(t, o.tt));
      camera(cam, t, [[0, 1, 0, 0]], 0.5);
    };
  };

  /* ------------------------------------------------------------------ *
   *  7. phone — installs like an app; speaks thirteen languages
   * ------------------------------------------------------------------ */
  SCENES.phone = (cam, api) => {
    const s1 = api.segStart("phone1"), installAt = api.on("phone1", "installs");
    const s2 = api.segStart("phone2"), speaksAt = api.on("phone2", "speaks"), langAt = api.on("phone2", "languages");
    const MS = api.data.shots.m_summary, LANGS = api.data.shots.m_lang || ["en"];
    const NAMES = { en: "English", es: "Español", ca: "Català", fr: "Français", de: "Deutsch", it: "Italiano", pt: "Português",
                    ru: "Русский", zh: "中文", ja: "日本語", ko: "한국어", hi: "हिन्दी", ar: "العربية" };
    const langImgs = LANGS.filter((l) => l !== "en").map((l) => `/app/m_lang/${l}.png`);
    preload(langImgs);
    const h1 = headline(cam, 1360, 470, "It installs", "headline md");
    const h1b = headline(cam, 1360, 552, "like an app.", "headline md");
    h1b.w.forEach((s) => s.classList.add("acc"));
    const h2 = headline(cam, 1360, 330, "It speaks", "headline md");
    const h2b = headline(cam, 1360, 412, "13 languages.", "headline md");
    h2b.w.forEach((s) => s.classList.add("acc"));
    const ph = phone(cam);
    // the home screen: a wallpaper, the time, a page of apps and a dock; Wally's icon drops in
    const home = el("div", "abs", ph.screen);
    home.style.cssText += ";inset:0;background:radial-gradient(120% 70% at 20% 10%,#dfe4fb 0%,transparent 60%),radial-gradient(110% 80% at 90% 100%,#f6d9bd 0%,transparent 60%),linear-gradient(165deg,#e8ebf8 0%,#f4eee8 55%,#efdcc8 100%)";
    const sb = el("div", "abs", home);
    sb.style.cssText += ";left:40px;top:35px;font:600 17px/1 -apple-system,var(--ui);color:#14161b;letter-spacing:-.01em";
    sb.textContent = "9:41";
    const sbR = el("div", "abs", home);
    sbR.style.cssText += ";right:32px;top:33px;display:flex;gap:6px;align-items:center;color:#14161b";
    sbR.innerHTML = icon("signal", 17, 2.6) + icon("wifi", 17, 2.6) + icon("battery-full", 24, 2);
    const APPS = [
      ["Mail", "mail", "#5b8def", "#3d6fe0"], ["Calendar", "calendar", "#ffffff", "#f3f3f6", "#e5484d"], ["Photos", "image", "#f7b24a", "#ef8a3c"], ["Camera", "camera", "#9aa1ad", "#6f7682"],
      ["Maps", "map", "#7ccf8e", "#46b06a"], ["Weather", "cloud-sun", "#6db7f5", "#3f8ee8"], ["Clock", "clock", "#2a2d34", "#14161b"], ["Notes", "notebook-pen", "#ffd86b", "#f6bf2f"],
      ["Music", "headphones", "#ff6b81", "#ec3f5d"], ["", "", "", ""], ["Podcasts", "mic-vocal", "#b67cf2", "#8f4fe0"], ["Books", "book-open", "#ffa94d", "#f6862b"],
      ["Health", "heart", "#ffffff", "#f3f3f6", "#ec3f5d"], ["Files", "folder", "#6db7f5", "#3f8ee8"], ["News", "newspaper", "#ff7a7a", "#e5484d"], ["Settings", "settings", "#b8bdc7", "#8d939f"],
    ];
    const grid = [];
    APPS.forEach(([name, ic, c1, c2, fg], i) => {
      const r = Math.floor(i / 4), c = i % 4;
      const g = el("div", "abs", home);
      const isW = !name;
      Object.assign(g.style, { left: 30 + c * 88 + "px", top: 92 + r * 106 + "px", width: "66px", height: "66px", borderRadius: "16px",
                               background: isW ? "#fff" : `linear-gradient(180deg,${c1},${c2})`, color: fg || "#fff",
                               display: "flex", alignItems: "center", justifyContent: "center",
                               boxShadow: isW ? "0 6px 16px rgba(20,22,40,.18)" : "0 1px 2px rgba(20,22,40,.08)" });
      if (isW) { const im = el("img", "", g); im.src = "/icons/icon-192.png"; Object.assign(im.style, { width: "66px", height: "66px", borderRadius: "16px", display: "block" }); }
      else g.innerHTML = icon(ic, 34, 2);
      grid.push({ g, isW });
      const lbl = el("div", "abs", home, isW ? "Wally" : name);
      lbl.style.cssText += `;left:${30 + c * 88 - 6}px;top:${92 + r * 106 + 72}px;width:78px;text-align:center;font:500 12px/1 -apple-system,var(--ui);color:#3a3d45`;
      if (isW) grid[grid.length - 1].lbl = lbl;
    });
    const dock = el("div", "abs", home);
    dock.style.cssText += ";left:14px;right:14px;bottom:14px;height:96px;border-radius:36px;background:rgba(255,255,255,.42);box-shadow:inset 0 0 0 1px rgba(255,255,255,.5);display:flex;justify-content:space-around;align-items:center;padding:0 12px";
    dock.innerHTML = [["phone", "#7ccf8e", "#3fb562"], ["message-circle", "#7ccf8e", "#3fb562"], ["compass", "#6db7f5", "#3f8ee8"], ["headphones", "#ff6b81", "#ec3f5d"]]
      .map(([ic, a, b]) => `<span style="width:66px;height:66px;border-radius:16px;background:linear-gradient(180deg,${a},${b});color:#fff;display:flex;align-items:center;justify-content:center">${icon(ic, 34, 2)}</span>`).join("");
    const dots = el("div", "abs", home);
    dots.style.cssText += ";left:0;right:0;bottom:124px;display:flex;justify-content:center;gap:8px";
    dots.innerHTML = '<i style="width:7px;height:7px;border-radius:50%;background:#14161b;opacity:.55"></i><i style="width:7px;height:7px;border-radius:50%;background:#14161b;opacity:.2"></i>';
    const wIcon = grid.find((g) => g.isW);
    const app = el("div", "abs", ph.screen);
    app.style.cssText += ";inset:0;overflow:hidden;background:#f4f5f8;border-radius:52px";
    const sumImg = image(app, "/app/m_summary.png");
    const langImg = el("img", "", app);
    Object.assign(langImg.style, { position: "absolute", left: 0, top: 0, width: "390px", visibility: "hidden" });
    const tp = tap(ph.screen, 30 + 88 + 33, 92 + 2 * 106 + 33);
    const openAt = installAt + 0.75;
    api.cue("pop", installAt + 0.05, 0.8);
    api.cue("tap", openAt - 0.05, 0.6);
    api.cue("whoosh", openAt, 0.4);
    // languages: the phone switches through them, the names gather around it
    const cycleT = (i) => speaksAt + 0.05 + i * Math.max(0.16, (api.dur - (speaksAt + 0.05) - 0.9) / langImgs.length);
    const tags = LANGS.filter((l) => l !== "en").map((l, i) => {
      const n = at(cam, 1360 + ((i % 3) - 1) * 230, 560 + Math.floor(i / 3) * 96, "chip", NAMES[l] || l);
      n.style.fontSize = "28px"; n.style.padding = "16px 26px";
      api.cue("blip", cycleT(i), 0.35);
      return { n, tt: cycleT(i) };
    });
    const msH = MS.size[1];

    return (t) => {
      kin(h1.w, t, s1 - 0.2, 0.05, 0.55, s2 - 0.35);
      kin(h1b.w, t, s1 - 0.05, 0.05, 0.55, s2 - 0.3);
      kin(h2.w, t, s2 - 0.05, 0.05, 0.55);
      kin(h2b.w, t, s2 + 0.1, 0.05, 0.55);
      const pin = outQuint(ramp(t, 0, 0.8));
      // for the languages the phone comes up close: the top of its screen fills the frame, so every
      // word on it is the app's own, translated (the household's category names stay as they were typed)
      const zp = inOutCubic(ramp(t, s2 - 0.15, s2 + 0.75));
      place(ph.wrap, lerp(560, 590, zp), lerp(545 + (1 - pin) * 60, 1000, zp), lerp(1, 1.7, zp), (1 - pin) * 3);
      const ip = outBack(ramp(t, installAt - 0.05, installAt + 0.45), 1.8);
      wIcon.g.style.transform = `scale(${ip.toFixed(4)})`;
      wIcon.g.style.opacity = ramp(t, installAt - 0.05, installAt + 0.1).toFixed(3);
      wIcon.lbl.style.opacity = ramp(t, installAt + 0.1, installAt + 0.35).toFixed(3);
      tp.set(t, openAt);
      // the app opens from its icon
      const op = outCubic(ramp(t, openAt, openAt + 0.45));
      app.style.visibility = op > 0 ? "visible" : "hidden";
      app.style.transform = `translate(${lerp(-45, 0, op).toFixed(2)}px, ${lerp(-120, 0, op).toFixed(2)}px) scale(${lerp(0.17, 1, op).toFixed(4)})`;
      app.style.transformOrigin = `${30 + 88 + 33}px ${92 + 2 * 106 + 33}px`;
      app.style.opacity = ramp(t, openAt, openAt + 0.15).toFixed(3);
      const scr = lerp(0, Math.min(640, msH - 844), inOutSine(ramp(t, openAt + 0.5, s2 - 0.1)));
      sumImg.style.transform = `translateY(${(-scr * (1 - ramp(t, s2 - 0.1, s2 + 0.2))).toFixed(2)}px)`;
      let k = -1;
      tags.forEach((g, i) => { if (t >= g.tt) k = i; });
      if (k >= 0) { setSrc(langImg, langImgs[k]); langImg.style.visibility = "visible"; } else langImg.style.visibility = "hidden";
      tags.forEach((g, i) => {
        reveal(g.n, ramp(t, g.tt - 0.04, g.tt + 0.35), { dy: 0, scale: 0.7, ease: (p) => outBack(p, 1.6) });
        g.n.classList.toggle("on", i === k);
      });
      camera(cam, t, [[0, 1, 0, 0]], 0.5);
    };
  };

  /* ------------------------------------------------------------------ *
   *  8. private — end-to-end encrypted; the server sees noise
   * ------------------------------------------------------------------ */
  SCENES.private = (cam, api) => {
    const s1 = api.segStart("priv1"), pwAt = api.on("priv1", "password"), encAt = api.on("priv1", "encrypted");
    const s2 = api.segStart("priv2"), srvAt = api.on("priv2", "server"), readAt = api.on("priv2", "read");
    const h1 = headline(cam, 960, 96, "End-to-end encrypted.", "headline md");
    h1.w[1].classList.add("acc");
    const h2 = headline(cam, 960, 96, "Not even the server can read it.", "headline md");
    // a receipt of the household's month
    const LINES = [["Apple", "18.50"], ["Rent", "1,250.00"], ["Spotify", "10.99"], ["Forn Sant Jordi", "4.70"], ["IKEA", "63.35"], ["Netflix", "13.99"]];
    const RW = 560, RH = 640;
    const paperWrap = el("div", "abs", cam);
    const paper = el("div", "paper", paperWrap);
    const zig = (() => { const p = []; const n = Math.round(RW / 26); for (let i = 0; i <= n; i++) p.push(`${(i * RW / n).toFixed(1)}px ${i % 2 ? 13 : 0}px`); for (let i = n; i >= 0; i--) p.push(`${(i * RW / n).toFixed(1)}px ${RH - (i % 2 ? 13 : 0)}px`); return `polygon(${p.join(",")})`; })();
    Object.assign(paper.style, { left: 0, top: 0, width: RW + "px", height: RH + "px", clipPath: zig });
    const hd = box(paper, 48, 56, RW - 96, 30);
    hd.style.cssText += ";display:flex;justify-content:space-between;font:500 21px/1 var(--mono);color:#8a8f9b;letter-spacing:.14em";
    hd.innerHTML = "<span>WALLY</span><span>OCT 2026</span>";
    const rows = LINES.map(([n, v], i) => {
      const r = box(paper, 48, 130 + i * 62, RW - 96, 40);
      r.style.cssText += ";display:flex;justify-content:space-between;font:500 30px/1 var(--mono);color:#23252b";
      const a = el("span", "", r, n), b = el("span", "", r, v);
      return { a, b, n, v, i };
    });
    const tot = box(paper, 48, 130 + LINES.length * 62 + 22, RW - 96, 50);
    tot.style.cssText += ";display:flex;justify-content:space-between;font:700 36px/1 var(--mono);color:#14161b;border-top:3px dashed #c9ccd4;padding-top:22px";
    const totA = el("span", "", tot, "TOTAL"), totB = el("span", "", tot, "1,361.53");
    // the password, and the lock
    const pw = at(cam, 960, 930, "chip");
    pw.innerHTML = `<span style="color:#4f5bd5;display:flex">${icon("lock-keyhole", 30, 2.2)}</span><span class="mono" style="letter-spacing:.2em;font-size:32px">••••••••••</span>`;
    const lock = at(cam, 960, 540, "");
    lock.innerHTML = `<div class="ico" style="width:150px;height:150px;border-radius:44px;background:#4f5bd5;color:#fff;box-shadow:0 30px 60px -20px rgba(79,91,213,.6)">${icon("lock", 70, 2.2)}</div>`;
    // the server, and what it sees
    const srv = at(cam, 1400, 560, "");
    srv.innerHTML = `<div class="card" style="position:relative;width:400px;height:420px;display:flex;flex-direction:column;align-items:center;gap:26px;padding-top:54px">
        <span class="ico" style="width:110px;height:110px;border-radius:30px;background:#eceef3;color:#5b606c">${icon("server", 56, 2)}</span>
        <span style="font:600 30px/1 var(--ui)">Your server</span>
        <span class="srvsees mono" style="font:500 22px/1.55 var(--mono);color:#8a8f9b;text-align:center;white-space:pre"></span></div>`;
    const sees = srv.querySelector(".srvsees");
    const noise = (seed, n) => { const c = "0123456789abcdef"; let s = ""; for (let i = 0; i < n; i++) s += c[Math.floor(rnd(seed * 13.7 + i * 7.1) * 16)]; return s; };
    setText(sees, [0, 1, 2, 3].map((k) => noise(k + 9, 18)).join("\n"));
    const eyeOff = at(cam, 1400, 336, "");
    const trail = box(cam, 830, 556, 400, 4);
    trail.style.cssText += ";background-image:linear-gradient(90deg,#b9bdc6 50%,transparent 50%);background-size:16px 4px;opacity:0";
    const packet = el("div", "abs", cam);
    packet.innerHTML = `<div class="chip mono" style="margin:-32px 0 0 -60px;padding:12px 18px;font:500 22px/1 var(--mono);gap:10px"><span style="color:#4f5bd5;display:flex">${icon("lock", 22, 2.4)}</span>9f3a…c1</div>`;
    eyeOff.innerHTML = `<div class="ico" style="width:84px;height:84px;border-radius:50%;background:#fbe6e7;color:#d13b40;box-shadow:0 10px 24px -8px rgba(209,59,64,.4)">${icon("eye-off", 42, 2.2)}</div>`;
    api.cue("pop", pwAt - 0.05, 0.7);
    typeCues(api, pwAt + 0.05, 10, 0.045, "type", 0.4);
    api.cue("lock", encAt - 0.05, 1);
    api.cue("scramble", encAt + 0.05, 0.8);
    api.cue("whoosh", s2 - 0.1, 0.5);
    api.cue("thump", srvAt + 0.1, 0.6);
    api.cue("ding", readAt, 0.4);
    const GL = "▓▒░█▚▞▖▗▘▝#%&@$";
    const scr = (s, p, seed) => [...s].map((ch, i) => {
      if (ch === " ") return " ";
      const k = i / Math.max(1, s.length);
      if (p < k * 0.6) return ch;
      if (p > k * 0.6 + 0.35) return "•";
      return GL[Math.floor(rnd(seed + i * 3.3 + Math.floor(p * 18)) * GL.length)];
    }).join("");

    return (t) => {
      kin(h1.w, t, s1 - 0.3, 0.05, 0.55, s2 - 0.35);
      kin(h2.w, t, s2 - 0.05, 0.05, 0.55);
      // the receipt prints up from below, then goes to the server once sealed
      const pr = outCubic(ramp(t, 0, 0.9));
      const side = inOutCubic(ramp(t, s2 - 0.3, s2 + 0.45));
      const x = lerp(960 - RW / 2, 560 - RW / 2, side), y = lerp(250 + (1 - pr) * 700, 260, side);
      paperWrap.style.transform = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) rotate(${lerp(-1.5, -3, side).toFixed(3)}deg) scale(${lerp(1, 0.86, side).toFixed(4)})`;
      paperWrap.style.transformOrigin = `${RW / 2}px ${RH / 2}px`;
      // the packet: what leaves the browser is sealed
      const fp = inOutCubic(ramp(t, s2 + 0.2, srvAt + 0.1));
      packet.style.visibility = fp > 0 && fp < 1 ? "visible" : "hidden";
      packet.style.left = lerp(820, 1230, fp).toFixed(2) + "px";
      packet.style.top = (560 - Math.sin(fp * Math.PI) * 90).toFixed(2) + "px";
      trail.style.opacity = (ramp(t, s2 + 0.1, s2 + 0.4) * 0.9).toFixed(3);
      const sp = ramp(t, encAt, encAt + 0.8);
      rows.forEach((r) => { setText(r.a, scr(r.n, sp, r.i * 11 + 1)); setText(r.b, scr(r.v, sp, r.i * 11 + 5)); });
      setText(totA, scr("TOTAL", sp, 91)); setText(totB, scr("1,361.53", sp, 97));
      reveal(pw, ramp(t, pwAt - 0.1, pwAt + 0.35) * (1 - ramp(t, s2 - 0.4, s2 - 0.15)), { dy: 30 });
      const lp = ramp(t, encAt - 0.12, encAt + 0.25), lq = ramp(t, encAt + 0.75, encAt + 1.05);
      lock.style.visibility = lp > 0 && lq < 1 ? "visible" : "hidden";
      lock.style.opacity = (outCubic(lp) * (1 - lq)).toFixed(3);
      lock.style.transform = `scale(${(lerp(0.6, 1, outBack(lp, 1.8)) * lerp(1, 1.15, lq)).toFixed(4)})`;
      reveal(srv, ramp(t, s2 - 0.2, s2 + 0.35), { dx: 60, dy: 0 });
      reveal(eyeOff, ramp(t, readAt - 0.08, readAt + 0.35), { dy: 10, scale: 0.6, ease: (p) => outBack(p, 1.8) });
      camera(cam, t, [[0, 1, 0, 0]], 0.5);
    };
  };

  /* ------------------------------------------------------------------ *
   *  9. selfhost — free, open source, yours; one Docker command
   * ------------------------------------------------------------------ */
  SCENES.selfhost = (cam, api) => {
    const s1 = api.segStart("self1"), freeAt = api.on("self1", "free"), openAt = api.on("self1", "open"), hostAt = api.on("self1", "host");
    const s2 = api.segStart("self2"), dockAt = api.on("self2", "docker"), runAt = api.on("self2", "running");
    const head = at(cam, 960, 250, "headline");
    // each word makes room for itself, so the line stays centred as it grows
    const parts = [["Free.", "good", freeAt], ["Open source.", "", openAt], ["Yours.", "acc", hostAt]].map(([s, c, tt], i, all) => {
      const k = el("span", "kt", head);
      k.style.boxSizing = "border-box"; k.style.whiteSpace = "nowrap";
      const w = el("span", c, k, s);
      api.cue("stamp", tt, 0.7);
      return { k, w, tt, last: i === all.length - 1 };
    });
    let widths = null;
    const mit = at(cam, 960, 380, "chip");
    mit.innerHTML = `<span style="color:#5b606c;display:flex">${icon("shield-check", 30, 2.2)}</span><span>MIT License</span><span style="color:#8a8f9b;font-weight:500">github.com/polius/Wally</span>`;
    const term = el("div", "term", cam);
    Object.assign(term.style, { left: "365px", top: "520px", width: "1190px", height: "300px", fontSize: "28px" });
    term.innerHTML = `<div class="bar"><div class="lights"><i></i><i></i><i></i></div><span>you@server — zsh</span></div><div class="body"></div>`;
    const body = term.querySelector(".body");
    const CMD = "docker run -d -p 80:80 -v ./data:/wally/data poliuscorp/wally";
    const ID = "4f2a91c7e0b3d85a6c1e7f09b2d4a83e5c6f71d0a9b8e2c4f3d1a6b7c8e9f012";
    const rate = 0.021, typeStart = Math.min(dockAt - 0.05, runAt - 0.55 - CMD.length * rate);
    typeCues(api, typeStart, CMD.length, rate, "type", 0.35);
    const doneT = typeStart + CMD.length * rate;
    api.cue("enter", doneT + 0.08, 0.8);
    // it's running: Wally opens next to the terminal
    const mini = browser(cam, 1468, 690, 760, "localhost");
    mini.shot("/app/home_all.png");
    mini.scroll(0);
    api.cue("pop", runAt + 0.05, 0.8);
    api.cue("coin", runAt + 0.2, 0.5);

    return (t) => {
      if (!widths) {
        const gap = parseFloat(getComputedStyle(head).fontSize) * 0.27;
        widths = parts.map((p) => { p.k.style.width = ""; return [p.k.offsetWidth, gap]; });
      }
      parts.forEach((p, i) => {
        const q = outQuint(ramp(t, p.tt - 0.05, p.tt + 0.45));
        const g = inOutCubic(ramp(t, p.tt - 0.12, p.tt + 0.3));
        p.k.style.width = (widths[i][0] * g).toFixed(2) + "px";
        p.k.style.marginRight = i < parts.length - 1 ? (widths[i][1] * ramp(t, parts[i + 1].tt - 0.12, parts[i + 1].tt + 0.1)).toFixed(2) + "px" : "0px";
        p.w.style.transform = `translateY(${((1 - q) * 115).toFixed(2)}%)`;
      });
      const up = inOutCubic(ramp(t, s2 - 0.35, s2 + 0.4));
      head.style.transform = `translateY(${(-80 * up).toFixed(2)}px) scale(${lerp(1, 0.8, up).toFixed(4)})`;
      reveal(mit, ramp(t, hostAt + 0.15, hostAt + 0.6), { dy: 20 });
      mit.style.transform += ` translateY(${(-70 * up).toFixed(2)}px)`;
      // the terminal: centred while the command is typed, then it steps aside for Wally
      const side = inOutCubic(ramp(t, runAt - 0.15, runAt + 0.55));
      reveal(term, ramp(t, s2 - 0.25, s2 + 0.3), { dy: 60, base: `translate(${(-350 * side).toFixed(2)}px, ${(10 * side).toFixed(2)}px) scale(${lerp(1, 0.8, side).toFixed(4)})` });
      term.style.transformOrigin = "50% 50%";
      const n = Math.max(0, Math.min(CMD.length, Math.floor((t - typeStart) / rate)));
      let html = `<span class="p">$</span> ${CMD.slice(0, n)}`;
      if (t >= doneT + 0.1) html += `\n<span class="dim">${ID}</span>\n<span class="p">$</span> `;
      html += (Math.floor(t * 2.2) % 2 === 0 || n < CMD.length) ? `<span class="caret"></span>` : "";
      setHTML(body, html);
      const mp = ramp(t, runAt - 0.05, runAt + 0.5);
      reveal(mini.node, mp, { dx: 80, dy: 30, scale: 0.9, ease: (p) => outBack(p, 1.15) });
      mini.node.style.transform += " rotate(-1deg)";
      camera(cam, t, [[0, 1, 0, 0]], 0.5);
    };
  };

  /* ------------------------------------------------------------------ *
   *  10. outro — the wallet, the name, the promise
   * ------------------------------------------------------------------ */
  SCENES.outro = (cam, api) => {
    const s2 = api.segStart("outro2"), knowAt = api.on("outro2", "know"), moneyAt = api.on("outro2", "money"), goesAt = api.on("outro2", "goes");
    const W0 = 0.0;
    const logoBox = el("div", "abs", cam);
    const logo = wallet(logoBox, 230);
    const SNAP = logo.snapAt(W0, 1.6);
    const wordBox = el("div", "abs", cam);
    const wm = wordmark(wordBox, 190);
    const tag = headline(cam, 960, 690, "Know where your money goes.", "headline sm");
    tag.w[3].classList.add("acc"); tag.w[4].classList.add("acc");
    // the film's category bar ends here, under the promise
    const bar = box(cam, 560, 778, 800, 14);
    bar.style.cssText += ";display:flex;gap:4px;border-radius:7px;overflow:hidden";
    const segs = [1250, 630, 356, 173, 103, 89, 60, 40, 30, 22].map((v, i) => { const s = el("i", "", bar); s.style.cssText = `display:block;height:100%;flex:${v} 0 0;background:${KCOL[i]};transform-origin:0 50%`; return s; });
    // where to get it: a link, as a pill with GitHub's mark; the repo's name in ink, a light passes over it
    const GH = "M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z";
    const url = at(cam, 960, 884, "");
    url.style.cssText += ";position:relative;overflow:hidden;display:flex;align-items:center;gap:18px;padding:20px 36px 20px 26px;border-radius:999px;background:#fff;box-shadow:0 0 0 1px rgba(20,22,40,.07),var(--shadow);white-space:nowrap";
    url.innerHTML = `<svg viewBox="0 0 16 16" width="38" height="38" fill="#14161b" style="flex:none"><path d="${GH}"/></svg>` +
      `<span style="font:500 32px/1 var(--ui);letter-spacing:-.015em;color:#8a8f9b">github.com/<span style="color:#14161b;font-weight:650">polius/Wally</span></span>`;
    const sheen = el("i", "", url);
    sheen.style.cssText = "position:absolute;top:0;bottom:0;left:0;width:160px;pointer-events:none;background:linear-gradient(100deg,rgba(255,255,255,0) 0%,rgba(79,91,213,.10) 45%,rgba(255,255,255,.0) 100%)";
    api.cue("thump", W0 + 0.02, 0.6);
    api.cue("rustle", W0 + 0.25, 0.5);
    api.cue("snap", SNAP, 1);
    api.cue("hit", SNAP, 1);
    api.pulse(SNAP, 1.2, 960, 420);
    api.cue("chime", goesAt + 0.05, 0.8);
    api.cue("pop", goesAt + 0.27, 0.5);
    return (t) => {
      logo.set(t, W0, 1.6);
      const go = inOutCubic(ramp(t, SNAP + 0.05, SNAP + 0.7));
      const lx = lerp(960, 706, go);
      // the README poster (capture.py --poster): the lockup and the promise, with room between them
      // for the play button; the bar and the link are the film's, not the thumbnail's
      const PM = window.__posterMode, LY = PM ? 330 : 430;
      place(logoBox, lx - 115, LY - 115, 1);
      place(wordBox, lx + 138, LY - 97, 1);
      tag.node.parentNode.style.top = (PM ? 800 : 690) + "px";
      bar.style.display = PM ? "none" : "flex";
      url.parentNode.style.display = PM ? "none" : "";
      wordBox.style.opacity = ramp(t, SNAP + 0.1, SNAP + 0.28).toFixed(3);
      kin(wm.letters, t, SNAP + 0.14, 0.045, 0.6);
      kin(tag.w, t, knowAt - 0.12, 0.06, 0.6);
      segs.forEach((s, i) => (s.style.transform = `scaleX(${outCubic(ramp(t, moneyAt + i * 0.05, moneyAt + 0.5 + i * 0.05)).toFixed(4)})`));
      reveal(url, ramp(t, goesAt + 0.25, goesAt + 0.85), { dy: 26, scale: 0.9, ease: (p) => outBack(p, 1.2) });
      const sp = inOutCubic(ramp(t, goesAt + 0.8, goesAt + 1.7));
      sheen.style.transform = `translateX(${lerp(-180, 560, sp).toFixed(1)}px)`;
      sheen.style.opacity = (sp > 0 && sp < 1 ? 1 : 0).toString();
      camera(cam, t, [[0, 1.02, 0, 0], [SNAP, 1, 0, 0, 3]], 0.4);
    };
  };
})();

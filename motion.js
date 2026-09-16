/* ============================================================
   Uni Planner — motion layer
   Vanilla ports of the Motion Primitives ideas (motion-primitives.com):
   spring easing, AnimatedBackground (sliding indicator), AnimatedGroup
   (staggered blur-in), TransitionPanel, TextEffect, AnimatedNumber,
   Magnetic and Spotlight. Uses the Web Animations API — no dependencies.
   Everything is a no-op under prefers-reduced-motion, and app.js keeps
   working if this file fails to load.
   ============================================================ */
(function () {
  'use strict';

  const root = document.documentElement;
  const reduceMq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  const fineMq = window.matchMedia ? window.matchMedia('(hover: hover) and (pointer: fine)') : { matches: false };
  const canAnimate = typeof Element !== 'undefined' && typeof Element.prototype.animate === 'function';
  // skip motion while the page is hidden: browsers stop producing frames, so nothing would play
  const ok = () => canAnimate && !reduceMq.matches && document.visibilityState !== 'hidden';

  /* Resolve when an animation ends, or after `ms` regardless — app logic must never
     hang on a paused animation (background tab, app switch, throttled device). */
  function settle(anim, ms) {
    if (!anim) return Promise.resolve();
    return new Promise((resolve) => {
      let done = false;
      const finish = () => { if (done) return; done = true; resolve(); };
      anim.finished.then(finish, finish);
      setTimeout(() => {
        if (done) return;
        try { anim.finish(); } catch (err) { /* already cancelled */ }
        finish();
      }, ms);
    });
  }
  const supportsLinear = !!(window.CSS && CSS.supports && CSS.supports('transition-timing-function', 'linear(0, 1)'));

  /* ---------- springs, baked into CSS linear() easings ---------- */
  function spring(stiffness, damping, fallback) {
    let x = 0, v = 0, t = 0;
    const dt = 1 / 240, samples = [0];
    while (t < 2) {
      const f = -stiffness * (x - 1) - damping * v;
      v += f * dt; x += v * dt; t += dt;
      samples.push(x);
      if (t > 0.08 && Math.abs(1 - x) < 0.001 && Math.abs(v) < 0.01) break;
    }
    const n = 40, pts = [];
    for (let i = 0; i <= n; i++) {
      pts.push(+samples[Math.round((i / n) * (samples.length - 1))].toFixed(4));
    }
    pts[0] = 0; pts[n] = 1;
    return {
      easing: supportsLinear ? 'linear(' + pts.join(', ') + ')' : fallback,
      duration: Math.round(t * 1000)
    };
  }

  const EASE = {
    soft:   spring(170, 26, 'cubic-bezier(.22, 1, .36, 1)'),     // critically damped: enters
    bouncy: spring(300, 24, 'cubic-bezier(.34, 1.4, .64, 1)')    // light overshoot: indicators, pops
  };

  root.style.setProperty('--m-spring', EASE.bouncy.easing);
  root.style.setProperty('--m-spring-dur', EASE.bouncy.duration + 'ms');
  root.classList.add('has-motion');

  /* ---------- AnimatedGroup: blur / fade / slide in ---------- */
  function enter(el, o) {
    if (!ok() || !el) return null;
    o = o || {};
    const e = EASE[o.ease || 'soft'];
    const y = o.y == null ? 10 : o.y;
    const from = { opacity: 0, transform: 'translate(' + (o.x || 0) + 'px, ' + y + 'px) scale(' + (o.scale || 1) + ')' };
    const to = { opacity: 1, transform: 'translate(0px, 0px) scale(1)' };
    if (o.blur !== 0) {
      from.filter = 'blur(' + (o.blur == null ? 6 : o.blur) + 'px)';
      to.filter = 'blur(0px)';
    }
    return el.animate([from, to], {
      duration: Math.max(e.duration, 280), easing: e.easing, delay: o.delay || 0, fill: 'backwards'
    });
  }

  function stagger(els, o) {
    if (!ok()) return;
    o = o || {};
    const step = o.step == null ? 35 : o.step;
    Array.from(els).forEach((el, i) => {
      // blur is the expensive part — only the first handful get it
      enter(el, Object.assign({}, o, {
        delay: (o.delay || 0) + Math.min(i, 14) * step,
        blur: i < 10 ? o.blur : 0
      }));
    });
  }

  /* ---------- exits ---------- */
  function exit(el, o) {
    o = o || {};
    if (!ok() || !el) return Promise.resolve();
    const a = el.animate([
      { opacity: 1, transform: 'translate(0px, 0px) scale(1)', filter: 'blur(0px)' },
      { opacity: 0, transform: 'translate(' + (o.x || 0) + 'px, ' + (o.y || 0) + 'px) scale(' + (o.scale || 0.97) + ')', filter: 'blur(4px)' }
    ], { duration: o.duration || 170, easing: 'cubic-bezier(.4, 0, 1, 1)', fill: 'forwards' });

    let p = settle(a, (o.duration || 170) + 120);
    if (o.collapse) {
      p = p.then(() => {
        const gap = el.parentElement ? parseFloat(getComputedStyle(el.parentElement).rowGap) || 0 : 0;
        const cs = getComputedStyle(el);
        el.style.overflow = 'hidden';
        if (!ok()) return;
        return settle(el.animate([
          { height: el.offsetHeight + 'px', paddingTop: cs.paddingTop, paddingBottom: cs.paddingBottom, marginBottom: '0px' },
          { height: '0px', paddingTop: '0px', paddingBottom: '0px', marginBottom: -gap + 'px' }
        ], { duration: 180, easing: 'cubic-bezier(.4, 0, .2, 1)', fill: 'forwards' }), 300);
      });
    }
    return p.catch(() => {});
  }

  /* ---------- TransitionPanel ---------- */
  function panel(el, dir) {
    return enter(el, { x: (dir || 0) * 16, y: dir ? 0 : 8, blur: 4 });
  }

  /* ---------- AnimatedBackground: sliding active + hover indicator ---------- */
  function indicator(group, opts) {
    if (!group) return { update: function () {} };
    if (group.__mInd) return group.__mInd;

    group.classList.add('m-host');
    const act = document.createElement('span');
    act.className = 'm-ind';
    act.setAttribute('aria-hidden', 'true');
    group.insertBefore(act, group.firstChild);

    let hov = null;
    if (opts.hover && fineMq.matches) {
      hov = document.createElement('span');
      hov.className = 'm-ind is-hover';
      hov.setAttribute('aria-hidden', 'true');
      group.insertBefore(hov, act);
      group.classList.add('m-host-hover');
    }

    const items = () => Array.from(group.querySelectorAll(opts.items));
    let placed = false;

    function place(ind, el, instant) {
      if (!el || !el.offsetWidth) { if (ind === act) ind.style.opacity = '0'; return; }
      const jump = instant || !ok();
      if (jump) ind.style.transition = 'none';
      ind.style.width = el.offsetWidth + 'px';
      ind.style.height = el.offsetHeight + 'px';
      ind.style.transform = 'translate(' + el.offsetLeft + 'px, ' + el.offsetTop + 'px)';
      if (ind === act) ind.style.opacity = '1';
      if (jump) { void ind.offsetWidth; ind.style.transition = ''; }
    }

    function update(instant) {
      place(act, items().find(opts.isActive), instant || !placed);
      placed = true;
    }

    if (hov) {
      let shown = false;
      group.addEventListener('pointerover', (e) => {
        const it = e.target.closest(opts.items);
        if (!it || !group.contains(it)) return;
        place(hov, it, !shown);
        hov.style.opacity = '1';
        shown = true;
      });
      group.addEventListener('pointerleave', () => { hov.style.opacity = '0'; shown = false; });
    }

    if (window.ResizeObserver) {
      const ro = new ResizeObserver(() => update(true));
      ro.observe(group);
      items().forEach((it) => ro.observe(it));
    }
    window.addEventListener('resize', () => update(true));

    group.__mInd = { update: update };
    update(true);
    return group.__mInd;
  }

  /* ---------- AnimatedNumber ---------- */
  function countTo(el, from, to) {
    if (!el) return;
    if (!ok() || from === to) { el.textContent = to; return; }
    const t0 = performance.now(), d = 650;
    (function frame(now) {
      const p = Math.min(1, (now - t0) / d);
      const k = 1 - Math.pow(1 - p, 4);
      el.textContent = Math.round(from + (to - from) * k);
      if (p < 1) requestAnimationFrame(frame);
    })(t0);
  }

  /* ---------- TextEffect (per char / per word, blur preset) ---------- */
  function textEffect(el, o) {
    if (!ok() || !el || el.__mText) return;
    const text = el.textContent;
    if (!text.trim()) return;
    o = o || {};
    el.__mText = true;
    el.setAttribute('aria-label', text);

    const wrap = document.createElement('span');
    wrap.setAttribute('aria-hidden', 'true');
    const parts = o.per === 'word' ? text.split(/(\s+)/) : Array.from(text);
    const spans = [];
    parts.forEach((p) => {
      if (!p) return;
      if (/^\s+$/.test(p)) { wrap.appendChild(document.createTextNode(p)); return; }
      const s = document.createElement('span');
      s.textContent = p;
      s.style.display = 'inline-block';
      wrap.appendChild(s);
      spans.push(s);
    });
    el.textContent = '';
    el.appendChild(wrap);

    const step = o.per === 'word' ? 45 : 22;
    const anims = spans.map((s, i) => enter(s, { y: 6, blur: 8, delay: (o.delay || 0) + i * step })).filter(Boolean);
    const longest = (o.delay || 0) + spans.length * step + 900;
    Promise.all(anims.map((a) => settle(a, longest))).then(() => {
      if (el.isConnected && el.firstChild === wrap) { el.textContent = text; }
      el.removeAttribute('aria-label');
      el.__mText = false;
    });
  }

  /* ---------- small pop for toggles / badges ---------- */
  function pop(el) {
    if (!ok() || !el) return;
    el.animate([{ transform: 'scale(.72)' }, { transform: 'scale(1)' }],
      { duration: EASE.bouncy.duration, easing: EASE.bouncy.easing });
  }

  /* ---------- dialogs ---------- */
  function dialogIn(d) {
    if (!ok() || !d) return;
    enter(d, { y: 14, scale: 0.96, blur: 6 });
    try {
      d.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: 'ease-out', pseudoElement: '::backdrop' });
    } catch (err) { /* ::backdrop animation unsupported — the sheet still animates */ }
  }

  function dialogOut(d) {
    if (!d || !d.open) return Promise.resolve();
    if (!ok()) { d.close(); return Promise.resolve(); }
    if (d.__closing) return d.__closing;
    const a = d.animate([
      { opacity: 1, transform: 'translateY(0px) scale(1)', filter: 'blur(0px)' },
      { opacity: 0, transform: 'translateY(8px) scale(.97)', filter: 'blur(4px)' }
    ], { duration: 150, easing: 'cubic-bezier(.4, 0, 1, 1)', fill: 'forwards' });
    let bd = null;
    try {
      bd = d.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 150, easing: 'ease-in', fill: 'forwards', pseudoElement: '::backdrop' });
    } catch (err) { /* ignore */ }
    d.__closing = settle(a, 270).then(() => {
      d.close();
      // forwards-filled exits must not linger, or the next open starts invisible
      a.cancel();
      if (bd) bd.cancel();
      d.__closing = null;
    });
    return d.__closing;
  }

  /* ---------- Magnetic ---------- */
  function magnetic(el, strength) {
    if (!el || !fineMq.matches) return;
    strength = strength || 0.22;
    let tx = 0, ty = 0, raf = 0, lastEvent = null;
    el.classList.add('is-magnetic');
    function apply() {
      raf = 0;
      if (!ok()) { if (tx || ty) { tx = ty = 0; el.style.translate = ''; } return; }
      const e = lastEvent, r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2 - tx, cy = r.top + r.height / 2 - ty;
      const dx = e.clientX - cx, dy = e.clientY - cy;
      const reach = Math.max(r.width, r.height) / 2 + 56;
      if (Math.hypot(dx, dy) < reach) { tx = dx * strength; ty = dy * strength; }
      else { tx = 0; ty = 0; }
      el.style.translate = tx.toFixed(1) + 'px ' + ty.toFixed(1) + 'px';
    }
    window.addEventListener('pointermove', (e) => {
      lastEvent = e;
      if (!raf) raf = requestAnimationFrame(apply);
    }, { passive: true });
  }

  /* ---------- Spotlight: cursor-following glow (styled per theme) ---------- */
  function spotlight(selector) {
    if (!fineMq.matches) return;
    let raf = 0, lastEvent = null;
    document.addEventListener('pointermove', (e) => {
      lastEvent = e;
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        if (root.getAttribute('data-style') !== 'glass') return;
        const t = lastEvent.target.closest && lastEvent.target.closest(selector);
        if (!t) return;
        const r = t.getBoundingClientRect();
        t.style.setProperty('--mx', (lastEvent.clientX - r.left) + 'px');
        t.style.setProperty('--my', (lastEvent.clientY - r.top) + 'px');
      });
    }, { passive: true });
  }

  /* ---------- whole-page crossfade for theme switches ---------- */
  function swap(fn) {
    if (ok() && typeof document.startViewTransition === 'function') {
      let ran = false;
      const once = () => { if (!ran) { ran = true; fn(); } };
      try {
        const t = document.startViewTransition(once);
        // a skipped/aborted transition rejects these; the update itself still runs
        [t.ready, t.finished, t.updateCallbackDone].forEach((p) => p && p.catch(() => {}));
        t.finished.catch(() => {}).then(once);
        return;
      } catch (err) { /* fall through */ }
      once();
      return;
    }
    fn();
  }

  window.UPMotion = {
    ok: ok, enter: enter, stagger: stagger, exit: exit, panel: panel, indicator: indicator,
    countTo: countTo, textEffect: textEffect, pop: pop, dialogIn: dialogIn, dialogOut: dialogOut,
    magnetic: magnetic, spotlight: spotlight, swap: swap
  };
})();

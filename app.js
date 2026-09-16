/* ============================================================
   Uni Planner — local-only planner for class reminders + timetable.
   Data lives in localStorage under STORE_KEY. Nothing leaves the device.
   ============================================================ */
(function () {
  'use strict';

  const STORE_KEY = 'uniplanner.v1';
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /* ---------- icons (inline SVG — no emoji as icons) ---------- */
  const I = {
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m5 13 4 4L19 7"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/></svg>',
    user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
    book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>',
    edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>',
    alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>',
    flag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V4s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 22v-7"/></svg>',
    bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/></svg>',
    cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>'
  };

  const TYPE_LABEL = { exam: 'Exam', assignment: 'Assignment', quiz: 'Quiz', project: 'Project', note: 'Note' };
  const TYPE_CLASS = { exam: 't-exam', assignment: 't-assignment', quiz: 't-quiz', project: 't-project', note: 't-note' };
  const KIND_LABEL = { lecture: 'Lecture', lab: 'Lab', tutorial: 'Tutorial' };
  const KIND_CLASS = { lecture: 't-lecture', lab: 't-lab', tutorial: 't-tutorial' };
  // Complete token pairs — never build these by string interpolation.
  const KIND_VARS = {
    lecture:  { edge: 'var(--primary)', fill: 'var(--primary-soft)' },
    lab:      { edge: 'var(--violet)',  fill: 'var(--violet-soft)' },
    tutorial: { edge: 'var(--amber)',   fill: 'var(--amber-soft)' }
  };
  const TYPE_VARS = {
    exam: 'var(--danger)', assignment: 'var(--accent)', quiz: 'var(--violet)',
    project: 'var(--blue)', note: 'var(--border-strong)'
  };

  /* ---------- tiny helpers ---------- */
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const pad2 = (n) => String(n).padStart(2, '0');
  const dayStartOf = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dateKey = (d) => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  const keyToDate = (k) => { const p = k.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); };
  const minsOf = (hhmm) => { const p = hhmm.split(':').map(Number); return p[0] * 60 + p[1]; };

  function fmtTime(hhmm) {
    const m = minsOf(hhmm), h = Math.floor(m / 60), mm = m % 60;
    const ap = h >= 12 ? 'pm' : 'am';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return h12 + (mm ? ':' + pad2(mm) : '') + ap;
  }
  // 12-hour clock without am/pm, for tight spaces where the hour gutter gives context: 13:30 -> 1:30
  function clock12(hhmm) { const m = minsOf(hhmm); return ((Math.floor(m / 60) % 12) || 12) + ':' + pad2(m % 60); }
  function fmtDate(d) { return DAYS_SHORT[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()]; }

  /* ---------- motion (motion.js); no-op stand-in if it failed to load ---------- */
  const M = window.UPMotion || {
    ok: () => false, enter: () => null, stagger: () => {}, panel: () => null,
    exit: () => Promise.resolve(), indicator: () => ({ update: () => {} }),
    countTo: (el, a, b) => { if (el) el.textContent = b; }, textEffect: () => {}, pop: () => {},
    dialogIn: () => {}, dialogOut: (d) => { if (d && d.open) d.close(); return Promise.resolve(); },
    magnetic: () => {}, spotlight: () => {}, swap: (fn) => fn()
  };

  const STYLES = ['classic', 'paper', 'glass'];

  /* ---------- state ---------- */
  const DEFAULTS = { reminders: [], classes: [], settings: { theme: null, style: 'classic', scheduleView: 'week' } };
  let state = load();
  let ui = { tab: 'reminders', filter: 'all', query: '', showDone: false, editing: null, editingClass: null, weekMode: null, focusDay: null };
  const prevStats = {};
  const indicators = [];

  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return structuredClone(DEFAULTS);
      const p = JSON.parse(raw);
      return {
        reminders: Array.isArray(p.reminders) ? p.reminders : [],
        classes: Array.isArray(p.classes) ? p.classes : [],
        settings: Object.assign({}, DEFAULTS.settings, p.settings || {})
      };
    } catch (e) {
      console.warn('Could not read saved data, starting fresh.', e);
      return structuredClone(DEFAULTS);
    }
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
    catch (e) { toast('Could not save — storage may be full or blocked.'); }
  }

  /* ============================================================
     Quick-capture parser: "Exam CS210 sunday ch 3-5" -> fields
     ============================================================ */
  function parseQuick(raw) {
    let s = ' ' + String(raw).replace(/\s+/g, ' ').trim() + ' ';
    const cut = (re) => { const m = s.match(re); if (m) s = s.replace(m[0], ' '); return m; };
    const out = { title: '', type: 'note', course: '', date: null, time: null, details: '', priority: 'normal' };

    // type — keep the word in the title, it usually reads well
    if (/\b(final|midterm|mid-?term|exam)\b/i.test(s)) out.type = 'exam';
    else if (/\b(quiz)\b/i.test(s)) out.type = 'quiz';
    else if (/\b(assignment|homework|hw|essay|report|sheet)\b/i.test(s)) out.type = 'assignment';
    else if (/\b(project|presentation|deliverable)\b/i.test(s)) out.type = 'project';

    if (/!/.test(s) || /\b(important|urgent)\b/i.test(s)) {
      out.priority = 'high';
      cut(/\s*!+\s*/);
      cut(/\b(important|urgent)\b/i);
    }

    // course code: CS210, MATH 101, PHY-102
    const c = cut(/\b([A-Za-z]{2,4})[\s-]?(\d{3,4})\b/);
    if (c) out.course = (c[1] + c[2]).toUpperCase();

    // chapters
    const ch = cut(/\bch(?:apter)?s?\.?\s*(\d+(?:\s*(?:-|–|to|,|&|and|\+)\s*\d+)*)/i);
    if (ch) out.details = 'Chapters ' + ch[1].replace(/\s*(?:-|–|to)\s*/g, '–').replace(/\s*(?:,|&|and|\+)\s*/g, ', ');

    // time: "at 10", "10am", "14:30"
    let tm = cut(/\b(?:at\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
    if (tm) {
      let h = Number(tm[1]) % 12;
      if (/pm/i.test(tm[3])) h += 12;
      out.time = pad2(h) + ':' + pad2(Number(tm[2] || 0));
    } else {
      tm = cut(/\bat\s*(\d{1,2}):(\d{2})\b/);
      if (tm) out.time = pad2(Number(tm[1])) + ':' + pad2(Number(tm[2]));
    }

    // dates
    const today = dayStartOf(new Date());
    const addDays = (n) => { const d = new Date(today); d.setDate(d.getDate() + n); return d; };
    let m;
    if ((m = cut(/\b(today|tonight)\b/i))) out.date = today;
    else if ((m = cut(/\b(tomorrow|tmrw|tmr|tmw)\b/i))) out.date = addDays(1);
    else if ((m = cut(/\bin\s+(\d{1,2})\s*(day|days|week|weeks)\b/i))) out.date = addDays(Number(m[1]) * (/week/i.test(m[2]) ? 7 : 1));
    else if ((m = cut(/\bnext\s+week\b/i))) out.date = addDays(7);
    else if ((m = cut(/\b(next\s+)?(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(?:day|nesday|rsday|urday)?\b/i))) {
      const key = m[2].toLowerCase().slice(0, 3);
      const target = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].indexOf(key === 'tue' ? 'tue' : key);
      let diff = (target - today.getDay() + 7) % 7;
      if (diff === 0) diff = 7;              // "sunday" said on a Sunday means the next one
      if (m[1]) diff += (diff <= 6 && (target - today.getDay() + 7) % 7 !== 0) ? 0 : 0;
      out.date = addDays(diff);
    } else if ((m = cut(/\b(\d{1,2})\s*[\/.-]\s*(\d{1,2})(?:\s*[\/.-]\s*(\d{2,4}))?\b/))) {
      const yr = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : today.getFullYear();
      const d = new Date(yr, Number(m[2]) - 1, Number(m[1]));
      if (!m[3] && d < today) d.setFullYear(yr + 1);
      out.date = d;
    } else if ((m = cut(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})\b/i)) ||
               (m = cut(/\b(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b/i))) {
      const monTok = /^\d/.test(m[1]) ? m[2] : m[1];
      const dayTok = /^\d/.test(m[1]) ? m[1] : m[2];
      const mi = MONTHS.findIndex((x) => x.toLowerCase() === monTok.toLowerCase().slice(0, 3));
      const d = new Date(today.getFullYear(), mi, Number(dayTok));
      if (d < today) d.setFullYear(today.getFullYear() + 1);
      out.date = d;
    }

    // leftover becomes the title
    let t = s.replace(/\s+/g, ' ').replace(/^[\s,\-–—:]+|[\s,\-–—:]+$/g, '').trim();
    t = t.replace(/\b(on|at|for|the|is|in)\b\s*$/i, '').trim();
    if (!t) t = TYPE_LABEL[out.type] + (out.course ? ' — ' + out.course : '');
    out.title = t.charAt(0).toUpperCase() + t.slice(1);
    return out;
  }

  /* ============================================================
     Due-date maths
     ============================================================ */
  function dueDateOf(r) {
    if (!r.date) return null;
    const d = keyToDate(r.date);
    if (r.time) { const p = r.time.split(':').map(Number); d.setHours(p[0], p[1], 0, 0); }
    return d;
  }
  function daysUntil(r) {
    if (!r.date) return null;
    return Math.round((keyToDate(r.date) - dayStartOf(new Date())) / 86400000);
  }
  function dueLabel(r) {
    const n = daysUntil(r);
    if (n === null) return { text: 'No date', cls: '' };
    const t = r.time ? ' · ' + fmtTime(r.time) : '';
    if (n < 0) return { text: (n === -1 ? 'Overdue by 1 day' : 'Overdue by ' + (-n) + ' days'), cls: 'is-overdue' };
    if (n === 0) return { text: 'Today' + t, cls: 'is-overdue' };
    if (n === 1) return { text: 'Tomorrow' + t, cls: 'is-soon' };
    if (n <= 7) return { text: 'In ' + n + ' days · ' + DAYS_SHORT[keyToDate(r.date).getDay()] + t, cls: 'is-soon' };
    return { text: fmtDate(keyToDate(r.date)) + t, cls: '' };
  }

  /* ============================================================
     Reminders — render
     ============================================================ */
  function visibleReminders() {
    const q = ui.query.trim().toLowerCase();
    return state.reminders.filter((r) => {
      if (!ui.showDone && r.done) return false;
      if (ui.filter !== 'all' && r.type !== ui.filter) return false;
      if (q && !(r.title + ' ' + (r.course || '') + ' ' + (r.details || '')).toLowerCase().includes(q)) return false;
      return true;
    });
  }

  function groupReminders(list) {
    const g = { overdue: [], today: [], tomorrow: [], week: [], later: [], none: [], done: [] };
    list.forEach((r) => {
      if (r.done) return g.done.push(r);
      const n = daysUntil(r);
      if (n === null) g.none.push(r);
      else if (n < 0) g.overdue.push(r);
      else if (n === 0) g.today.push(r);
      else if (n === 1) g.tomorrow.push(r);
      else if (n <= 7) g.week.push(r);
      else g.later.push(r);
    });
    const byDue = (a, b) => {
      const da = dueDateOf(a), db = dueDateOf(b);
      if (da && db && +da !== +db) return da - db;
      if (a.priority !== b.priority) return a.priority === 'high' ? -1 : 1;
      return (b.createdAt || 0) - (a.createdAt || 0);
    };
    Object.keys(g).forEach((k) => g[k].sort(byDue));
    return g;
  }

  function reminderCard(r) {
    const dl = dueLabel(r);
    const meta = [];
    if (r.course) meta.push('<span class="meta-txt meta-course">' + esc(r.course) + '</span>');
    meta.push('<span class="meta-txt ' + dl.cls + '">' + I.clock + esc(dl.text) + '</span>');
    if (r.priority === 'high' && !r.done) meta.push('<span class="pri-flag">' + I.flag + 'High</span>');

    return '' +
      '<article class="card' + (r.done ? ' is-done' : '') + '" style="--edge:' + TYPE_VARS[r.type] + '" data-id="' + r.id + '">' +
        '<button class="check" type="button" data-act="toggle" aria-pressed="' + (r.done ? 'true' : 'false') +
          '" aria-label="' + (r.done ? 'Mark as not done' : 'Mark as done') + ': ' + esc(r.title) + '">' + I.check + '</button>' +
        '<div class="card-body">' +
          '<div class="card-meta"><span class="badge ' + TYPE_CLASS[r.type] + '">' + TYPE_LABEL[r.type] + '</span></div>' +
          '<h3 class="card-title">' + esc(r.title) + '</h3>' +
          '<div class="card-meta">' + meta.join('') + '</div>' +
          (r.details ? '<p class="card-notes">' + esc(r.details) + '</p>' : '') +
        '</div>' +
        '<div class="card-actions">' +
          '<button class="icon-btn" type="button" data-act="edit" aria-label="Edit ' + esc(r.title) + '">' + I.edit + '</button>' +
          '<button class="icon-btn" type="button" data-act="delete" aria-label="Delete ' + esc(r.title) + '">' + I.trash + '</button>' +
        '</div>' +
      '</article>';
  }

  function groupBlock(title, items, cls) {
    if (!items.length) return '';
    return '<section class="group">' +
      '<div class="group-head"><h2 class="group-title ' + (cls || '') + '">' + title + '</h2>' +
      '<span class="group-n tnum">' + items.length + '</span><span class="group-rule"></span></div>' +
      '<div class="cards">' + items.map(reminderCard).join('') + '</div></section>';
  }

  function renderStats() {
    const live = state.reminders.filter((r) => !r.done);
    const overdue = live.filter((r) => { const n = daysUntil(r); return n !== null && n < 0; }).length;
    const soon = live.filter((r) => { const n = daysUntil(r); return n !== null && n >= 0 && n <= 7; }).length;
    const exams = live.filter((r) => r.type === 'exam' && daysUntil(r) !== null && daysUntil(r) >= 0).length;
    const done = state.reminders.filter((r) => r.done).length;

    const stats = [
      { k: 'overdue', n: overdue, l: 'Overdue', c: overdue ? 'is-alert' : '' },
      { k: 'soon', n: soon, l: 'Due in 7 days', c: soon ? 'is-warn' : '' },
      { k: 'exams', n: exams, l: 'Exams ahead', c: '' },
      { k: 'done', n: done, l: 'Completed', c: '' }
    ];
    $('#stats').innerHTML = stats.map((s) =>
      '<div class="stat ' + s.c + '"><span class="stat-n tnum" data-k="' + s.k + '">' + s.n + '</span><span class="stat-l">' + s.l + '</span></div>').join('');
    // AnimatedNumber: roll from the previous value (from 0 on first paint)
    stats.forEach((s) => {
      const from = prevStats[s.k] == null ? 0 : prevStats[s.k];
      if (from !== s.n) M.countTo($('.stat-n[data-k="' + s.k + '"]'), from, s.n);
      prevStats[s.k] = s.n;
    });

    const badge = $('#tab-count-reminders');
    const urgent = overdue + live.filter((r) => daysUntil(r) === 0).length;
    const grew = urgent > (Number(badge.textContent) || 0);
    badge.hidden = urgent === 0;
    badge.textContent = urgent;
    badge.setAttribute('aria-label', urgent + ' overdue or due today');
    if (grew && urgent) M.pop(badge);
  }

  /* Animate only what's new since the last paint of `host`, so re-renders
     (ticking a box, editing) don't replay the whole list. */
  const seen = new WeakMap();
  function animateNew(host, selector, idAttr) {
    const prev = seen.get(host);
    const els = $$(selector, host);
    const ids = new Set(els.map((el) => el.getAttribute(idAttr)));
    seen.set(host, ids);
    if (!prev || host.closest('[hidden]')) {
      return;   // first paint or hidden panel: entrance is handled by revealPanel()
    }
    const fresh = els.filter((el) => !prev.has(el.getAttribute(idAttr)));
    if (fresh.length) M.stagger(fresh, { y: 12, scale: 0.98 });
  }

  function renderReminders() {
    renderStats();
    const list = visibleReminders();
    const host = $('#reminder-list');

    if (!state.reminders.length || !list.length) {
      const wasEmpty = !!host.querySelector('.empty');
      const hadRender = seen.has(host);
      host.innerHTML = !state.reminders.length
        ? emptyState(I.bell, 'Nothing captured yet',
            'Heard a deadline in class? Type it in the box above &mdash; "Exam CS210 sunday ch 3-5" becomes a dated reminder in one keystroke.',
            'sample-reminders', 'Load a sample week')
        : emptyState(I.book, 'No matches', 'Nothing matches this filter or search.', '', '');
      animateNew(host, '.card', 'data-id');
      if (!wasEmpty && hadRender && !host.closest('[hidden]')) {
        M.enter(host.querySelector('.empty'), { y: 10, scale: 0.98 });
        M.textEffect(host.querySelector('.empty h3'), { per: 'word' });
      }
      return;
    }

    const g = groupReminders(list);
    host.innerHTML =
      groupBlock('Overdue', g.overdue, 'is-overdue') +
      groupBlock('Today', g.today, 'is-today') +
      groupBlock('Tomorrow', g.tomorrow) +
      groupBlock('This week', g.week) +
      groupBlock('Later', g.later) +
      groupBlock('No date set', g.none) +
      (ui.showDone ? groupBlock('Done', g.done) : '');
    animateNew(host, '.card', 'data-id');
  }

  function emptyState(icon, h, p, action, actionLabel) {
    return '<div class="empty"><div class="empty-ic">' + icon + '</div><h3>' + h + '</h3><p>' + p + '</p>' +
      (action ? '<button class="btn btn-ghost" type="button" data-empty-action="' + action + '">' + actionLabel + '</button>' : '') +
      '</div>';
  }

  /* ============================================================
     Schedule — render
     ============================================================ */
  function sortedClasses() {
    return state.classes.slice().sort((a, b) => a.day - b.day || minsOf(a.start) - minsOf(b.start));
  }

  function renderTodayStrip() {
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const todays = sortedClasses().filter((c) => c.day === now.getDay());
    const host = $('#today-strip');

    const dateLine = DAYS[now.getDay()] + ', ' + now.getDate() + ' ' + MONTHS[now.getMonth()];
    if (!todays.length) {
      host.innerHTML = '<div class="today-head"><h2>Today</h2><span class="today-date">' + dateLine + '</span></div>' +
        '<p class="card-notes">No classes scheduled today.</p>';
      return;
    }

    const next = todays.find((c) => minsOf(c.start) > nowMin);
    let pill = '';
    if (next) {
      const mins = minsOf(next.start) - nowMin;
      const txt = mins < 60 ? 'in ' + mins + ' min' : 'in ' + Math.floor(mins / 60) + 'h ' + (mins % 60 ? (mins % 60) + 'm' : '');
      pill = '<span class="next-pill">' + I.clock + 'Next: ' + esc(next.course) + ' ' + txt + '</span>';
    }

    host.innerHTML = '<div class="today-head"><h2>Today</h2><span class="today-date">' + dateLine + '</span>' + pill + '</div>' +
      '<div class="today-rail">' + todays.map((c) => {
        const live = nowMin >= minsOf(c.start) && nowMin < minsOf(c.end);
        const past = nowMin >= minsOf(c.end);
        return '<div class="today-item' + (live ? ' is-now' : '') + (past ? ' is-past' : '') + '" data-kind="' + c.kind + '" style="--edge:' + KIND_VARS[c.kind].edge + '">' +
          '<span class="today-time tnum">' + fmtTime(c.start) + ' – ' + fmtTime(c.end) + (live ? ' · now' : '') + '</span>' +
          '<span class="today-name">' + esc(c.course) + (c.title ? ' · ' + esc(c.title) : '') + '</span>' +
          '<span class="badge ' + KIND_CLASS[c.kind] + '">' + KIND_LABEL[c.kind] + '</span>' +
          (c.location ? '<span class="meta-txt">' + I.pin + esc(c.location) + '</span>' : '') +
          (c.instructor ? '<span class="meta-txt">' + I.user + esc(c.instructor) + '</span>' : '') +
        '</div>';
      }).join('') + '</div>';
  }

  /* ---------- week zoom: overview (whole week) <-> focus (one day wide, others blurred) ---------- */
  const phoneMq = window.matchMedia('(max-width: 640px)');
  let lastFitHeight = 0;

  // "Object Oriented Programming" -> "OOP", "Physics II" -> "Phys II", no name -> "INT205"
  function shortName(c) {
    const code = String(c.course || '').split(/\s+/)[0];
    if (!c.title) return code;
    const words = [], suffix = [];
    c.title.replace(/[()]/g, ' ').split(/[\s\-–—\/&,:.]+/).forEach((w) => {
      if (!w || /^(of|and|the|to|in|for|a|an|with|on|at)$/i.test(w)) return;
      if (/^([ivx]{1,4}|\d+)$/i.test(w)) suffix.push(w.toUpperCase()); else words.push(w);
    });
    if (!words.length) return code || c.title.slice(0, 5);
    const base = words.length === 1
      ? (words[0].length <= 6 ? words[0] : words[0].slice(0, 4))
      : words.map((w) => w.charAt(0).toUpperCase()).join('').slice(0, 5);
    return base + (suffix.length ? ' ' + suffix.join(' ') : '');
  }

  function weekLayout(activeDays) {
    const phone = phoneMq.matches;
    const mode = ui.weekMode === 'focus' ? 'focus' : (phone ? 'fit' : 'normal');
    let focus = ui.focusDay;
    if (activeDays.indexOf(focus) < 0) {
      const today = new Date().getDay();
      focus = activeDays.find((d) => d >= today);
      if (focus == null) focus = activeDays[0];
    }
    return { phone: phone, mode: mode, focus: focus };
  }

  // explicit track list (same shape in every mode) so the browser can animate between them
  function weekColumns(activeDays, L) {
    const big = Math.max(2, Math.round(1.25 * (activeDays.length - 1) * 100) / 100);
    return (L.phone ? '40px' : '60px') + ' ' + activeDays.map((d) =>
      'minmax(0px, ' + (L.mode === 'focus' && d === L.focus ? big : 1) + 'fr)').join(' ');
  }

  function dayState(d, L) {
    if (L.mode !== 'focus') return '';
    return d === L.focus ? ' is-focus' : ' is-dim';
  }

  function syncZoomButton(dayCount, L) {
    const b = $('#btn-zoom');
    if (!b) return;
    b.hidden = state.settings.scheduleView !== 'week' || !dayCount || dayCount < 2;
    const zoomed = !!L && L.mode === 'focus';
    b.classList.toggle('is-zoomed', zoomed);
    b.setAttribute('aria-pressed', zoomed ? 'true' : 'false');
    $('.zoom-label', b).textContent = zoomed ? 'Whole week' : 'Zoom in';
  }

  // flip modes on the existing grid (animated); falls back to a full render if the grid can't be reused
  function applyWeekLayout() {
    const week = $('#schedule-week .week');
    if (!week) return false;
    const activeDays = week.dataset.days.split(',').map(Number);
    const L = weekLayout(activeDays);
    if (String(L.phone) !== week.dataset.phone) return false;
    week.classList.remove('mode-fit', 'mode-normal', 'mode-focus');
    week.classList.add('mode-' + L.mode);
    week.style.gridTemplateColumns = weekColumns(activeDays, L);
    $$('[data-day]', week).forEach((el) => {
      const d = Number(el.dataset.day);
      const focused = L.mode === 'focus' && d === L.focus;
      el.classList.toggle('is-focus', focused);
      el.classList.toggle('is-dim', L.mode === 'focus' && !focused);
      if (el.classList.contains('week-dayhead')) el.setAttribute('aria-pressed', focused ? 'true' : 'false');
    });
    syncZoomButton(activeDays.length, L);
    return true;
  }

  function setWeekFocus(day) {
    ui.weekMode = day == null ? null : 'focus';
    if (day != null) ui.focusDay = day;
    if (!applyWeekLayout()) renderWeek();
  }

  function renderWeek() {
    const host = $('#schedule-week');
    const cls = sortedClasses();
    if (!cls.length) {
      host.innerHTML = emptyState(I.cal, 'Your timetable is empty',
        'Add each session once &mdash; lecture, lab or tutorial &mdash; with its room and instructor, and the week builds itself.',
        'sample-schedule', 'Load a sample week');
      animateNew(host, '.slot', 'data-class-id');
      syncZoomButton(0, null);
      return;
    }

    const activeDays = [0, 1, 2, 3, 4, 5, 6].filter((d) => cls.some((c) => c.day === d));
    const L = weekLayout(activeDays);
    let lo = Math.min.apply(null, cls.map((c) => minsOf(c.start)));
    let hi = Math.max.apply(null, cls.map((c) => minsOf(c.end)));
    lo = Math.floor(lo / 60) * 60;
    hi = Math.ceil(hi / 60) * 60;
    const total = Math.max(hi - lo, 120);
    // phones: scale the day so the whole grid fits one screen (below the sticky header, above the + button)
    lastFitHeight = window.innerHeight;
    const ppm = L.phone
      ? Math.min(1.4, Math.max(0.5, (window.innerHeight - 60 - 56 - 84) / total))
      : 1.4;
    const colH = Math.round(total * ppm);
    const minSlot = L.phone ? 22 : 34;
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();

    let gutter = '<div class="week-gutter" style="height:' + colH + 'px">';
    for (let m = lo; m < hi; m += 60) {   // the closing hour label would sit on the grid's bottom edge and get clipped
      gutter += '<span class="hour-label" style="top:' + Math.round((m - lo) * ppm) + 'px">' + fmtTime(pad2(Math.floor(m / 60)) + ':00') + '</span>';
    }
    gutter += '</div>';

    const heads = activeDays.map((d) => {
      const isToday = d === now.getDay();
      const n = cls.filter((c) => c.day === d).length;
      const st = dayState(d, L);
      return '<button type="button" class="week-dayhead' + (isToday ? ' is-today' : '') + st + '" data-day="' + d + '"' +
        ' aria-pressed="' + (st === ' is-focus' ? 'true' : 'false') + '"' +
        ' aria-label="' + DAYS[d] + (isToday ? ', today' : '') + ', ' + n + (n === 1 ? ' session' : ' sessions') + '. Zoom to this day.">' +
        '<span class="d-name">' + DAYS_SHORT[d] + (isToday ? '<span class="d-today"> · today</span>' : '') + '</span>' +
        '<span class="d-n tnum"><span class="d-count">' + n + '</span><span class="d-word">' + (n === 1 ? ' session' : ' sessions') + '</span></span>' +
        '</button>';
    }).join('');

    const cols = activeDays.map((d) => {
      const isToday = d === now.getDay();
      const slots = cls.filter((c) => c.day === d).map((c) => {
        const top = Math.round((minsOf(c.start) - lo) * ppm);
        const h = Math.max(Math.round((minsOf(c.end) - minsOf(c.start)) * ppm), minSlot);
        const v = KIND_VARS[c.kind];
        const showTime = h >= 66, showLoc = h >= 88;
        return '<button class="slot" type="button" data-kind="' + c.kind + '" data-day="' + d + '" data-class-id="' + c.id + '" style="top:' + top + 'px;height:' + h + 'px;--edge:' + v.edge + ';--fill:' + v.fill + '"' +
          ' aria-label="' + esc((c.title ? c.title + ', ' : '') + c.course + ' ' + KIND_LABEL[c.kind] + ', ' + fmtTime(c.start) + ' to ' + fmtTime(c.end) +
            (c.location ? ', ' + c.location : '') + (c.instructor ? ', ' + c.instructor : '')) + '">' +
          // full detail — course name is the headline, code drops to the kind line
          '<span class="slot-d">' +
            '<span class="slot-code' + (h < 84 ? ' is-short' : '') + '">' + esc(c.title || c.course) + '</span>' +
            '<span class="slot-kind">' + KIND_LABEL[c.kind] +
              (c.title ? ' <span class="slot-sub">· ' + esc(c.course) + '</span>' : '') + '</span>' +
            (showTime ? '<span class="slot-meta tnum">' + fmtTime(c.start) + '–' + fmtTime(c.end) + '</span>' : '') +
            (showLoc && c.location ? '<span class="slot-meta">' + esc(c.location) + '</span>' : '') +
            (h >= 110 && c.instructor ? '<span class="slot-meta">' + esc(c.instructor) + '</span>' : '') +
          '</span>' +
          // compact label for the zoomed-out week and the blurred side days
          '<span class="slot-c" aria-hidden="true">' +
            '<span class="slot-short' + (h >= 52 ? ' can-wrap' : '') + '">' + esc(shortName(c)) + '</span>' +
            (h >= 38 ? '<span class="slot-ctime tnum">' + clock12(c.start) + '</span>' : '') +
          '</span>' +
        '</button>';
      }).join('');
      const nowLine = (isToday && nowMin >= lo && nowMin <= hi)
        ? '<div class="now-line" style="top:' + Math.round((nowMin - lo) * ppm) + 'px" aria-hidden="true"></div>' : '';
      return '<div class="week-col' + (isToday ? ' is-today' : '') + dayState(d, L) + '" data-day="' + d + '" style="height:' + colH + 'px">' + slots + nowLine + '</div>';
    }).join('');

    host.innerHTML = '<div class="week mode-' + L.mode + '" data-days="' + activeDays.join(',') + '" data-phone="' + L.phone + '"' +
      ' style="--days:' + activeDays.length + ';--px-per-min:' + ppm + ';grid-template-columns:' + weekColumns(activeDays, L) + '">' +
      '<div class="week-corner"></div>' + heads + gutter + cols + '</div>';
    animateNew(host, '.slot', 'data-class-id');
    syncZoomButton(activeDays.length, L);
  }

  function renderScheduleList() {
    const host = $('#schedule-list');
    const cls = sortedClasses();
    if (!cls.length) { host.innerHTML = ''; animateNew(host, '.card', 'data-class-id'); return; }
    const today = new Date().getDay();

    host.innerHTML = [0, 1, 2, 3, 4, 5, 6].map((d) => {
      const items = cls.filter((c) => c.day === d);
      if (!items.length) return '';
      return '<section class="group"><div class="group-head">' +
        '<h2 class="group-title' + (d === today ? ' is-today' : '') + '">' + DAYS[d] + (d === today ? ' · today' : '') + '</h2>' +
        '<span class="group-n tnum">' + items.length + '</span><span class="group-rule"></span></div><div class="cards">' +
        items.map((c) => {
          const meta = ['<span class="meta-txt tnum">' + I.clock + fmtTime(c.start) + ' – ' + fmtTime(c.end) + '</span>'];
          if (c.location) meta.push('<span class="meta-txt">' + I.pin + esc(c.location) + '</span>');
          if (c.instructor) meta.push('<span class="meta-txt">' + I.user + esc(c.instructor) + '</span>');
          return '<article class="card" data-kind="' + c.kind + '" style="--edge:' + KIND_VARS[c.kind].edge + '" data-class-id="' + c.id + '">' +
            '<span class="badge ' + KIND_CLASS[c.kind] + '">' + KIND_LABEL[c.kind] + '</span>' +
            '<div class="card-body">' +
              '<h3 class="card-title">' + esc(c.course) + (c.title ? ' · ' + esc(c.title) : '') + '</h3>' +
              '<div class="card-meta">' + meta.join('') + '</div>' +
            '</div>' +
            '<div class="card-actions">' +
              '<button class="icon-btn" type="button" data-act="edit-class" aria-label="Edit ' + esc(c.course) + '">' + I.edit + '</button>' +
              '<button class="icon-btn" type="button" data-act="delete-class" aria-label="Delete ' + esc(c.course) + '">' + I.trash + '</button>' +
            '</div></article>';
        }).join('') + '</div></section>';
    }).join('');
    animateNew(host, '.card', 'data-class-id');
  }

  function renderSchedule() {
    renderTodayStrip();
    const week = state.settings.scheduleView === 'week';
    $('#schedule-week').hidden = !week;
    $('#schedule-list').hidden = week;
    if (week) renderWeek(); else { renderScheduleList(); syncZoomButton(0, null); }
  }

  function renderAll() {
    renderReminders();
    renderSchedule();
    const codes = Array.from(new Set(state.classes.map((c) => c.course).concat(
      state.reminders.map((r) => r.course).filter(Boolean)))).sort();
    $('#course-list').innerHTML = codes.map((c) => '<option value="' + esc(c) + '">').join('');
  }

  /* ============================================================
     Dialogs
     ============================================================ */
  function clearErrors(form) {
    $$('.err', form).forEach((e) => { e.hidden = true; e.textContent = ''; });
    $$('[aria-invalid]', form).forEach((e) => e.removeAttribute('aria-invalid'));
  }
  function showError(id, msg) {
    const p = $('[data-err-for="' + id + '"]');
    if (p) { p.innerHTML = I.alert + esc(msg); p.hidden = false; }
    const f = document.getElementById(id);
    if (f) { f.setAttribute('aria-invalid', 'true'); f.focus(); }
  }

  function openReminder(r) {
    ui.editing = r ? r.id : null;
    const f = $('#reminder-form');
    clearErrors(f);
    $('#reminder-dialog-title').textContent = r ? 'Edit reminder' : 'New reminder';
    $('#r-delete').hidden = !r;
    f.title.value = r ? r.title : '';
    f.course.value = r ? (r.course || '') : '';
    f.priority.value = r ? (r.priority || 'normal') : 'normal';
    f.date.value = r ? (r.date || '') : '';
    f.time.value = r ? (r.time || '') : '';
    f.details.value = r ? (r.details || '') : '';
    const type = r ? r.type : 'assignment';
    $$('input[name="type"]', f).forEach((i) => { i.checked = i.value === type; });
    const d = $('#reminder-dialog');
    d.showModal(); M.dialogIn(d);
    setTimeout(() => f.title.focus(), 30);
  }

  function openClass(c) {
    ui.editingClass = c ? c.id : null;
    const f = $('#class-form');
    clearErrors(f);
    $('#class-dialog-title').textContent = c ? 'Edit class' : 'New class';
    $('#c-delete').hidden = !c;
    f.course.value = c ? c.course : '';
    f.title.value = c ? (c.title || '') : '';
    f.start.value = c ? c.start : '09:00';
    f.end.value = c ? c.end : '09:50';
    f.location.value = c ? (c.location || '') : '';
    f.instructor.value = c ? (c.instructor || '') : '';
    $$('input[name="kind"]', f).forEach((i) => { i.checked = i.value === (c ? c.kind : 'lecture'); });
    $$('input[name="day"]', f).forEach((i) => { i.checked = c ? Number(i.value) === c.day : false; });
    const d = $('#class-dialog');
    d.showModal(); M.dialogIn(d);
    setTimeout(() => f.course.focus(), 30);
  }

  /* ============================================================
     Toasts
     ============================================================ */
  function toast(msg, undoFn) {
    const region = $('#toast-region');
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = '<span>' + esc(msg) + '</span>';
    if (undoFn) {
      const b = document.createElement('button');
      b.className = 'undo'; b.type = 'button'; b.textContent = 'Undo';
      b.addEventListener('click', () => { undoFn(); dismiss(); });
      el.appendChild(b);
    }
    let gone = false;
    function dismiss() {
      if (gone) return; gone = true;
      M.exit(el, { y: 8, scale: 0.96, duration: 160 }).then(() => el.remove());
    }
    region.appendChild(el);
    M.enter(el, { y: 16, scale: 0.96, blur: 4 });
    setTimeout(dismiss, undoFn ? 7000 : 3500);
  }

  /* ============================================================
     Sample data
     ============================================================ */
  function sampleClasses() {
    return [
      { course: 'CS210', title: 'Data Structures', kind: 'lecture', day: 0, start: '09:00', end: '09:50', location: 'Bldg C — 214', instructor: 'Dr. Ahmed Salem' },
      { course: 'CS210', title: 'Data Structures', kind: 'lab', day: 2, start: '11:00', end: '12:50', location: 'Lab 3', instructor: 'Eng. Nour Hassan' },
      { course: 'MATH201', title: 'Linear Algebra', kind: 'lecture', day: 1, start: '10:00', end: '11:15', location: 'Hall A', instructor: 'Dr. Layla Farouk' },
      { course: 'MATH201', title: 'Linear Algebra', kind: 'tutorial', day: 3, start: '09:00', end: '09:50', location: 'Bldg B — 108', instructor: 'TA Omar Zaki' },
      { course: 'PHY102', title: 'Physics II', kind: 'lecture', day: 0, start: '13:00', end: '14:15', location: 'Hall D', instructor: 'Dr. Karim Nabil' },
      { course: 'PHY102', title: 'Physics II', kind: 'lab', day: 4, start: '10:00', end: '11:50', location: 'Physics Lab 1', instructor: 'Eng. Mona Adel' }
    ].map((c) => Object.assign({ id: uid() }, c));
  }
  function sampleReminders() {
    const d = (n) => { const x = new Date(); x.setDate(x.getDate() + n); return dateKey(x); };
    return [
      { title: 'Midterm exam', type: 'exam', course: 'CS210', date: d(6), time: '10:00', details: 'Chapters 3–5, no formula sheet', priority: 'high' },
      { title: 'Assignment 2 — sorting', type: 'assignment', course: 'CS210', date: d(2), time: '23:59', details: 'Submit on the portal', priority: 'normal' },
      { title: 'Quiz on eigenvalues', type: 'quiz', course: 'MATH201', date: d(1), time: '', details: 'Section 5.2 only', priority: 'normal' },
      { title: 'Lab report — optics', type: 'assignment', course: 'PHY102', date: d(-1), time: '', details: '', priority: 'normal' },
      { title: 'Bring calculator to every lab', type: 'note', course: 'PHY102', date: '', time: '', details: '', priority: 'normal' }
    ].map((r) => Object.assign({ id: uid(), done: false, createdAt: Date.now() }, r));
  }

  /* ============================================================
     Wiring
     ============================================================ */
  const TABS = ['reminders', 'schedule'];
  function switchTab(name, opts) {
    const from = ui.tab;
    ui.tab = name;
    TABS.forEach((t) => {
      const tab = $('#tab-' + t), panel = $('#panel-' + t);
      const on = t === name;
      tab.setAttribute('aria-selected', on ? 'true' : 'false');
      tab.tabIndex = on ? 0 : -1;
      panel.hidden = !on;
    });
    const fab = $('#fab');
    fab.setAttribute('aria-label', name === 'schedule' ? 'Add class' : 'Add reminder');
    refreshIndicators();
    if (opts && opts.silent) return;
    if (from !== name) {
      const dir = TABS.indexOf(name) > TABS.indexOf(from) ? 1 : -1;
      if (name === 'schedule') renderSchedule();   // "now" markers may be stale
      revealPanel(name, dir);
    }
  }

  /* entrance for a whole panel: slide the panel, stagger its items, type the headings */
  function revealPanel(name, dir) {
    const panel = $('#panel-' + name);
    if (!panel || panel.hidden) return;
    M.panel(panel, dir || 0);
    if (name === 'reminders') {
      M.stagger($$('.stat', panel), { y: 10, step: 45, blur: 4 });
      M.stagger($$('#reminder-list .card, #reminder-list .empty', panel), { y: 14, delay: 90 });
      $$('#reminder-list .group-title', panel).forEach((h, i) => M.textEffect(h, { delay: 60 + i * 70 }));
    } else {
      M.enter($('#today-strip'), { y: 10, blur: 4 });
      M.textEffect($('#today-strip h2'), { delay: 60 });
      const week = state.settings.scheduleView === 'week';
      M.stagger($$(week ? '#schedule-week .slot, #schedule-week .empty' : '#schedule-list .card', panel),
        { y: week ? -6 : 14, scale: week ? 0.96 : 1, step: week ? 28 : 35, delay: 80 });
      if (!week) $$('#schedule-list .group-title', panel).forEach((h, i) => M.textEffect(h, { delay: 60 + i * 70 }));
    }
  }

  function refreshIndicators() { indicators.forEach((ind) => ind.update()); }

  function syncChips(attr, value) {
    $$('.chip[' + attr + ']').forEach((x) => {
      const on = x.getAttribute(attr) === value;
      x.classList.toggle('is-on', on);
      x.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    refreshIndicators();
  }

  function applyTheme() {
    const pref = state.settings.theme ||
      (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    document.documentElement.setAttribute('data-theme', pref);
    $('#btn-theme').setAttribute('aria-label', pref === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
    applyStyle();
  }

  function applyStyle() {
    const style = STYLES.indexOf(state.settings.style) > -1 ? state.settings.style : 'classic';
    document.documentElement.setAttribute('data-style', style);
    const sel = $('#style-select');
    if (sel && sel.value !== style) sel.value = style;
    // fonts differ per style, so indicator geometry must be re-measured once they land
    refreshIndicators();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(refreshIndicators);
    setTimeout(refreshIndicators, 350);
  }

  function init() {
    applyTheme();
    switchTab('reminders', { silent: true });
    syncChips('data-view', state.settings.scheduleView === 'list' ? 'list' : 'week');

    // AnimatedBackground: sliding indicators behind tabs and chip groups
    indicators.push(M.indicator($('.tabs'), {
      items: '.tab', isActive: (el) => el.getAttribute('aria-selected') === 'true', hover: true
    }));
    $$('.chips').forEach((g) => indicators.push(M.indicator(g, {
      items: '.chip', isActive: (el) => el.classList.contains('is-on'), hover: true
    })));

    // ---- theme dropdown ----
    const styleSel = $('#style-select');
    styleSel.value = document.documentElement.getAttribute('data-style') || 'classic';
    styleSel.addEventListener('change', () => {
      const next = STYLES.indexOf(styleSel.value) > -1 ? styleSel.value : 'classic';
      state.settings.style = next;
      save();
      M.swap(() => applyStyle());
    });

    // day checkboxes in the class dialog
    $('#c-days').innerHTML = DAYS_SHORT.map((d, i) =>
      '<label><input type="checkbox" name="day" value="' + i + '"><span class="day-box">' + d + '</span></label>').join('');

    // ---- tabs (roving focus) ----
    $('.tabs').addEventListener('click', (e) => {
      const t = e.target.closest('.tab'); if (t) switchTab(t.id.replace('tab-', ''));
    });
    $('.tabs').addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const tabs = $$('.tab'); const i = tabs.indexOf(document.activeElement);
      if (i < 0) return;
      const n = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
      n.focus(); switchTab(n.id.replace('tab-', '')); e.preventDefault();
    });

    // ---- theme ----
    $('#btn-theme').addEventListener('click', () => {
      const cur = document.documentElement.getAttribute('data-theme');
      state.settings.theme = cur === 'dark' ? 'light' : 'dark';
      save(); M.swap(() => applyTheme());
    });

    // ---- data menu ----
    const menu = $('#menu-data'), menuBtn = $('#btn-data');
    menuBtn.addEventListener('click', () => {
      const open = menu.hidden;
      menu.hidden = !open;
      menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    document.addEventListener('click', (e) => {
      if (!menu.hidden && !e.target.closest('.menu-wrap')) { menu.hidden = true; menuBtn.setAttribute('aria-expanded', 'false'); }
    });
    menu.addEventListener('click', (e) => {
      const b = e.target.closest('[data-action]'); if (!b) return;
      menu.hidden = true; menuBtn.setAttribute('aria-expanded', 'false');
      if (b.dataset.action === 'export') exportData();
      if (b.dataset.action === 'import') $('#import-file').click();
      if (b.dataset.action === 'wipe') {
        if (confirm('Erase every reminder and class stored in this browser? This cannot be undone.')) {
          state = structuredClone(DEFAULTS); save(); applyTheme(); syncChips('data-view', 'week'); renderAll(); toast('All data erased.');
        }
      }
    });
    $('#import-file').addEventListener('change', importData);

    // ---- quick capture ----
    const cap = $('#capture-input'), prev = $('#capture-preview');
    cap.addEventListener('input', () => {
      const v = cap.value.trim();
      if (!v) { prev.hidden = true; prev.innerHTML = ''; return; }
      const p = parseQuick(v);
      const bits = ['<span class="badge ' + TYPE_CLASS[p.type] + '">' + TYPE_LABEL[p.type] + '</span>'];
      if (p.course) bits.push('<span class="meta-txt meta-course">' + esc(p.course) + '</span>');
      bits.push('<span class="meta-txt">' + I.cal + (p.date ? esc(fmtDate(p.date)) + (p.time ? ' · ' + fmtTime(p.time) : '') : 'no date') + '</span>');
      if (p.details) bits.push('<span class="meta-txt">' + I.book + esc(p.details) + '</span>');
      if (p.priority === 'high') bits.push('<span class="pri-flag">' + I.flag + 'High</span>');
      bits.push('<span class="meta-txt">' + I.edit + esc(p.title) + '</span>');
      prev.innerHTML = bits.join('');
      prev.hidden = false;
    });

    $('#capture-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const v = cap.value.trim(); if (!v) { cap.focus(); return; }
      const p = parseQuick(v);
      state.reminders.push({
        id: uid(), title: p.title, type: p.type, course: p.course,
        date: p.date ? dateKey(p.date) : '', time: p.time || '',
        details: p.details, priority: p.priority, done: false, createdAt: Date.now()
      });
      save(); renderAll();
      cap.value = ''; prev.hidden = true; prev.innerHTML = '';
      toast('Added “' + p.title + '”');
      cap.focus();
    });

    // ---- filters / search ----
    $$('.chip[data-filter]').forEach((c) => c.addEventListener('click', () => {
      ui.filter = c.dataset.filter;
      syncChips('data-filter', ui.filter);
      renderReminders();
    }));
    let qt;
    $('#search-input').addEventListener('input', (e) => {
      clearTimeout(qt);
      qt = setTimeout(() => { ui.query = e.target.value; renderReminders(); }, 150);
    });
    $('#show-done').addEventListener('change', (e) => { ui.showDone = e.target.checked; renderReminders(); });

    // ---- schedule view toggle ----
    $$('.chip[data-view]').forEach((c) => c.addEventListener('click', () => {
      if (state.settings.scheduleView === c.dataset.view) return;
      state.settings.scheduleView = c.dataset.view;
      syncChips('data-view', c.dataset.view);
      save(); renderSchedule();
      const week = c.dataset.view === 'week';
      M.stagger($$(week ? '#schedule-week .slot' : '#schedule-list .card'),
        { y: week ? -6 : 14, scale: week ? 0.96 : 1, step: week ? 24 : 35 });
    }));

    // ---- reminder list actions ----
    $('#reminder-list').addEventListener('click', (e) => {
      const sample = e.target.closest('[data-empty-action="sample-reminders"]');
      if (sample) {
        state.reminders = sampleReminders().concat(state.reminders);
        if (!state.classes.length) state.classes = sampleClasses();
        save(); renderAll(); toast('Sample week loaded — edit or delete freely.');
        return;
      }
      const card = e.target.closest('.card'); if (!card || card.dataset.leaving) return;
      const r = state.reminders.find((x) => x.id === card.dataset.id); if (!r) return;
      const act = (e.target.closest('[data-act]') || {}).dataset;
      if (!act) return;
      if (act.act === 'toggle') {
        r.done = !r.done; save();
        if (r.done && !ui.showDone) {
          // it's about to disappear from the list: tick first, then let it leave
          const chk = card.querySelector('.check');
          chk.setAttribute('aria-pressed', 'true'); M.pop(chk);
          card.dataset.leaving = '1';
          if (M.ok()) setTimeout(() => M.exit(card, { x: 24, collapse: true }).then(renderAll), 260);
          else renderAll();
        } else {
          renderAll();
          const again = $('#reminder-list .card[data-id="' + r.id + '"] .check');
          if (again) { again.focus(); M.pop(again); }
        }
      } else if (act.act === 'edit') {
        openReminder(r);
      } else if (act.act === 'delete') {
        // commit first, animate second: the data is safe even if the tab is closed mid-animation
        card.dataset.leaving = '1';
        const idx = state.reminders.indexOf(r);
        state.reminders.splice(idx, 1); save();
        toast('Deleted “' + r.title + '”', () => {
          if (!state.reminders.includes(r)) state.reminders.splice(Math.min(idx, state.reminders.length), 0, r);
          save(); renderAll();
        });
        M.exit(card, { x: -24, collapse: true }).then(renderAll);
      }
    });

    // ---- schedule actions ----
    $('#schedule-week').addEventListener('click', (e) => {
      if (e.target.closest('[data-empty-action="sample-schedule"]')) {
        state.classes = sampleClasses(); save(); renderAll(); toast('Sample timetable loaded.');
        return;
      }
      const head = e.target.closest('.week-dayhead');
      if (head) {
        // tap a day to zoom into it; tap the zoomed day again to see the whole week
        setWeekFocus(head.classList.contains('is-focus') ? null : Number(head.dataset.day));
        return;
      }
      const s = e.target.closest('.slot');
      if (!s) return;
      const week = s.closest('.week');
      const compact = week && (week.classList.contains('mode-fit') || s.closest('.week-col.is-dim'));
      if (compact) { setWeekFocus(Number(s.dataset.day)); return; }
      openClass(state.classes.find((c) => c.id === s.dataset.classId));
    });
    $('#btn-zoom').addEventListener('click', () => {
      const zoomed = ui.weekMode === 'focus';
      setWeekFocus(zoomed ? null : (ui.focusDay == null ? -1 : ui.focusDay));
      // bring the grid into view if the button sent you somewhere off-screen
      const wrap = $('#schedule-week');
      const r = wrap.getBoundingClientRect();
      if (r.top < 60 || r.top > window.innerHeight * 0.6) {
        wrap.scrollIntoView({ block: 'start', behavior: M.ok() ? 'smooth' : 'auto' });
      }
    });

    // phone <-> desktop layout, or a big height change (rotation): rebuild so the week still fits
    const onViewportChange = () => { if (!$('#schedule-week').hidden) renderSchedule(); };
    if (phoneMq.addEventListener) phoneMq.addEventListener('change', onViewportChange);
    else if (phoneMq.addListener) phoneMq.addListener(onViewportChange);
    let resizeT;
    window.addEventListener('resize', () => {
      clearTimeout(resizeT);
      resizeT = setTimeout(() => {
        const week = $('#schedule-week .week');
        const layoutChanged = week && week.dataset.phone !== String(phoneMq.matches);
        if (layoutChanged || (phoneMq.matches && Math.abs(window.innerHeight - lastFitHeight) > 120)) onViewportChange();
      }, 200);
    });
    $('#schedule-list').addEventListener('click', (e) => {
      const card = e.target.closest('[data-class-id]'); if (!card) return;
      const c = state.classes.find((x) => x.id === card.dataset.classId); if (!c) return;
      const act = (e.target.closest('[data-act]') || {}).dataset;
      if (act && act.act === 'delete-class') {
        if (card.dataset.leaving) return;
        card.dataset.leaving = '1';
        const idx = state.classes.indexOf(c);
        state.classes.splice(idx, 1); save();
        toast('Removed ' + c.course + ' ' + KIND_LABEL[c.kind], () => {
          if (!state.classes.includes(c)) state.classes.splice(Math.min(idx, state.classes.length), 0, c);
          save(); renderAll();
        });
        M.exit(card, { x: -24, collapse: true }).then(renderAll);
      } else {
        openClass(c);
      }
    });
    $('#btn-add-class').addEventListener('click', () => openClass(null));

    // ---- FAB ----
    M.magnetic($('#fab'));
    M.spotlight('.card, .stat, .today-strip');
    $('#fab').addEventListener('click', () => {
      if (ui.tab === 'schedule') openClass(null); else openReminder(null);
    });

    // ---- dialog close buttons ----
    $$('[data-close]').forEach((b) => b.addEventListener('click', () => M.dialogOut(b.closest('dialog'))));
    $$('dialog').forEach((d) => d.addEventListener('cancel', (e) => { e.preventDefault(); M.dialogOut(d); }));

    // ---- reminder form ----
    $('#reminder-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const f = e.target;
      clearErrors(f);
      const title = f.title.value.trim();
      if (!title) { showError('r-title', 'Give it a title so you recognise it later.'); return; }
      const data = {
        title: title,
        type: (f.querySelector('input[name="type"]:checked') || {}).value || 'note',
        course: f.course.value.trim().toUpperCase(),
        date: f.date.value, time: f.time.value,
        details: f.details.value.trim(),
        priority: f.priority.value
      };
      if (ui.editing) {
        Object.assign(state.reminders.find((r) => r.id === ui.editing), data);
      } else {
        state.reminders.push(Object.assign({ id: uid(), done: false, createdAt: Date.now() }, data));
      }
      M.dialogOut($('#reminder-dialog'));
      save(); renderAll();
      toast(ui.editing ? 'Reminder updated.' : 'Reminder added.');
      ui.editing = null;
    });
    $('#r-delete').addEventListener('click', () => {
      const r = state.reminders.find((x) => x.id === ui.editing);
      if (r && confirm('Delete “' + r.title + '”?')) {
        state.reminders.splice(state.reminders.indexOf(r), 1);
        M.dialogOut($('#reminder-dialog'));
        save(); renderAll(); toast('Deleted.');
      }
    });

    // ---- class form ----
    $('#class-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const f = e.target;
      clearErrors(f);
      const course = f.course.value.trim().toUpperCase();
      if (!course) { showError('c-course', 'A course code keeps the grid readable.'); return; }
      const days = $$('input[name="day"]:checked', f).map((i) => Number(i.value));
      if (!days.length) {
        const p = $('[data-err-for="c-days"]');
        p.innerHTML = I.alert + 'Pick at least one day.'; p.hidden = false;
        return;
      }
      if (minsOf(f.end.value) <= minsOf(f.start.value)) {
        showError('c-end', 'The end time has to be after the start time.'); return;
      }
      const base = {
        course: course, title: f.title.value.trim(),
        kind: (f.querySelector('input[name="kind"]:checked') || {}).value || 'lecture',
        start: f.start.value, end: f.end.value,
        location: f.location.value.trim(), instructor: f.instructor.value.trim()
      };
      if (ui.editingClass) {
        Object.assign(state.classes.find((c) => c.id === ui.editingClass), base, { day: days[0] });
        days.slice(1).forEach((d) => state.classes.push(Object.assign({ id: uid(), day: d }, base)));
      } else {
        days.forEach((d) => state.classes.push(Object.assign({ id: uid(), day: d }, base)));
      }
      M.dialogOut($('#class-dialog'));
      save(); renderAll();
      toast(ui.editingClass ? 'Class updated.' : (days.length > 1 ? days.length + ' sessions added.' : 'Class added.'));
      ui.editingClass = null;
    });
    $('#c-delete').addEventListener('click', () => {
      const c = state.classes.find((x) => x.id === ui.editingClass);
      if (c && confirm('Remove ' + c.course + ' ' + KIND_LABEL[c.kind] + ' on ' + DAYS[c.day] + '?')) {
        state.classes.splice(state.classes.indexOf(c), 1);
        M.dialogOut($('#class-dialog'));
        save(); renderAll(); toast('Class removed.');
      }
    });

    // ---- keyboard shortcuts ----
    document.addEventListener('keydown', (e) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
      if (e.key === '/' && !typing) { e.preventDefault(); $('#search-input').focus(); }
      if (e.key.toLowerCase() === 'n' && !typing && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        if (ui.tab === 'schedule') openClass(null); else $('#capture-input').focus();
      }
    });

    renderAll();
    revealPanel('reminders', 0);
    // keep "now" markers honest without re-rendering constantly
    setInterval(() => { if (ui.tab === 'schedule') renderSchedule(); }, 60000);
  }

  /* ---------- backup ---------- */
  function exportData() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'uni-planner-' + dateKey(new Date()) + '.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast('Backup downloaded.');
  }
  function importData(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const fr = new FileReader();
    fr.onload = () => {
      try {
        const p = JSON.parse(fr.result);
        if (!p || (!Array.isArray(p.reminders) && !Array.isArray(p.classes))) throw new Error('shape');
        if (!confirm('Replace everything currently stored with this backup?')) { e.target.value = ''; return; }
        state = {
          reminders: (p.reminders || []).map((r) => Object.assign({ id: uid(), createdAt: Date.now(), done: false }, r)),
          classes: (p.classes || []).map((c) => Object.assign({ id: uid() }, c)),
          settings: Object.assign({}, DEFAULTS.settings, p.settings || {})
        };
        save(); applyTheme(); syncChips('data-view', state.settings.scheduleView === 'list' ? 'list' : 'week'); renderAll(); toast('Backup restored.');
      } catch (err) {
        toast('That file is not a Uni Planner backup.');
      }
      e.target.value = '';
    };
    fr.readAsText(file);
  }

  document.addEventListener('DOMContentLoaded', init);
})();

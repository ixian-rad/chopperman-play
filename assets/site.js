// Chopperman site: shared chrome (nav, menu sheet, ribbon, scroll-spy, auto-hiding bar), old-anchor router, live build tags,
// Assets v2 data, scoreboard highlights, cost table + glance tiles, and the milestones gallery (views, tabs, lightbox with compare).
(function () {
  'use strict';
  var DOC = document.documentElement;
  var ROOT = DOC.getAttribute('data-root') || '';
  var PAGE = DOC.getAttribute('data-page') || 'home';
  var GAMES = ['codex', 'claude', 'deepseek'];
  var NAMES = { codex: 'Codex', claude: 'Claude', deepseek: 'DeepSeek', gemini: 'Gemini' };
  var MOBILE = window.matchMedia('(max-width: 720px)');
  var REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)');

  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function $$(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }
  function each(sel, fn) { $$(sel).forEach(fn); }
  function text(el, s) { if (el) el.textContent = s; }
  function el(tag, cls, s) { var e = document.createElement(tag); if (cls) e.className = cls; if (s != null) e.textContent = s; return e; }
  function getText(url) {
    return fetch(ROOT + url, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error(url + ' ' + r.status);
      return r.text();
    });
  }
  function getJSON(url) { return getText(url).then(JSON.parse); }

  // 0. Old one-page anchors (…/#reviews etc.) now live on other pages. Netlify/Pages redirects can't see hashes, so redirect here.
  if (PAGE === 'home' && location.hash) {
    var MOVED = { scores: 'results/#scores', reviews: 'results/#reviews', round1: 'results/#round1', 'review-codex': 'results/#review-codex',
      'review-claude': 'results/#review-claude', 'review-deepseek': 'results/#review-deepseek', 'snap-title': 'results/#snap-title',
      cost: 'cost/', 'behind-the-build': 'cost/#log', 'blog-title': 'cost/#log', 'sb-gemini': 'cost/#gemini-cost', 'sb-cost': 'results/#sb-cost',
      'v2-codex': 'results/#v2-codex', 'v2-claude': 'results/#v2-claude', 'v2-deepseek': 'results/#v2-deepseek' };
    var to = MOVED[decodeURIComponent(location.hash.slice(1))];
    if (to) { location.replace(ROOT + to); return; }
  }
  // a hash that points into a closed <details> (e.g. #round1) opens it
  function openTarget() {
    var id = decodeURIComponent(location.hash.slice(1)); if (!id) return;
    var t = document.getElementById(id); if (!t) return;
    for (var d = t; d; d = d.parentElement) if (d.tagName === 'DETAILS') d.open = true;
    if (t.tagName === 'DETAILS') t.open = true;
  }
  openTarget(); window.addEventListener('hashchange', openTarget);

  // 1. Top bar: mobile Menu sheet (focus trap, Esc, closes on link tap, locks body scroll)
  var bar = $('#topbar'), btn = $('.menubtn'), sheet = $('#sheet');
  function sheetFocusables() { return [btn].concat($$('a[href], button', sheet)); }
  function setMenu(open) {
    if (!sheet) return;
    sheet.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
    text($('.menubtn__t', btn), open ? 'Close' : 'Menu'); text($('.menubtn__i', btn), open ? '✕' : '☰');
    document.body.classList.toggle('menu-open', open);
    if (open) { bar.classList.remove('is-hidden'); var f = $('a', sheet); if (f) f.focus(); }
  }
  if (btn && sheet) {
    btn.addEventListener('click', function () { setMenu(sheet.hidden); });
    sheet.addEventListener('click', function (e) { if (e.target.closest('a')) setMenu(false); });
    document.addEventListener('keydown', function (e) {
      if (sheet.hidden) return;
      if (e.key === 'Escape') { setMenu(false); btn.focus(); return; }
      if (e.key !== 'Tab') return;
      var f = sheetFocusables(), i = f.indexOf(document.activeElement);
      if (e.shiftKey && (i <= 0)) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
    });
    MOBILE.addEventListener('change', function (m) { if (!m.matches) setMenu(false); });
  }

  // 1b. Mobile: the bar slides away on scroll down past 200 px and comes back on any scroll up (never while focus is in it; off under reduced motion)
  if (bar) {
    var lastY = window.scrollY, ticking = false;
    window.addEventListener('scroll', function () {
      if (ticking) return; ticking = true;
      requestAnimationFrame(function () {
        ticking = false;
        var y = window.scrollY, hide = MOBILE.matches && !REDUCED.matches && y > 200 && y > lastY && !bar.contains(document.activeElement) && !document.body.classList.contains('menu-open');
        if (y < lastY || !MOBILE.matches || REDUCED.matches) hide = false;
        if (Math.abs(y - lastY) > 4) { bar.classList.toggle('is-hidden', hide); lastY = y; }
      });
    }, { passive: true });
    bar.addEventListener('focusin', function () { bar.classList.remove('is-hidden'); });
  }

  // 1c. What's-new ribbon: dismissal stored as localStorage['cm-news'] = the item's id; a new id shows the ribbon again
  each('.ribbon__x', function (x) {
    x.addEventListener('click', function () {
      var r = x.closest('.ribbon');
      try { localStorage.setItem('cm-news', r.getAttribute('data-news')); } catch (e) { /* private mode: hide for this page only */ }
      DOC.classList.add('news-off');
      var m = $('#main'); if (m) { m.setAttribute('tabindex', '-1'); m.focus({ preventScroll: true }); }
    });
  });

  // 1d. Home scroll-spy: aria-current="location" follows Play / Milestones teaser / Results tiles (underline + colour, not colour alone)
  if (PAGE === 'home' && 'IntersectionObserver' in window) {
    var links = {}; each('.nav a[data-nav]', function (a) { links[a.getAttribute('data-nav')] = a; });
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        var a = links[en.target.getAttribute('data-spy-section')]; if (!a) return;
        if (en.isIntersecting) { Object.keys(links).forEach(function (k) { if (links[k].getAttribute('aria-current') === 'location') links[k].removeAttribute('aria-current'); }); a.setAttribute('aria-current', 'location'); }
        else if (a.getAttribute('aria-current') === 'location') a.removeAttribute('aria-current');
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    each('[data-spy-section]', function (s) { io.observe(s); });
  }

  // 1e. Relative "updated … ago" next to absolute ET times
  function ago(iso) {
    var ms = Date.now() - new Date(iso).getTime(); if (!isFinite(ms) || ms < 0) return '';
    var m = Math.round(ms / 60000); if (m < 60) return m + ' min ago';
    var h = Math.round(m / 60); if (h < 48) return h + ' h ago';
    return Math.round(h / 24) + ' days ago';
  }
  each('time[data-rel]', function (t) { var a = ago(t.getAttribute('datetime')); if (a) { t.title = t.textContent; t.appendChild(document.createTextNode(' (' + a + ')')); } });

  // 1f. Milestones dot (14 days after the newest milestone tag) + "Last refreshed" (newest `generated` across data/*.json)
  var gens = [];
  function refreshed() {
    var g = gens.filter(Boolean).sort(); if (!g.length) return;
    each('[data-refreshed]', function (s) { text(s, g[g.length - 1]); });
  }
  getJSON('data/milestones.json').then(function (d) {
    gens.push(d.generated); refreshed();
    if (d.latest_at && Date.now() - new Date(d.latest_at).getTime() < 14 * 864e5) each('.nav .dot', function (x) { x.hidden = false; });
  }).catch(function () {});
  ['data/costs.json', 'data/gemini.json'].forEach(function (u) { getJSON(u).then(function (d) { gens.push(d.generated); refreshed(); }).catch(function () {}); });

  // 2. Build commit + tag from <folder>/BUILD.txt ("<harness> <commit> <tag>")
  GAMES.forEach(function (g) {
    var sel = '[data-build="' + g + '"]';
    if (!$(sel)) return;
    getText(g + '/BUILD.txt').then(function (t) {
      var parts = t.trim().split(/\s+/);
      each(sel, function (e) { text(e, parts.length >= 3 ? parts[1] + ' · ' + parts.slice(2).join(' ') : t.trim()); });
    }).catch(function () { each(sel, function (e) { text(e, 'see ' + g + '/BUILD.txt'); }); });
  });
  GAMES.forEach(function (g) {
    var sel = '[data-build-classic="' + g + '"]';
    if (!$(sel)) return;
    getText('classic/' + g + '/BUILD.txt').then(function (t) {
      var parts = t.trim().split(/\s+/);
      each(sel, function (e) { text(e, parts.length >= 3 ? parts[1] + ' · pre-assets (' + parts.slice(2).join(' ') + ')' : t.trim()); });
    }).catch(function () { each(sel, function (e) { text(e, 'see classic/' + g + '/BUILD.txt'); }); });
  });

  // 3. Assets v2 measurements (results page) from data/v2.json: verify result, software-rendering FPS, attempts, known issues
  function stat(dl, label, value, sub) {
    var d = el('div'), dd = el('dd', null, value);
    if (sub) { dd.appendChild(document.createElement('br')); dd.appendChild(el('span', 'v2stats__sub', sub)); }
    d.appendChild(el('dt', null, label)); d.appendChild(dd); dl.appendChild(d);
  }
  var fmtFps = function (v) { return (v < 10 ? v.toFixed(1) : String(Math.round(v * 10) / 10)) + ' FPS'; };
  var COSTS = null;
  if ($('.v2data')) getJSON('data/v2.json').then(function (data) {
    var H = data.harness || {};
    GAMES.forEach(function (g) {
      var h = H[g], box = $('.v2data[data-v2="' + g + '"]');
      if (!h || !box) return;
      if (h.iter) each('[data-v2="' + g + '"][data-k="iter"]', function (e) { text(e, h.iter); });
      box.innerHTML = '';
      var ok = el('p', 'v2verify ' + (h.verify_ok ? 'is-ok' : 'is-fail'));
      ok.appendChild(el('strong', null, h.verify_ok ? '✓ Final automated check: passed' : '✗ Final automated check: failed'));
      box.appendChild(ok);
      if (h.attempts) box.appendChild(el('p', 'v2attempts', 'Attempts needed: ' + h.attempts + '.'));
      box.appendChild(el('h4', 'v2h', 'Software-rendering FPS (no GPU)'));
      var dl = el('dl', 'v2stats');
      if (h.fps) {
        if (h.fps.nj_low != null) stat(dl, 'New Jersey, Low', fmtFps(h.fps.nj_low));
        if (h.fps.tiraspol_low != null) stat(dl, 'Tiraspol, Low', fmtFps(h.fps.tiraspol_low));
        if (h.fps.tiraspol_high != null) stat(dl, 'Tiraspol, High', fmtFps(h.fps.tiraspol_high));
      }
      if (h.load_seconds != null) stat(dl, 'Load time (software)', h.load_seconds.toFixed(1) + ' s');
      if (h.hits_to_fell_nj != null) stat(dl, 'Hits to fell a tree (NJ)', String(h.hits_to_fell_nj));
      box.appendChild(dl);
      box.appendChild(el('p', 'v2fine', 'Not real-GPU numbers: a graphics card is far faster.'));
      var issues = h.known_issues || [];
      if (issues.length) {
        box.appendChild(el('h4', 'v2h', 'Known issues'));
        var ul = el('ul', 'v2issues');
        issues.slice(0, 3).forEach(function (s) { ul.appendChild(el('li', null, s)); });
        box.appendChild(ul);
        box.appendChild(el('p', 'v2fine', (issues.length > 3 ? '3 of ' + issues.length + ' known issues' : 'Known issues') + ' listed in the repo’s README/CHANGELOG.'));
      }
      var cost = el('div', 'v2cost'); cost.setAttribute('data-v2cost', g);
      cost.appendChild(el('p', 'v2fine', 'Loading cost…'));
      box.appendChild(cost);
      fillV2Cost();
    });
    if (data.note) text($('#v2-note'), 'Data note: ' + data.note);
  }).catch(function () {
    each('.v2data', function (b) { b.innerHTML = ''; b.appendChild(el('p', 'card__note', 'Build data could not be loaded (data/v2.json).')); });
  });
  function fillV2Cost() {
    if (!COSTS) return;
    var H = COSTS.harness || {}, B = COSTS.basis || {};
    GAMES.forEach(function (g) {
      var box = $('[data-v2cost="' + g + '"]'), h = H[g];
      if (!box || !h || box.getAttribute('data-done')) return;
      box.setAttribute('data-done', '1');
      box.innerHTML = '';
      box.appendChild(el('h4', 'v2h', 'What it cost'));
      var dl = el('dl', 'v2stats v2stats--cost');
      if (h.assets_v2_cost_usd != null) stat(dl, 'Assets v2 phase', '$' + h.assets_v2_cost_usd.toFixed(2), h.assets_v2_runs + ' runs · ' + h.assets_v2_wall_h.toFixed(1) + ' agent h');
      stat(dl, 'Project total', '$' + h.cost_usd.toFixed(2), h.runs + ' runs · ' + h.wall_h.toFixed(1) + ' agent h');
      box.appendChild(dl);
      if (B[g]) box.appendChild(el('p', 'v2fine', 'Basis: ' + B[g] + '.'));
    });
  }

  // 4. Scoreboard: highlight the best in each row
  function markBest(row, getVal, lowerIsBetter) {
    var cells = Array.prototype.slice.call(row.querySelectorAll('td'));
    var vals = cells.map(getVal);
    var ok = vals.filter(function (v) { return isFinite(v); });
    if (ok.length < 2) return;
    var best = lowerIsBetter ? Math.min.apply(null, ok) : Math.max.apply(null, ok);
    if (ok.every(function (v) { return v === best; })) return; // all tied: no highlight
    cells.forEach(function (c, i) { c.classList.toggle('top', vals[i] === best); });
  }
  each('.scoreboard tbody tr', function (row) {
    if (!row.querySelector('td[data-v]')) return;
    markBest(row, function (c) { return parseFloat(c.getAttribute('data-v')); }, false);
  });

  // 5. Cost data from data/costs.json: scoreboard cost rows (results), the bill (cost), glance tiles (home), v2 cost blocks (results)
  var fmtUSD = function (v) { return '$' + v.toFixed(2); };
  var fmtTok = function (v) { return v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(1) + 'k' : String(v); };
  var fmtNum = function (v) { return v.toLocaleString('en-US'); };
  function basisParts(h) {
    var p = [];
    if (h.reported_usd) p.push(fmtUSD(h.reported_usd) + ' reported');
    if (h.token_priced_usd) p.push(fmtUSD(h.token_priced_usd) + ' token-priced');
    if (h.est_usd) p.push('est. ' + fmtUSD(h.est_usd));
    return p.join(' + ');
  }
  var needCosts = $('[data-cost]') || $('#cost-table') || $('[data-glance]') || $('.v2data');
  if (needCosts) getJSON('data/costs.json').then(function (data) {
    COSTS = data; fillV2Cost();
    var H = data.harness || {};
    var rows = GAMES.filter(function (g) { return H[g]; }).map(function (g) {
      var h = H[g];
      return { g: g, h: h, perH: h.wall_h > 0 ? h.cost_usd / h.wall_h : NaN };
    });

    // home: results-at-a-glance tiles
    rows.forEach(function (r) {
      var t = $('[data-glance="' + r.g + '"]'); if (!t) return;
      text($('[data-k="total"]', t), fmtUSD(r.h.cost_usd));
      text($('[data-k="sub"]', t), 'Whole project: ' + r.h.runs + ' runs, ' + r.h.wall_h.toFixed(1) + ' agent h. ' + basisParts(r.h) + '.');
    });

    // results: scoreboard cost rows
    rows.forEach(function (r) {
      text($('[data-cost="' + r.g + '"][data-k="cost_usd"]'), fmtUSD(r.h.cost_usd));
      text($('[data-cost="' + r.g + '"][data-k="wall_h"]'), r.h.wall_h.toFixed(1) + ' h');
      text($('[data-cost="' + r.g + '"][data-k="per_h"]'), fmtUSD(r.perH) + '/h');
    });
    each('#sb-cost tr', function (row) {
      var k = row.querySelector('td') && row.querySelector('td').getAttribute('data-k');
      if (!k || k === 'wall_h') return;
      markBest(row, function (c) {
        var r = rows.filter(function (x) { return x.g === c.getAttribute('data-cost'); })[0];
        return r ? (k === 'per_h' ? r.perH : r.h.cost_usd) : NaN;
      }, true);
    });

    // cost page: the bill
    if (!$('#cost-table')) return;
    var sorted = rows.slice().sort(function (a, b) { return a.perH - b.perH; });
    var cheapest = sorted[0], next = sorted[1];
    var maxPerH = Math.max.apply(null, rows.map(function (r) { return r.perH; }));
    var lede = $('#cost-lede');
    if (cheapest && next && lede) {
      var ratio = next.perH / cheapest.perH;
      lede.className = 'costhead'; lede.innerHTML = '';
      lede.appendChild(el('strong', null, NAMES[cheapest.g] + (ratio >= 2 ? ' is by far' : ' is') + ' the cheapest per hour of agent work: ' + fmtUSD(cheapest.perH) + ' an hour'));
      lede.appendChild(document.createTextNode(', about ' + ratio.toFixed(1) + '× less than ' + NAMES[next.g] + ' (' + fmtUSD(next.perH) + ') and ' +
        (sorted[2] ? (sorted[2].perH / cheapest.perH).toFixed(0) + '× less than ' + NAMES[sorted[2].g] + ' (' + fmtUSD(sorted[2].perH) + ')' : '') + '.'));
    }
    var ph = $('#cost-perhour');
    ph.setAttribute('aria-label', 'Cost per agent hour');
    rows.forEach(function (r) {
      var row = el('div', 'ph-row' + (r === cheapest ? ' best' : ''));
      row.innerHTML = '<span class="ph-name"></span><span class="ph-track" aria-hidden="true"><span class="ph-fill"></span></span><span class="ph-val"></span>';
      text($('.ph-name', row), NAMES[r.g]);
      $('.ph-fill', row).style.width = (r.perH / maxPerH * 100).toFixed(1) + '%';
      $('.ph-fill', row).style.display = 'block';
      text($('.ph-val', row), fmtUSD(r.perH) + '/h');
      ph.appendChild(row);
    });
    var labels = ['Harness', 'Runs', 'Agent hours', 'Tokens in, uncached', 'Tokens in, cached', 'Tokens out', 'Project total (USD)', 'Assets v2 phase', 'Per agent hour'];
    var tbody = $('#cost-table tbody');
    tbody.innerHTML = '';
    rows.forEach(function (r) {
      var tr = document.createElement('tr');
      if (r === cheapest) tr.className = 'best';
      var v2 = r.h.assets_v2_cost_usd != null ? fmtUSD(r.h.assets_v2_cost_usd) : 'n/a';
      var v2sub = r.h.assets_v2_cost_usd != null ? r.h.assets_v2_runs + ' runs · ' + r.h.assets_v2_wall_h.toFixed(2) + ' h' : '';
      var vals = [NAMES[r.g], fmtNum(r.h.runs), r.h.wall_h.toFixed(2), fmtTok(r.h.input_uncached), fmtTok(r.h.input_cached), fmtTok(r.h.output), fmtUSD(r.h.cost_usd), v2, fmtUSD(r.perH)];
      var full = [null, null, null, fmtNum(r.h.input_uncached), fmtNum(r.h.input_cached), fmtNum(r.h.output), null, null, null];
      vals.forEach(function (v, i) {
        var td = document.createElement('td');
        td.setAttribute('data-label', labels[i]);
        if (i === 6 && r.h.reported_usd != null) {
          td.className = 'v2col';
          var wt = el('span', 'v2col__v'); wt.appendChild(el('b', null, v));
          wt.appendChild(el('span', 'v2col__sub', basisParts(r.h)));
          td.appendChild(wt);
        } else if (i === 7 && v2sub) {
          td.className = 'v2col';
          var wrapv = el('span', 'v2col__v'); wrapv.appendChild(el('b', null, v)); wrapv.appendChild(el('span', 'v2col__sub', v2sub));
          td.appendChild(wrapv);
        } else td.textContent = v;
        if (full[i]) td.title = full[i] + ' tokens';
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    var basis = $('#cost-basis');
    rows.forEach(function (r) {
      if (!data.basis || !data.basis[r.g]) return;
      var d = el('div'); d.appendChild(el('dt', null, NAMES[r.g])); d.appendChild(el('dd', null, data.basis[r.g])); basis.appendChild(d);
    });
    text($('#cost-generated'), 'Generated ' + (data.generated || 'unknown') + ' from the usage log, the same totals as the “Behind the build” post below. “Agent hours” are the wall-clock hours recorded across all runs. Bases differ, so compare with care.');
    var bal = data.deepseek_balance_measured;
    if (bal && bal.spent_usd != null && H.deepseek) {
      text($('#cost-balance'), 'Footnote: the DeepSeek account balance was also measured directly. It dropped by ' + fmtUSD(bal.spent_usd) +
        ' over the whole project (checked ' + (bal.checked || 'unknown') + '), against the ' + fmtUSD(H.deepseek.cost_usd) + ' estimated from tokens above.');
    }
  }).catch(function () {
    var tbody = $('#cost-table tbody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="9">Cost data could not be loaded (data/costs.json).</td></tr>';
    each('[data-cost]', function (c) { c.textContent = 'n/a'; });
    each('[data-glance] [data-k="total"]', function (c) { c.textContent = 'Cost: see the cost page'; });
    each('[data-v2cost]', function (c) { c.innerHTML = ''; c.appendChild(el('p', 'v2fine', 'Cost data could not be loaded (data/costs.json).')); });
  });
  var gt = $('[data-glance-gemini]');
  if (gt) getJSON('data/gemini.json').then(function (d) {
    if (d.cost_usd_est == null) return;
    text($('[data-k="total"]', gt), 'est. ' + fmtUSD(d.cost_usd_est));
    text($('[data-k="sub"]', gt), 'So far: ' + d.runs + ' runs, ' + d.wall_h.toFixed(1) + ' agent h. Login-based, not billed: est. = measured tokens × list price, kept out of the other totals.');
  }).catch(function () { text($('[data-k="total"]', gt), 'est.: see the cost page'); });

  // 6. Milestones gallery: Compare-harnesses grid <-> one-harness timeline (state in the URL), harness tabs, lightbox
  var ms = $('.ms');
  if (ms && $('#ms-grid')) {
    var HS = ['codex', 'claude', 'deepseek', 'gemini'];
    var tabs = $$('.ms-tabs [role="tab"]');
    function readURL() {
      var q = new URLSearchParams(location.search);
      return { view: q.get('view') === 'harness' ? 'harness' : 'grid', h: HS.indexOf(q.get('h')) >= 0 ? q.get('h') : 'codex' };
    }
    function apply(st) {
      ms.setAttribute('data-view', st.view);
      each('.seg button', function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-view') === st.view)); });
      tabs.forEach(function (t) {
        var on = t.id === 'tab-' + st.h;
        t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1;
        document.getElementById(t.getAttribute('aria-controls')).classList.toggle('is-on', on);
      });
    }
    function go(st, push) {
      var q = new URLSearchParams(location.search);
      if (st.view === 'harness') q.set('view', 'harness'); else q.delete('view');
      if (st.view === 'harness' || MOBILE.matches || st.h !== 'codex') q.set('h', st.h); else q.delete('h');
      var url = location.pathname + (q.toString() ? '?' + q.toString() : '');
      if (push) history.pushState(st, '', url); else history.replaceState(st, '', url);
      apply(st);
    }
    apply(readURL());
    window.addEventListener('popstate', function () { apply(readURL()); });
    each('.seg button', function (b) { b.addEventListener('click', function () { var st = readURL(); st.view = b.getAttribute('data-view'); go(st, true); }); });
    tabs.forEach(function (t, i) {
      t.addEventListener('click', function () { var st = readURL(); st.h = t.id.slice(4); if (!MOBILE.matches) st.view = 'harness'; go(st, true); });
      t.addEventListener('keydown', function (e) {
        var k = e.key, j = k === 'ArrowRight' ? i + 1 : k === 'ArrowLeft' ? i - 1 : k === 'Home' ? 0 : k === 'End' ? tabs.length - 1 : null;
        if (j == null) return; e.preventDefault(); j = (j + tabs.length) % tabs.length; tabs[j].focus(); tabs[j].click();
      });
    });

    // lightbox
    var dlg = $('#lightbox'), img = $('.lightbox__img', dlg), cmp = $('.lightbox__cmp', dlg), stage = $('.lightbox__stage', dlg);
    var cap = $('.lightbox__cap', dlg), count = $('.lightbox__count', dlg), cmpBtn = $('.lightbox__cmpbtn', dlg), cmpCtl = $('.lightbox__cmpctl', dlg), range = $('.lightbox__range', dlg);
    var seq = [], idx = 0, opener = null, comparing = false;
    var ROWNAME = { v1: 'v1', v2: 'v2', classic: 'Classic final', assets: 'Assets v2', polish: 'Polish', coop: 'Co-op + voice' };
    function harnessSeq(h) { return $$('#tl-' + h + ' .tl figure[data-full]'); }
    function prevMilestone(f) {
      if (f.getAttribute('data-row') === 'film') return null;
      var s = harnessSeq(f.getAttribute('data-h')), row = f.getAttribute('data-row');
      for (var i = 0; i < s.length; i++) if (s[i].getAttribute('data-row') === row) return i > 0 ? s[i - 1] : null;
      return null;
    }
    function show(i) {
      idx = (i + seq.length) % seq.length;
      var f = seq[idx], p = prevMilestone(f);
      img.src = f.getAttribute('data-full'); img.alt = f.getAttribute('data-alt') || '';
      text(cap, f.getAttribute('data-cap') || '');
      text(count, (idx + 1) + ' / ' + seq.length);
      cmpBtn.hidden = !p;
      if (!p) setCompare(false); else if (comparing) setCompare(true);
      var n = seq[(idx + 1) % seq.length]; if (n && n !== f) { var pre = new Image(); pre.src = n.getAttribute('data-full'); } // preload only the next one
    }
    function setCompare(on) {
      var f = seq[idx], p = on ? prevMilestone(f) : null;
      comparing = !!p;
      cmpBtn.setAttribute('aria-pressed', String(comparing));
      cmpCtl.hidden = !comparing; cmp.hidden = !comparing; stage.classList.toggle('is-cmp', comparing);
      if (comparing) {
        // left of the line: the previous milestone; right: this one
        cmp.src = f.getAttribute('data-full'); cmp.alt = f.getAttribute('data-alt') || '';
        img.src = p.getAttribute('data-full'); img.alt = p.getAttribute('data-alt') || '';
        text($('.lightbox__cmplabel', dlg), 'Left: ' + ROWNAME[p.getAttribute('data-row')] + ' · Right: ' + ROWNAME[f.getAttribute('data-row')]);
        stage.style.setProperty('--cut', range.value + '%');
      } else { img.src = f.getAttribute('data-full'); img.alt = f.getAttribute('data-alt') || ''; }
    }
    range.addEventListener('input', function () { stage.style.setProperty('--cut', range.value + '%'); });
    document.addEventListener('click', function (e) {
      var b = e.target.closest('.shot__open'); if (!b) return;
      var f = b.closest('figure[data-full]'); if (!f) return;
      if (f.closest('.ms-grid')) seq = $$('.ms-grid figure[data-full][data-row="' + f.getAttribute('data-row') + '"]');
      else if (f.closest('.film')) seq = $$('figure[data-full]', f.closest('.film'));
      else seq = harnessSeq(f.getAttribute('data-h'));
      opener = b; comparing = false; range.value = 50;
      show(seq.indexOf(f));
      if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
      $('[data-lb="close"]', dlg).focus();
    });
    dlg.addEventListener('click', function (e) {
      var a = e.target.closest('[data-lb]'); if (!a) { if (e.target === dlg) dlg.close(); return; }
      var k = a.getAttribute('data-lb');
      if (k === 'close') dlg.close(); else if (k === 'prev') { comparing = false; show(idx - 1); } else if (k === 'next') { comparing = false; show(idx + 1); } else if (k === 'compare') setCompare(!comparing);
    });
    dlg.addEventListener('keydown', function (e) {
      if (e.target === range) return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); comparing = false; show(idx - 1); }
      if (e.key === 'ArrowRight') { e.preventDefault(); comparing = false; show(idx + 1); }
    });
    dlg.addEventListener('close', function () { setCompare(false); if (opener) opener.focus(); });
    var sx = null;
    stage.addEventListener('pointerdown', function (e) { if (e.pointerType !== 'mouse') sx = e.clientX; });
    stage.addEventListener('pointerup', function (e) { if (sx == null) return; var dx = e.clientX - sx; sx = null; if (Math.abs(dx) > 50 && !comparing) show(idx + (dx < 0 ? 1 : -1)); });
  }
})();

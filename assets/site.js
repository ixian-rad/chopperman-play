// Chopperman landing page: live build tags, Assets v2 card data, scoreboard highlights, cost table.
(function () {
  'use strict';
  var GAMES = ['codex', 'claude', 'deepseek'];
  var NAMES = { codex: 'Codex', claude: 'Claude', deepseek: 'DeepSeek' };

  function text(el, s) { if (el) el.textContent = s; }
  function getText(url) {
    return fetch(url, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error(url + ' ' + r.status);
      return r.text();
    });
  }

  // 1. Build commit + tag from <folder>/BUILD.txt ("<harness> <commit> <tag>")
  function each(sel, fn) { Array.prototype.forEach.call(document.querySelectorAll(sel), fn); }
  GAMES.forEach(function (g) {
    var sel = '[data-build="' + g + '"]';
    getText(g + '/BUILD.txt').then(function (t) {
      var parts = t.trim().split(/\s+/);
      each(sel, function (el) { text(el, parts.length >= 3 ? parts[1] + ' · ' + parts.slice(2).join(' ') : t.trim()); });
    }).catch(function () { each(sel, function (el) { text(el, 'see ' + g + '/BUILD.txt'); }); });
  });

  // 1b. Classic (pre-assets) builds from classic/<folder>/BUILD.txt
  GAMES.forEach(function (g) {
    var sel = '[data-build-classic="' + g + '"]';
    if (!document.querySelector(sel)) return;
    getText('classic/' + g + '/BUILD.txt').then(function (t) {
      var parts = t.trim().split(/\s+/);
      each(sel, function (el) { text(el, parts.length >= 3 ? parts[1] + ' · pre-assets (' + parts.slice(2).join(' ') + ')' : t.trim()); });
    }).catch(function () { each(sel, function (el) { text(el, 'see classic/' + g + '/BUILD.txt'); }); });
  });

  // 1c. Assets v2 card data from data/v2.json (verify result, software-rendering FPS, attempts, known issues)
  function el(tag, cls, s) { var e = document.createElement(tag); if (cls) e.className = cls; if (s != null) e.textContent = s; return e; }
  function stat(dl, label, value, sub) {
    var d = el('div'), dd = el('dd', null, value);
    if (sub) { dd.appendChild(document.createElement('br')); dd.appendChild(el('span', 'v2stats__sub', sub)); }
    d.appendChild(el('dt', null, label)); d.appendChild(dd); dl.appendChild(d);
  }
  var fmtFps = function (v) { return (v < 10 ? v.toFixed(1) : String(Math.round(v * 10) / 10)) + ' FPS'; };
  getText('data/v2.json').then(function (raw) {
    var data = JSON.parse(raw), H = data.harness || {};
    GAMES.forEach(function (g) {
      var h = H[g], box = document.querySelector('.v2data[data-v2="' + g + '"]');
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
    if (data.note) text(document.getElementById('v2-note'), 'Data note: ' + data.note);
  }).catch(function () {
    each('.v2data', function (b) { b.innerHTML = ''; b.appendChild(el('p', 'card__note', 'Build data could not be loaded (data/v2.json).')); });
  });

  // v2 card cost block: filled once both data/v2.json and data/costs.json are in
  var COSTS = null;
  function fillV2Cost() {
    if (!COSTS) return;
    var H = COSTS.harness || {}, B = COSTS.basis || {};
    GAMES.forEach(function (g) {
      var box = document.querySelector('[data-v2cost="' + g + '"]'), h = H[g];
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

  // 2. Scoreboard: bar length per score cell and highlight the best in each row
  function markBest(row, getVal, lowerIsBetter) {
    var cells = Array.prototype.slice.call(row.querySelectorAll('td'));
    var vals = cells.map(getVal);
    var ok = vals.filter(function (v) { return isFinite(v); });
    if (ok.length < 2) return;
    var best = lowerIsBetter ? Math.min.apply(null, ok) : Math.max.apply(null, ok);
    if (ok.every(function (v) { return v === best; })) return; // all tied: no highlight
    cells.forEach(function (c, i) { c.classList.toggle('top', vals[i] === best); });
  }
  document.querySelectorAll('.scoreboard tbody tr').forEach(function (row) {
    var cells = row.querySelectorAll('td[data-v]');
    if (!cells.length) return;
    markBest(row, function (c) { return parseFloat(c.getAttribute('data-v')); }, false);
  });

  // 3. Cost data from data/costs.json
  var fmtUSD = function (v) { return '$' + v.toFixed(2); };
  var fmtTok = function (v) {
    if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M';
    if (v >= 1e3) return (v / 1e3).toFixed(1) + 'k';
    return String(v);
  };
  var fmtNum = function (v) { return v.toLocaleString('en-US'); };

  getText('data/costs.json').then(function (raw) {
    var data = JSON.parse(raw);
    COSTS = data; fillV2Cost();
    var H = data.harness || {};
    var rows = GAMES.filter(function (g) { return H[g]; }).map(function (g) {
      var h = H[g];
      return { g: g, h: h, perH: h.wall_h > 0 ? h.cost_usd / h.wall_h : NaN };
    });

    // scoreboard cost rows
    rows.forEach(function (r) {
      text(document.querySelector('[data-cost="' + r.g + '"][data-k="cost_usd"]'), fmtUSD(r.h.cost_usd));
      text(document.querySelector('[data-cost="' + r.g + '"][data-k="wall_h"]'), r.h.wall_h.toFixed(1) + ' h');
      text(document.querySelector('[data-cost="' + r.g + '"][data-k="per_h"]'), fmtUSD(r.perH) + '/h');
    });
    document.querySelectorAll('#sb-cost tr').forEach(function (row) {
      var k = row.querySelector('td') && row.querySelector('td').getAttribute('data-k');
      if (!k || k === 'wall_h') return;
      markBest(row, function (c) {
        var r = rows.filter(function (x) { return x.g === c.getAttribute('data-cost'); })[0];
        return r ? (k === 'per_h' ? r.perH : r.h.cost_usd) : NaN;
      }, true);
    });

    // cheapest per agent hour
    var sorted = rows.slice().sort(function (a, b) { return a.perH - b.perH; });
    var cheapest = sorted[0], next = sorted[1];
    var maxPerH = Math.max.apply(null, rows.map(function (r) { return r.perH; }));

    var lede = document.getElementById('cost-lede');
    if (cheapest && next) {
      var ratio = next.perH / cheapest.perH;
      lede.className = 'costhead';
      lede.innerHTML = '';
      var strong = document.createElement('strong');
      strong.textContent = NAMES[cheapest.g] + (ratio >= 2 ? ' is by far' : ' is') + ' the cheapest per hour of agent work: ' + fmtUSD(cheapest.perH) + ' an hour';
      lede.appendChild(strong);
      lede.appendChild(document.createTextNode(', about ' + ratio.toFixed(1) + '× less than ' + NAMES[next.g] + ' (' + fmtUSD(next.perH) + ') and ' +
        (sorted[2] ? (sorted[2].perH / cheapest.perH).toFixed(0) + '× less than ' + NAMES[sorted[2].g] + ' (' + fmtUSD(sorted[2].perH) + ')' : '') + '.'));
    }

    var ph = document.getElementById('cost-perhour');
    ph.setAttribute('aria-label', 'Cost per agent hour');
    rows.forEach(function (r) {
      var row = document.createElement('div');
      row.className = 'ph-row' + (r === cheapest ? ' best' : '');
      row.innerHTML = '<span class="ph-name"></span><span class="ph-track" aria-hidden="true"><span class="ph-fill"></span></span><span class="ph-val"></span>';
      row.querySelector('.ph-name').textContent = NAMES[r.g];
      row.querySelector('.ph-fill').style.width = (r.perH / maxPerH * 100).toFixed(1) + '%';
      row.querySelector('.ph-fill').style.display = 'block';
      row.querySelector('.ph-val').textContent = fmtUSD(r.perH) + '/h';
      ph.appendChild(row);
    });

    // full table
    var labels = ['Harness', 'Runs', 'Agent hours', 'Tokens in, uncached', 'Tokens in, cached', 'Tokens out', 'Project total (USD)', 'Assets v2 phase', 'Per agent hour'];
    var tbody = document.querySelector('#cost-table tbody');
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
          var parts = [];
          if (r.h.reported_usd) parts.push(fmtUSD(r.h.reported_usd) + ' reported');
          if (r.h.token_priced_usd) parts.push(fmtUSD(r.h.token_priced_usd) + ' token-priced');
          if (r.h.est_usd) parts.push('est. ' + fmtUSD(r.h.est_usd));
          wt.appendChild(el('span', 'v2col__sub', parts.join(' + ')));
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

    var basis = document.getElementById('cost-basis');
    rows.forEach(function (r) {
      if (!data.basis || !data.basis[r.g]) return;
      var d = document.createElement('div');
      var dt = document.createElement('dt'); dt.textContent = NAMES[r.g];
      var dd = document.createElement('dd'); dd.textContent = data.basis[r.g];
      d.appendChild(dt); d.appendChild(dd); basis.appendChild(d);
    });
    text(document.getElementById('cost-generated'), 'Generated ' + (data.generated || 'unknown') + ' from the usage log, the same totals as the “Behind the build” post below. “Agent hours” are the wall-clock hours recorded across all runs. Bases differ, so compare with care.');
    var bal = data.deepseek_balance_measured;
    if (bal && bal.spent_usd != null && H.deepseek) {
      text(document.getElementById('cost-balance'), 'Footnote: the DeepSeek account balance was also measured directly. It dropped by ' + fmtUSD(bal.spent_usd) +
        ' over the whole project (checked ' + (bal.checked || 'unknown') + '), against the ' + fmtUSD(H.deepseek.cost_usd) + ' estimated from tokens above.');
    }
  }).catch(function () {
    var tbody = document.querySelector('#cost-table tbody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="9">Cost data could not be loaded (data/costs.json).</td></tr>';
    document.querySelectorAll('[data-cost]').forEach(function (c) { c.textContent = 'n/a'; });
    each('[data-v2cost]', function (c) { c.innerHTML = ''; c.appendChild(el('p', 'v2fine', 'Cost data could not be loaded (data/costs.json).')); });
  });
})();

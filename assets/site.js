// Chopperman landing page: live build tags, scoreboard highlights, cost table.
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
  GAMES.forEach(function (g) {
    var el = document.querySelector('[data-build="' + g + '"]');
    getText(g + '/BUILD.txt').then(function (t) {
      var parts = t.trim().split(/\s+/);
      text(el, parts.length >= 3 ? parts[1] + ' · ' + parts.slice(2).join(' ') : t.trim());
    }).catch(function () { text(el, 'see ' + g + '/BUILD.txt'); });
  });

  // 1b. Classic (pre-assets) builds from classic/<folder>/BUILD.txt
  GAMES.forEach(function (g) {
    var el = document.querySelector('[data-build-classic="' + g + '"]');
    if (!el) return;
    getText('classic/' + g + '/BUILD.txt').then(function (t) {
      var parts = t.trim().split(/\s+/);
      text(el, parts.length >= 3 ? parts[1] + ' · pre-assets (' + parts.slice(2).join(' ') + ')' : t.trim());
    }).catch(function () { text(el, 'see classic/' + g + '/BUILD.txt'); });
  });

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
    var labels = ['Harness', 'Runs', 'Agent hours', 'Tokens in, uncached', 'Tokens in, cached', 'Tokens out', 'Cost (USD)', 'Per agent hour'];
    var tbody = document.querySelector('#cost-table tbody');
    tbody.innerHTML = '';
    rows.forEach(function (r) {
      var tr = document.createElement('tr');
      if (r === cheapest) tr.className = 'best';
      var vals = [NAMES[r.g], fmtNum(r.h.runs), r.h.wall_h.toFixed(2), fmtTok(r.h.input_uncached), fmtTok(r.h.input_cached), fmtTok(r.h.output), fmtUSD(r.h.cost_usd), fmtUSD(r.perH)];
      var full = [null, null, null, fmtNum(r.h.input_uncached), fmtNum(r.h.input_cached), fmtNum(r.h.output), null, null];
      vals.forEach(function (v, i) {
        var td = document.createElement('td');
        td.setAttribute('data-label', labels[i]);
        td.textContent = v;
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
    text(document.getElementById('cost-generated'), 'Generated ' + (data.generated || 'unknown') + ' from the usage log. “Agent hours” are the wall-clock hours recorded across all runs. Bases differ, so compare with care.');
  }).catch(function () {
    var tbody = document.querySelector('#cost-table tbody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="8">Cost data could not be loaded (data/costs.json).</td></tr>';
    document.querySelectorAll('[data-cost]').forEach(function (c) { c.textContent = 'n/a'; });
  });
})();

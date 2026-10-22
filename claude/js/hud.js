// DOM HUD: progression panel, log card + queue, meter, conditions, toasts, hit card, telemetry,
// shop and help modals.
import { AXES, SKILLS, HONE_TIERS, GLOVES_PRICE, SHARPEN_PRICE, TRAITS } from './data.js';
import { STAGES, CHALLENGES, todayKey } from './modes.js';

const $ = (id) => document.getElementById(id);
const pct = (v) => `${Math.round(v * 100)}%`;
const fmtHour = (h) => {
  const hh = Math.floor(h), mm = Math.floor((h - hh) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
};

export class Hud {
  constructor(game, weather) {
    this.game = game;
    this.weather = weather;
    this.shopTab = 'axes';
    this.hitTimer = null;
    game.on('toast', (t) => this.toast(t));
    game.on('hit', (h) => this.showHit(h));
    game.on('change', () => { this.dirty = true; if (!$('shop').classList.contains('hidden')) this.renderShop(); });
    game.on('log', () => { this.dirty = true; });
    game.on('modeEnd', (sum) => this.showSummary(sum));
    this.bindShop();
    this.bindModes();
    this.dirty = true;
  }

  toast({ text, kind = 'info', big = false }) {
    const el = document.createElement('div');
    el.className = `toast ${kind}${big ? ' big' : ''}`;
    el.textContent = text;
    const box = $('toasts');
    box.appendChild(el);
    while (box.children.length > 4) box.firstChild.remove();
    setTimeout(() => el.classList.add('out'), big ? 2600 : 1900);
    setTimeout(() => el.remove(), big ? 3100 : 2400);
  }

  showHit(h) {
    const el = $('hitcard');
    el.className = h.result;
    const pts = h.points > 0 ? `+${h.points}` : h.points < 0 ? `${h.points}` : '';
    const extra = [];
    if (h.xp) extra.push(`+${h.xp} XP`);
    if (h.cash) extra.push(`+$${h.cash}`);
    el.innerHTML = `
      <div class="grade">${h.grade}</div>
      ${pts ? `<div class="pts ${h.points < 0 ? 'neg' : ''}">${pts}</div>` : ''}
      <div class="lab">${[...h.labels, ...extra].join(' · ')}</div>
      <div class="phys">${h.headSpeed} m/s · ${h.energy} J vs ${h.required || '—'} J${h.depthCm ? ` · edge sank ${h.depthCm} cm` : ''} · ${h.offsetCm} cm off the pith</div>`;
    clearTimeout(this.hitTimer);
    this.hitTimer = setTimeout(() => el.classList.add('hidden'), 3200);
  }

  // Only touch the DOM when a value actually changes (style/layout work is expensive with
  // software compositing).
  setCached(el, key, v) {
    const k = this.cache ??= new WeakMap();
    let m = k.get(el);
    if (!m) { m = {}; k.set(el, m); }
    if (m[key] === v) return;
    m[key] = v;
    if (key.startsWith('style.')) el.style[key.slice(6)] = v;
    else el[key] = v;
  }
  txt(id, v) { this.setCached($(id), 'textContent', String(v)); }
  html(id, v) { this.setCached($(id), 'innerHTML', v); }
  sty(id, prop, v) { this.setCached($(id), 'style.' + prop, v); }

  update(fps, quality) {
    const g = this.game, p = g.p;
    this.txt('h-level', p.level);
    this.sty('h-xp', 'width', pct(Math.min(1, p.xp / g.xpNext)));
    this.txt('h-xptext', `${p.xp} / ${g.xpNext} XP${p.skillPoints ? ` · ${p.skillPoints} skill pt` : ''}`);
    this.txt('h-score', p.score.toLocaleString());
    const c = $('h-combo');
    c.textContent = g.combo > 1 ? `×${g.combo} (+${Math.round(15 * Math.min(g.combo - 1, 12))}%)` : g.combo === 1 ? '1' : '—';
    c.classList.toggle('hot', g.combo > 2);
    this.txt('h-cash', `$${p.cash.toLocaleString()}`);
    const fr = g.stamina / g.maxStamina;
    this.sty('h-stam', 'width', pct(fr));
    this.txt('h-stamtext', `Stamina ${Math.round(g.stamina)} / ${g.maxStamina} · swing ≈${Math.round(g.costFor(0.86))}`);
    $('h-stam').parentElement.classList.toggle('low', g.stamina < g.costFor(0.86));
    const a = g.axeStats;
    this.txt('h-axe', `${a.name} · ${(a.headMass * 2.2046).toFixed(1)} lb`);
    this.txt('h-sharp', `Edge ${pct(g.sharpness)}`);
    this.txt('h-pile', `${p.woodpile} pieces`);
    this.txt('btn-sharpen', `Sharpen $${SHARPEN_PRICE}`);

    // Log card.
    const log = g.logs.log;
    const cond = this.weather.conditions;
    if (log) {
      const P = log.params;
      this.txt('h-logname', P.species.name);
      this.txt('h-logsize', `Ø${Math.round(P.R * 200)} × ${Math.round(P.H * 100)} cm`);
      const tags = [];
      if (P.knots.length) tags.push(`<span class="tag knot">${P.knots.length} knot${P.knots.length > 1 ? 's' : ''}</span>`);
      if (P.nail) tags.push('<span class="tag nail">nail head on bark</span>');
      tags.push(`<span class="tag check">${P.checks.length} check${P.checks.length > 1 ? 's' : ''}</span>`);
      if (P.species.interlocked) tags.push('<span class="tag knot">interlocked grain</span>');
      if (P.species.dulls) tags.push('<span class="tag nail">dulls the edge ×3</span>');
      for (const t of P.traits ?? []) {
        const T = TRAITS[t];
        if (t === 'iced' && !log.iceShell) { tags.push('<span class="tag frozen">glaze broken</span>'); continue; }
        if (T) tags.push(`<span class="tag ${T.tag}" title="${T.desc}">${T.icon} ${T.name}</span>`);
      }
      if (cond.wet > 0.25 && !P.soaked) tags.push('<span class="tag wet">wet</span>');
      if (cond.frozen > 0.4 && !P.iced) tags.push('<span class="tag frozen">frozen</span>');
      if (log.damage > 0) tags.push(`<span class="tag crack">cracked (${Math.round(log.damage)} J)</span>`);
      this.html('h-logtags', tags.join(''));
      const n = g.needed;
      const fog = cond.fog > 0.03;
      if (n && !fog) {
        this.txt('h-req', `≈ ${Math.round(n.req)} J${n.knot ? ' (knot!)' : ''}${n.check ? ' (check)' : ''}${n.fork === 'aligned' ? ' (fork ✓)' : n.fork === 'across' ? ' (across fork!)' : ''}`);
        $('h-req').classList.toggle('over', n.power > 1);
        this.txt('h-best', `≈ ${Math.round(n.Efull)} J`);
      } else {
        this.txt('h-req', fog ? 'can’t read it in the fog' : '—');
        this.txt('h-best', n ? `≈ ${Math.round(n.Efull)} J` : '—');
      }
      this.txt('h-hits', log.hits);
      const boss = P.boss;
      $('h-boss').classList.toggle('hidden', !boss);
      if (boss) {
        this.txt('h-bossname', `☠ ${boss.name}`);
        this.sty('h-bosshp', 'width', pct(g.bossHp(log)));
      }
    } else {
      this.txt('h-logname', 'Next round coming…');
      this.txt('h-logsize', '');
      this.html('h-logtags', '');
      $('h-boss').classList.add('hidden');
    }
    this.html('h-queue', g.queue.slice(0, 5).map((q) => {
      const icons = (q.params.traits ?? []).map((t) => TRAITS[t]?.icon ?? '').join('');
      const tip = [q.params.species.name, ...(q.params.traits ?? []).map((t) => TRAITS[t]?.name)].join(' · ');
      return `<span class="${q.params.boss ? 'boss' : ''}" title="${tip}">${q.params.boss ? '☠' : ''}${q.params.species.name.split(' ').pop()}${icons ? ` <i>${icons}</i>` : ''}</span>`;
    }).join('') || '<span>— last round —</span>');

    // Mode bar.
    const mode = g.mode;
    $('modebar').classList.toggle('hidden', !mode);
    if (mode) {
      const st = mode.status();
      const parts = [`<b>${st.name}</b>`];
      if (st.total) parts.push(`round ${Math.min(st.round, st.total)}/${st.total}`);
      if (st.timeLeft !== null) parts.push(`<span class="${st.timeLeft < 10 ? 'hot' : ''}">⏱ ${st.timeLeft.toFixed(1)} s</span>`);
      parts.push(`${st.swings} swing${st.swings === 1 ? '' : 's'}${st.par ? ` (par ${st.par})` : ''}`);
      parts.push(st.type === 'precision' ? `${st.score} / ${st.total * 100} precision` : `${st.points.toLocaleString()} pts`);
      this.html('mb-text', parts.join(' · '));
    }

    // Conditions.
    const w = this.weather;
    this.txt('h-clock', fmtHour(w.hour));
    this.txt('h-weather', `${cond.icon} ${cond.name} · ${Math.round(cond.temp)}°C`);
    const eff = [`wind ${cond.wind.speed.toFixed(1)} m/s`];
    if (cond.wet > 0.05) eff.push(`wet ${pct(cond.wet)}`);
    if (cond.frozen > 0.05) eff.push(`frozen ${pct(cond.frozen)}`);
    if (cond.icy > 0.05) eff.push(`icy ${pct(cond.icy)}`);
    if (cond.snow > 0.05) eff.push(`snow ${pct(cond.snow)}`);
    if (cond.scoreBonus > 0) eff.push(`score +${Math.round(cond.scoreBonus * 100)}%`);
    this.txt('h-effects', eff.join(' · '));
    this.txt('h-fps', fps ? fps.toFixed(0) : '—');
    this.txt('h-qname', quality);

    // Meter.
    const m = g.meter;
    const meterEl = $('meter');
    meterEl.classList.toggle('idle', !m.active);
    const [lo, hi] = g.sweetZone;
    this.sty('m-zone', 'left', pct(lo));
    this.sty('m-zone', 'width', pct(hi - lo));
    const need = $('m-need');
    if (g.needed && cond.fog <= 0.03) {
      need.classList.remove('hidden');
      this.sty('m-need', 'left', pct(Math.min(1, g.needed.power)));
      this.setCached(need.firstElementChild, 'textContent', g.needed.power > 1 ? 'split: beyond max!' : 'split');
    } else need.classList.add('hidden');
    this.sty('m-needle', 'left', pct(m.active ? m.value : 0));
    this.sty('m-fill', 'width', pct(m.active ? m.value : 0));
    this.txt('m-val', m.active ? pct(m.value) : '');
    this.txt('m-hint', m.active
      ? (m.holdMode ? 'Release to swing · drag ↔ to turn the blade' : 'Click or Space to swing')
      : g.swing.canSwing ? 'Click & hold on the log (or Space) to charge' : 'Swinging…');
  }

  telemetry(sim) {
    const el = $('telemetry');
    if (el.classList.contains('hidden')) return;
    const h = this.game.lastHit;
    const cond = this.weather.conditions;
    const rows = [
      ['State', sim.state],
      ['Head speed', `${sim.headSpeed.toFixed(1)} m/s`],
      ['Last impact', h ? `${h.headSpeed} m/s, ${h.energy} J / ${h.required} J (${Math.round(h.ratio * 100)}%)` : '—'],
      ['Penetration', h?.depthCm ? `${h.depthCm} cm` : '—'],
      ['Axe', `${this.game.axeStats.headMass} kg head, wedge ${this.game.axeStats.wedge}`],
      ['Edge', pct(this.game.sharpness)],
      ['Stamina regen', `${this.game.regenRate.toFixed(1)}/s × ${cond.staminaRegen.toFixed(2)}`],
      ['Wet / frozen / icy', `${pct(cond.wet)} / ${pct(cond.frozen)} / ${pct(cond.icy)}`],
      ['Wind', `${cond.wind.speed.toFixed(1)} m/s (gust ${cond.wind.gust.toFixed(2)})`],
      ['Footing', `×${cond.footing.toFixed(2)} scatter`],
      ['Aim scatter', `σ ≈ ${(this.game.aimScatter(cond) * 1000).toFixed(1)} mm`],
      ['Bodies', `${sim.bodies} (${sim.pieces} pieces, ${sim.chips} chips)`],
      ['Sim speed', `${sim.scale.toFixed(2)}×`],
    ];
    el.innerHTML = '<h3>Physics telemetry</h3>' + rows.map(([a, b]) => `<div class="row"><span>${a}</span><b>${b}</b></div>`).join('');
  }

  // ------------------------------------------------------------------ modes

  bindModes() {
    $('modes-body').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-mode]');
      if (!b) return;
      this.startMode(b.dataset.mode, b.dataset.stage);
    });
    $('modeend-body').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-mode]');
      if (!b) return;
      this.startMode(b.dataset.mode, b.dataset.stage);
    });
    $('btn-quitmode').addEventListener('click', () => { this.game.endMode('quit'); this.game.toast('Back to free play'); });
  }

  startMode(type, stage) {
    for (const m of document.querySelectorAll('.modal')) m.classList.add('hidden');
    if (type === 'free') { if (this.game.mode) this.game.endMode('quit'); return; }
    this.game.startMode(type, stage !== undefined ? { stage: +stage } : {});
  }

  openModes() {
    const g = this.game, rec = g.p.records;
    const stars = (n) => '★'.repeat(n) + '☆'.repeat(3 - n);
    let unlocked = true;
    const stageCards = STAGES.map((st, i) => {
      const r = rec.campaign[st.id];
      const open = unlocked;
      unlocked = !!r;
      return `<div class="item ${open ? '' : 'locked'}"><h4>${i + 1}. ${st.name} <span class="stars">${stars(r?.stars ?? 0)}</span></h4>
        <p>${st.blurb}</p>
        <div class="st"><span>Boss</span><b>☠ ${st.boss.name}</b><span>Weather</span><b>${st.weather}</b><span>Par</span><b>${st.par} swings</b><span>Suggested</span><b>${st.gear}</b>${r ? `<span>Best</span><b>${r.best.toLocaleString()}</b>` : ''}</div>
        <button data-mode="campaign" data-stage="${i}" ${open ? '' : 'disabled'}>${open ? (r ? 'Replay' : 'Play') : 'Locked'}</button></div>`;
    }).join('');
    const today = todayKey();
    const daily = rec.daily?.date === today ? rec.daily.best : 0;
    const ch = (id, best) => `<div class="item"><h4>${CHALLENGES[id].name}</h4><p>${CHALLENGES[id].blurb}</p>
      <div class="st"><span>Best</span><b>${best ? best.toLocaleString() : '—'}</b></div>
      <button data-mode="${id}">Start</button></div>`;
    $('modes-body').innerHTML = `
      <h3>Challenges</h3><div class="items">
        <div class="item"><h4>Free play (endless)</h4><p>The RPG sandbox: rounds and variants follow your level, a boss every 10th round from level 3.</p><button data-mode="free" class="${g.mode ? '' : 'on'}">${g.mode ? 'Back to free play' : 'Playing'}</button></div>
        ${ch('timeattack', rec.timeattack)}${ch('precision', rec.precision)}${ch('daily', daily)}
      </div>
      <h3>Campaign</h3><div class="items">${stageCards}</div>`;
    $('modes').classList.remove('hidden');
  }

  showSummary(sum) {
    if (sum.reason === 'quit') return;
    const el = $('modeend');
    const stars = sum.stars ? `<div class="bigstars">${'★'.repeat(sum.stars)}${'☆'.repeat(3 - sum.stars)}</div>` : '';
    const rows = [
      ['Score', sum.type === 'precision' ? `${sum.score} / ${sum.total * 100}` : sum.points.toLocaleString()],
      ['Rounds split', sum.total ? `${sum.splits} / ${sum.total}` : sum.splits],
      ['Swings', sum.par ? `${sum.swings} (par ${sum.par})` : sum.swings],
      ['Cash reward', `$${sum.cash}`],
    ];
    const btns = [];
    if (sum.type === 'campaign') {
      const idx = STAGES.findIndex((s) => sum.name.includes(s.name));
      btns.push(`<button data-mode="campaign" data-stage="${idx}">Retry stage</button>`);
      if (sum.next !== null && sum.next !== undefined) btns.push(`<button class="primary" data-mode="campaign" data-stage="${sum.next}">Next stage ▶</button>`);
    } else btns.push(`<button class="primary" data-mode="${sum.type}">Play again</button>`);
    btns.push('<button data-mode="free">Free play</button>');
    $('modeend-title').textContent = sum.reason === 'time' ? "Time's up!" : sum.type === 'campaign' ? 'Stage clear!' : 'Challenge complete!';
    $('modeend-body').innerHTML = `<h3>${sum.name}</h3>${stars}${sum.best ? '<div class="newbest">New best!</div>' : ''}
      <div class="sumrows">${rows.map(([a, b]) => `<div class="row"><span>${a}</span><b>${b}</b></div>`).join('')}</div>
      <div class="sumbtns">${btns.join('')}</div>`;
    for (const m of document.querySelectorAll('.modal')) m.classList.add('hidden');
    el.classList.remove('hidden');
  }

  // ------------------------------------------------------------------ shop

  bindShop() {
    for (const b of document.querySelectorAll('#shop .tabs button')) {
      b.addEventListener('click', () => { this.shopTab = b.dataset.tab; this.renderShop(); });
    }
    $('shop-body').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-act]');
      if (!b) return;
      const g = this.game;
      const { act, id } = b.dataset;
      if (act === 'axe') g.buyAxe(id);
      else if (act === 'hone') g.buyHone();
      else if (act === 'gloves') g.buyGloves();
      else if (act === 'sharpen') g.sharpen();
      else if (act === 'skill') g.spendSkill(id);
      this.renderShop();
    });
    const rp = $('btn-resetprog');
    let armed = null;
    rp.addEventListener('click', () => {
      if (armed) {
        clearTimeout(armed);
        armed = null;
        rp.classList.remove('armed');
        rp.textContent = 'Reset progress';
        this.game.resetProgress();
        this.renderShop();
        return;
      }
      rp.classList.add('armed');
      rp.textContent = 'Click again to wipe everything';
      armed = setTimeout(() => { armed = null; rp.classList.remove('armed'); rp.textContent = 'Reset progress'; }, 3000);
    });
  }

  openShop() {
    $('shop').classList.remove('hidden');
    this.renderShop();
  }

  renderShop() {
    const g = this.game, p = g.p;
    $('shop-cash').textContent = `$${p.cash.toLocaleString()}`;
    $('shop-sp').textContent = p.skillPoints;
    for (const b of document.querySelectorAll('#shop .tabs button')) b.classList.toggle('on', b.dataset.tab === this.shopTab);
    let html = '';
    if (this.shopTab === 'axes') {
      html = '<div class="items">' + AXES.map((a) => {
        const owned = p.owned.includes(a.id), eq = p.axe === a.id;
        const btn = eq ? '<button disabled>Equipped</button>'
          : owned ? `<button data-act="axe" data-id="${a.id}">Equip</button>`
            : `<button data-act="axe" data-id="${a.id}" ${p.cash < a.price ? 'disabled' : ''}>Buy $${a.price}</button>`;
        return `<div class="item ${eq ? 'equipped' : ''}"><h4>${a.name}</h4><p>${a.blurb}</p>
          <div class="st"><span>Head</span><b>${a.headMass} kg (${(a.headMass * 2.2046).toFixed(1)} lb)</b>
          <span>Handle</span><b>${a.handleMass} kg ${a.handle}</b>
          <span>Sharpness</span><b>${pct(p.sharp[a.id] ?? a.sharp)}</b>
          <span>Wedge</span><b>×${a.wedge.toFixed(2)}</b>
          <span>Stamina/swing</span><b>≈${Math.round(g.costFor(0.86, a))}</b></div>${btn}</div>`;
      }).join('') + '</div>';
    } else if (this.shopTab === 'gear') {
      const tier = HONE_TIERS[p.hone];
      html = `<div class="items">
        <div class="item"><h4>Whetstone sharpening</h4><p>Restore the edge to ${pct(g.maxSharp)}. A sharp edge bites deeper, glances less and splits more efficiently.</p>
          <div class="st"><span>Current edge</span><b>${pct(g.sharpness)}</b></div>
          <button data-act="sharpen" ${p.cash < SHARPEN_PRICE ? 'disabled' : ''}>Sharpen $${SHARPEN_PRICE}</button></div>
        <div class="item"><h4>Honing jig</h4><p>Raises the maximum sharpness of every axe by 6%.</p>
          <div class="pips">${HONE_TIERS.map((_, i) => `<i class="${i < p.hone ? 'on' : ''}"></i>`).join('')}</div>
          ${tier ? `<button data-act="hone" ${p.cash < tier.price ? 'disabled' : ''}>Upgrade $${tier.price}</button>` : '<button disabled>Maxed</button>'}</div>
        <div class="item"><h4>Grippy work gloves</h4><p>Wet handles slip 75% less often in rain and storms.</p>
          ${p.gloves ? '<button disabled>Owned</button>' : `<button data-act="gloves" ${p.cash < GLOVES_PRICE ? 'disabled' : ''}>Buy $${GLOVES_PRICE}</button>`}</div>
      </div>`;
    } else {
      html = `<p class="small">You gain one skill point per level. Points: <b>${p.skillPoints}</b></p><div class="items">` +
        Object.entries(SKILLS).map(([id, s]) => `<div class="item"><h4>${s.name} ${p.skills[id]}/${s.max}</h4><p>${s.desc}</p>
          <div class="pips">${Array.from({ length: s.max }, (_, i) => `<i class="${i < p.skills[id] ? 'on' : ''}"></i>`).join('')}</div>
          <button data-act="skill" data-id="${id}" ${p.skillPoints <= 0 || p.skills[id] >= s.max ? 'disabled' : ''}>Train (+1)</button></div>`).join('') +
        `</div><p class="small">Career: ${p.stats.splits} splits · ${p.stats.bullseyes} bullseyes · best combo ×${p.bestCombo} · ${p.stats.swings} swings · ${p.stats.glances} glances · ${p.stats.nails} nails</p>`;
    }
    $('shop-body').innerHTML = html;
  }
}

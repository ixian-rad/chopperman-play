// Character picker: Sergey or Alex, two outfits each, and the player's name (shown on the co-op
// nameplate). One component, mounted twice: on the start screen and in the Player sheet.
// get() -> { character, costume, name }; set({ character } | { costume } | { name }) -> Promise.
import { CHARACTERS, COSTUMES } from './sergey.js';

const NAME_MAX = 16;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export class Picker {
  constructor(el, { get, set, preview = null, idPrefix = 'pk' }) {
    this.el = el;
    this.get = get;
    this.set = set;
    this.preview = preview; // <img> that shows the selected outfit's art
    this.busy = false;
    const chars = Object.entries(CHARACTERS).map(([id, c]) => `
      <button type="button" class="pick-char" data-char="${id}" role="radio" aria-checked="false">
        <img src="${c.portrait}" alt="" style="object-position:${c.ppos}" loading="lazy" decoding="async" /><span>${esc(c.name)}</span>
      </button>`).join('');
    el.innerHTML = `
      <div class="pick-title" id="${idPrefix}-title">Choose your lumberjack</div>
      <div class="pick-chars" role="radiogroup" aria-labelledby="${idPrefix}-title">${chars}</div>
      <div class="pick-cos" role="radiogroup" aria-label="Outfit"></div>
      <label class="pick-name"><span>Your name</span>
        <input type="text" id="${idPrefix}-name" maxlength="${NAME_MAX}" autocomplete="off" spellcheck="false" />
      </label>
      <div class="pick-status" aria-live="polite"></div>`;
    this.cos = el.querySelector('.pick-cos');
    this.name = el.querySelector('input');
    this.status = el.querySelector('.pick-status');
    el.querySelector('.pick-chars').addEventListener('click', (e) => {
      const b = e.target.closest('[data-char]');
      if (b) this.apply({ character: b.dataset.char });
    });
    this.cos.addEventListener('click', (e) => {
      const b = e.target.closest('[data-cos]');
      if (b) this.apply({ costume: b.dataset.cos });
    });
    this.name.addEventListener('input', () => {
      const v = this.name.value.replace(/[^\p{L}\p{N} _.'-]/gu, '').slice(0, NAME_MAX);
      if (v !== this.name.value) this.name.value = v;
      this.set({ name: v.trim() });
    });
    this.name.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === 'Escape') this.name.blur(); });
    this.render();
  }

  async apply(patch) {
    this.status.textContent = 'Loading the model…';
    this.busy = true;
    const p = this.set(patch);
    this.render();
    try { await p; this.status.textContent = ''; } catch (e) { console.warn(e); this.status.textContent = 'Could not load that model'; }
    this.busy = false;
    this.render();
  }

  render() {
    const cur = this.get();
    const C = CHARACTERS[cur.character] ?? CHARACTERS.sergey;
    for (const b of this.el.querySelectorAll('[data-char]')) {
      const on = b.dataset.char === cur.character;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
    }
    const html = C.costumes.map((id) => `<button type="button" data-cos="${id}" role="radio" aria-checked="${id === cur.costume}" class="${id === cur.costume ? 'on' : ''}">${esc(COSTUMES[id].name)}</button>`).join('');
    if (this.cos.dataset.h !== html) { this.cos.innerHTML = html; this.cos.dataset.h = html; }
    if (document.activeElement !== this.name) this.name.value = cur.name ?? '';
    this.name.placeholder = C.name;
    const art = COSTUMES[cur.costume]?.art;
    if (this.preview && art && !this.preview.src.endsWith(art)) {
      this.preview.src = art;
      this.preview.style.objectPosition = COSTUMES[cur.costume].pos ?? '50% 30%';
      this.preview.alt = `${C.name} in the ${COSTUMES[cur.costume].name.toLowerCase()}`;
    }
  }
}

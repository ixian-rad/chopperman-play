// Co-op menu: a small DOM panel (no framework). Every text is >= 16 px, status / code >= 20 px (HUD rule).
// const ui = new CoopUI({ coop, mount: document.body }); ui.open();
// `coop` must provide: host(), join(code), leave(), uiModel() -> {status, code, backend, error, rtt, players:[{id,name,character,costume,isHost,isYou,connected}]},
// on('change', fn), inviteLink(), prefillCode (optional string).
import { normalizeCode } from './net.js';

const CSS = `
.coop-root,.coop-root *{box-sizing:border-box;font-family:system-ui,-apple-system,"Segoe UI",Arial,sans-serif}
.coop-btn{position:fixed;top:12px;right:12px;z-index:2147483000;min-height:44px;padding:8px 16px;font-size:18px;font-weight:700;color:#fff;background:#14181d;border:2px solid #7fd8ff;border-radius:10px;cursor:pointer}
.coop-btn[data-live="1"]{border-color:#5be37d}
.coop-panel{position:fixed;top:64px;right:12px;z-index:2147483000;width:min(380px,calc(100vw - 24px));max-height:calc(100vh - 80px);overflow:auto;padding:16px;color:#fff;background:rgba(14,18,23,.96);border:2px solid #7fd8ff;border-radius:12px;font-size:16px;line-height:1.4;box-shadow:0 8px 30px rgba(0,0,0,.5)}
.coop-panel[hidden]{display:none}
.coop-panel h2{margin:0 0 8px;font-size:22px}
.coop-status{font-size:20px;font-weight:700;margin:8px 0;min-height:28px}
.coop-status[data-kind="ok"]{color:#7dffa1}.coop-status[data-kind="warn"]{color:#ffd24a}.coop-status[data-kind="err"]{color:#ff9a9a}
.coop-row{display:flex;gap:8px;margin:10px 0;flex-wrap:wrap;align-items:center}
.coop-panel button{min-height:44px;padding:8px 14px;font-size:18px;font-weight:700;color:#fff;background:#1f7a35;border:0;border-radius:8px;cursor:pointer}
.coop-panel button.sec{background:#2f4a66}.coop-panel button.danger{background:#a32929}
.coop-panel button:disabled{background:#3a3f45;color:#c9ced4;cursor:default}
.coop-panel input{min-height:44px;width:9ch;flex:1;min-width:120px;padding:8px 12px;font-size:22px;letter-spacing:.2em;text-transform:uppercase;color:#fff;background:#0a0d11;border:2px solid #7fd8ff;border-radius:8px}
.coop-code{font-size:36px;font-weight:800;letter-spacing:.25em;font-family:ui-monospace,Menlo,Consolas,monospace;color:#ffd24a;user-select:all}
.coop-players{list-style:none;margin:8px 0 0;padding:0}
.coop-players li{display:flex;justify-content:space-between;gap:8px;padding:8px 10px;margin:4px 0;font-size:18px;background:#1b2530;border-radius:8px}
.coop-players .sub{font-size:16px;color:#c9d6e2}
.coop-note{font-size:16px;color:#c9d6e2;margin-top:10px}
.coop-voice{margin:10px 0;padding:10px 12px;background:#1b2530;border-radius:10px}
.coop-voice-head{font-size:18px;font-weight:700;margin:0 0 6px}
.coop-panel button.coop-switch{width:100%;justify-content:space-between;display:flex;align-items:center;text-align:left;background:#2f4a66}
.coop-panel button.coop-switch[aria-checked="true"]{background:#1f7a35}
.coop-switch .state{font-size:18px;padding:2px 10px;border-radius:999px;background:#0a0d11;color:#fff}
.coop-voice-note{font-size:16px;color:#c9d6e2;margin-top:8px;min-height:22px}
.coop-voice-note[data-kind="err"]{color:#ffb4b4}.coop-voice-note[data-kind="warn"]{color:#ffd24a}.coop-voice-note[data-kind="ok"]{color:#7dffa1}
.coop-voice-hud{position:fixed;left:12px;bottom:12px;z-index:2147483000;display:flex;gap:10px;align-items:center;flex-wrap:wrap;max-width:calc(100vw - 24px);padding:8px 10px;color:#fff;background:rgba(14,18,23,.92);border:2px solid #7fd8ff;border-radius:12px;font-size:20px;line-height:1.3}
.coop-voice-hud[hidden]{display:none}
.coop-voice-hud button{min-height:44px;padding:6px 14px;font-size:20px;font-weight:700;color:#fff;background:#1f7a35;border:0;border-radius:8px;cursor:pointer}
.coop-voice-hud button[aria-pressed="true"]{background:#a32929}
.coop-voice-who{font-size:20px;font-weight:700;display:flex;align-items:center;gap:8px}
.coop-voice-who .dot{width:14px;height:14px;border-radius:50%;background:#7a8591;display:inline-block;border:2px solid #fff}
.coop-voice-who[data-speaking="1"] .dot{background:#5be37d;box-shadow:0 0 0 4px rgba(91,227,125,.45)}
.coop-voice-who[data-speaking="1"]{color:#7dffa1}
.coop-voice-who[data-far="1"]{color:#ffd24a}
`;

export class CoopUI {
  constructor({ coop, mount = document.body, buttonLabel = 'Co-op', startOpen = false } = {}) {
    this.coop = coop; this.mount = mount;
    if (!document.getElementById('coop-ui-css')) { const st = document.createElement('style'); st.id = 'coop-ui-css'; st.textContent = CSS; document.head.appendChild(st); }
    const root = this.root = document.createElement('div'); root.className = 'coop-root';
    root.innerHTML = `
      <button class="coop-btn" type="button" id="coop-toggle" aria-expanded="false">${buttonLabel}</button>
      <section class="coop-panel" id="coop-panel" aria-label="Co-op multiplayer" hidden>
        <h2>Co-op (2 players)</h2>
        <div class="coop-status" id="coop-status" role="status" aria-live="polite"></div>
        <div class="coop-voice" id="coop-voice-box" hidden>
          <div class="coop-voice-head">Voice chat</div>
          <button class="coop-switch" id="coop-voice-toggle" type="button" role="switch" aria-checked="false"><span>Proximity voice chat</span><span class="state" id="coop-voice-state">OFF</span></button>
          <div class="coop-voice-note" id="coop-voice-note" role="status" aria-live="polite"></div>
        </div>
        <div id="coop-idle">
          <div class="coop-row"><button id="coop-host" type="button">Host a game</button></div>
          <div class="coop-row"><input id="coop-code-in" type="text" inputmode="text" maxlength="6" autocomplete="off" spellcheck="false" placeholder="CODE" aria-label="Room code"><button id="coop-join" type="button" class="sec">Join</button></div>
          <div class="coop-note">Host shares the room code. Both players need this page open.</div>
        </div>
        <div id="coop-live" hidden>
          <div class="coop-row"><span class="coop-code" id="coop-code" aria-label="Room code"></span></div>
          <div class="coop-row"><button id="coop-copy" type="button" class="sec">Copy code</button><button id="coop-copylink" type="button" class="sec">Copy invite link</button></div>
          <ul class="coop-players" id="coop-players" aria-label="Players"></ul>
          <div class="coop-row"><button id="coop-leave" type="button" class="danger">Disconnect</button></div>
        </div>
        <div class="coop-note" id="coop-note"></div>
      </section>
      <div class="coop-voice-hud" id="coop-voice-hud" hidden role="group" aria-label="Voice chat">
        <button id="coop-voice-mute" type="button" aria-pressed="false">Mic on</button>
        <span class="coop-voice-who" id="coop-voice-remote" data-speaking="0"><span class="dot" aria-hidden="true"></span><span id="coop-voice-remote-text"></span></span>
      </div>`;
    mount.appendChild(root);
    const $ = id => root.querySelector('#' + id); this.el = { toggle: $('coop-toggle'), panel: $('coop-panel'), status: $('coop-status'), idle: $('coop-idle'), live: $('coop-live'), host: $('coop-host'), join: $('coop-join'), input: $('coop-code-in'), code: $('coop-code'), copy: $('coop-copy'), copyLink: $('coop-copylink'), players: $('coop-players'), leave: $('coop-leave'), note: $('coop-note'),
      vBox: $('coop-voice-box'), vToggle: $('coop-voice-toggle'), vState: $('coop-voice-state'), vNote: $('coop-voice-note'), vHud: $('coop-voice-hud'), vMute: $('coop-voice-mute'), vWho: $('coop-voice-remote'), vWhoText: $('coop-voice-remote-text') };
    const e = this.el;
    // keep typing from triggering game hotkeys
    for (const ev of ['keydown', 'keyup', 'keypress']) root.addEventListener(ev, x => { if (x.target === e.input) x.stopPropagation(); });
    e.toggle.onclick = () => this.toggle();
    e.host.onclick = () => this._run(() => coop.host());
    e.join.onclick = () => { const c = normalizeCode(e.input.value); if (!c) return this._flash('Enter the 4-6 character room code', 'err'); this._run(() => coop.join(c)); };
    e.input.addEventListener('keydown', k => { if (k.key === 'Enter') e.join.click(); });
    e.input.addEventListener('input', () => { e.input.value = e.input.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
    e.copy.onclick = () => this._copy(coop.uiModel().code, e.copy, 'Copy code');
    e.copyLink.onclick = () => this._copy(coop.inviteLink(), e.copyLink, 'Copy invite link');
    e.leave.onclick = () => coop.leave();
    if (coop.voice) { // voice chat is opt-in: nothing touches the microphone until this switch is turned on
      e.vBox.hidden = false;
      e.vToggle.onclick = async () => { e.vToggle.disabled = true; try { await coop.voice.toggle(); } finally { e.vToggle.disabled = false; this.render(); } };
      e.vMute.onclick = () => { coop.voice.mute(); this.render(); };
    }
    coop.on('change', () => this.render());
    if (coop.prefillCode) { e.input.value = coop.prefillCode; startOpen = true; }
    this.render(); if (startOpen) this.open();
  }
  open() { this.el.panel.hidden = false; this.el.toggle.setAttribute('aria-expanded', 'true'); }
  close() { this.el.panel.hidden = true; this.el.toggle.setAttribute('aria-expanded', 'false'); }
  toggle() { this.el.panel.hidden ? this.open() : this.close(); }
  isOpen() { return !this.el.panel.hidden; }
  destroy() { this.root.remove(); }
  async _run(fn) {
    this.el.host.disabled = this.el.join.disabled = true;
    try { await fn(); } catch (err) { this._flash(friendly(err), 'err'); } finally { this.el.host.disabled = this.el.join.disabled = false; this.render(); }
  }
  _flash(msg, kind) { this.el.status.textContent = msg; this.el.status.dataset.kind = kind || ''; this._sticky = msg; setTimeout(() => { if (this._sticky === msg) { this._sticky = null; this.render(); } }, 5000); }
  async _copy(text, btn, label) {
    let ok = false; try { await navigator.clipboard.writeText(text); ok = true; } catch {}
    if (!ok) { const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); try { ok = document.execCommand('copy'); } catch {} ta.remove(); }
    btn.textContent = ok ? 'Copied!' : 'Copy failed: select the code'; setTimeout(() => { btn.textContent = label; }, 1800);
  }
  render() {
    const m = this.coop.uiModel(), e = this.el; const live = ['hosting', 'connected', 'reconnecting'].includes(m.status) || (m.status === 'connecting' && m.code);
    e.idle.hidden = live; e.live.hidden = !live; e.toggle.dataset.live = m.status === 'connected' ? '1' : '0';
    e.toggle.textContent = m.status === 'connected' ? 'Co-op: connected' : m.status === 'hosting' ? 'Co-op: waiting' : 'Co-op';
    let txt = '', kind = '';
    switch (m.status) {
      case 'connecting': txt = 'Connecting…'; kind = 'warn'; break;
      case 'hosting': txt = 'Waiting for player 2…'; kind = 'warn'; break;
      case 'connected': txt = `Connected${m.rtt != null ? ' · ' + Math.round(m.rtt) + ' ms' : ''}`; kind = 'ok'; break;
      case 'reconnecting': txt = 'Connection lost, reconnecting…'; kind = 'warn'; break;
      case 'ended': txt = m.endReason === 'host-left' ? 'Host left. Back to single player.' : m.endReason === 'lost' ? 'Connection lost. Back to single player.' : 'Disconnected. Single player.'; kind = 'warn'; break;
      case 'error': txt = friendly(m.error); kind = 'err'; break;
      default: txt = 'Single player';
    }
    if (!this._sticky) { e.status.textContent = txt; e.status.dataset.kind = kind; }
    e.code.textContent = m.code || '';
    e.players.innerHTML = '';
    for (const p of m.players) {
      const li = document.createElement('li'); const a = document.createElement('span'); const b = document.createElement('span'); b.className = 'sub';
      a.textContent = `${p.name}${p.isYou ? ' (you)' : ''}${p.isHost ? ' ★' : ''}`; b.textContent = `${cap(p.character)} · ${p.connected ? p.costume : 'disconnected'}`; li.append(a, b); e.players.appendChild(li);
    }
    this._renderVoice(m);
    e.note.textContent = m.status === 'error' || m.status === 'ended' ? 'Some home networks block direct connections. If it keeps failing, try another network.' : '';
  }
}
CoopUI.prototype._renderVoice = function (m) {
  const v = this.coop.voice, e = this.el; if (!v) return;
  const st = v.state(), note = v.note(), inSession = ['connected', 'reconnecting'].includes(m.status) && m.players.length > 1;
  e.vToggle.setAttribute('aria-checked', st.enabled ? 'true' : 'false'); e.vState.textContent = st.enabled ? 'ON' : 'OFF';
  e.vNote.textContent = note.text || 'Off by default. Talk to your partner; they get quieter as you walk apart. Audio goes directly between you two and is never recorded. Headphones avoid echo.'; e.vNote.dataset.kind = note.kind || '';
  // in-game HUD: mute button + who is speaking (hidden when voice is off or there is no partner)
  const hud = st.enabled && inSession; e.vHud.hidden = !hud; if (!hud) return;
  e.vMute.setAttribute('aria-pressed', st.muted ? 'true' : 'false'); e.vMute.textContent = st.muted ? 'Mic muted (click to unmute)' : 'Mic on (click to mute)';
  const n = v.partner, r = st.remote; let t;
  if (!r.on) t = `${n}: voice off`; else if (st.call !== 'connected') t = `${n}: connecting voice…`; else if (r.muted) t = `${n}: mic muted`;
  else if (r.speaking) t = st.gain < 0.02 ? `${n}: speaking (too far to hear)` : `${n}: speaking`; else t = `${n}: quiet`;
  e.vWhoText.textContent = t; e.vWho.dataset.speaking = r.speaking && st.call === 'connected' ? '1' : '0'; e.vWho.dataset.far = r.speaking && st.gain < 0.02 ? '1' : '0';
};
const cap = s => (s ? s[0].toUpperCase() + s.slice(1) : '');
export function friendly(err) {
  const c = err?.code || err?.message || '';
  if (c === 'not-found') return 'No room with that code. Check it and try again.';
  if (c === 'full') return 'That room is full.';
  if (c === 'version') return 'Game versions do not match.';
  if (c === 'bad-code') return 'Enter the 4-6 character room code.';
  if (/timeout/.test(c)) return 'Could not connect (timed out). Your network may block direct connections.';
  if (c === 'ice-failed') return 'Direct connection blocked by a firewall (no relay available).';
  return err?.message ? `Co-op error: ${err.message}` : 'Co-op error';
}

// Remote player avatar + nameplate. The game supplies spawnAvatar() so it can reuse its own GLTF loader,
// AnimationMixer and axe-attachment code; this class only places/animates it from interpolated network state.
//
// spawnAvatar({ id, character, costume, axe, name, scene }) -> Promise<avatar>
//   avatar = { root: THREE.Object3D (already added to the scene by you or not: we add it if root.parent is null),
//              setAnim(clipName, { swinging }),   // crossfade to Idle|Axe_Stance|Charged_Axe_Chop|Heavy_Hammer_Swing|Casual_Walk|Victory_Cheer|Run
//              headHeight?: number (default 2.1 m, for the nameplate), yawOffset?: number, dispose?() }
// Position: root.position = interpolated {x,y,z} (y = feet on ground); root.rotation.y = yaw + yawOffset.

const SWING = new Set(['Charged_Axe_Chop', 'Heavy_Hammer_Swing']);
export const NAMEPLATE_PX = 36; // on-screen plate height; text is ~69% of it, i.e. ~25 px (>= 16 px rule)

export class RemotePlayer {
  constructor({ THREE, scene, info, spawnAvatar, nameplate = true, plateHeightPx = NAMEPLATE_PX }) {
    this.THREE = THREE; this.scene = scene; this.info = { ...info }; this.spawnAvatar = spawnAvatar; this.avatar = null;
    this.anim = null; this.visible = false; this.useNameplate = nameplate; this.plateH = plateHeightPx;
    this.sprite = null; this.loadToken = 0; this.lastState = null; this.loading = null; this.speaking = false;
  }
  get id() { return this.info.id; }
  get root() { return this.avatar?.root || null; }
  async load() {
    const token = ++this.loadToken; const { id, character, costume, axe, name } = this.info;
    const prev = this.avatar; this.avatar = null; this.anim = null;
    this.loading = (async () => {
      let av = null;
      try { av = await this.spawnAvatar({ id, character, costume, axe, name, scene: this.scene }); }
      catch (e) { console.error('[coop] spawnAvatar failed', e); }
      if (token !== this.loadToken) { try { av?.dispose?.(); av?.root?.removeFromParent(); prev?.dispose?.(); prev?.root?.removeFromParent(); } catch {} return; }
      if (prev) { try { prev.dispose?.(); prev.root?.removeFromParent(); } catch {} }
      this.avatar = av; if (av?.root) { if (!av.root.parent) this.scene.add(av.root); av.root.visible = this.visible; av.root.userData.coopRemote = id; }
    })();
    await this.loading;
    if(token===this.loadToken)this._plate();
  }
  /** Profile changed on the remote side (character / costume / axe / name). */
  async setProfile(p) {
    const re = ['character', 'costume', 'axe'].some(k => p[k] !== undefined && p[k] !== this.info[k]);
    const renamed = p.name !== undefined && p.name !== this.info.name; Object.assign(this.info, p);
    if (re) await this.load(); else if (renamed) this._plate();
  }
  /** Voice chat: remote player is talking. Redraws the nameplate with a green frame and sound-wave marks (only when the flag changes). */
  setSpeaking(on) { on = !!on; if (on === this.speaking) return; this.speaking = on; this._plate(); }
  _plate() {
    if (!this.useNameplate) return; const T = this.THREE;
    if (this.sprite) { this.sprite.material.map.dispose(); this.sprite.material.dispose(); this.scene.remove(this.sprite); this.sprite = null; }
    const W = 512, H = 64, c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
    const text = String(this.info.name || 'Player'); g.font = '700 44px system-ui, Arial, sans-serif';
    const talk = this.speaking; const tw = Math.min(W - 24 - (talk ? 56 : 0), g.measureText(text).width + 36) + (talk ? 56 : 0); const x0 = (W - tw) / 2;
    g.fillStyle = 'rgba(10,14,18,0.82)'; g.beginPath(); g.roundRect(x0, 2, tw, H - 4, 14); g.fill();
    g.strokeStyle = talk ? '#5be37d' : this.info.isHost ? '#ffd24a' : '#7fd8ff'; g.lineWidth = talk ? 6 : 3; g.stroke();
    g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, W / 2 + (talk ? 28 : 0), H / 2 + 2, tw - 24 - (talk ? 56 : 0));
    if (talk) { // speaker with sound waves, left of the name
      const cx = x0 + 30, cy = H / 2; g.fillStyle = '#5be37d'; g.beginPath(); g.moveTo(cx - 12, cy - 6); g.lineTo(cx - 5, cy - 6); g.lineTo(cx + 5, cy - 14); g.lineTo(cx + 5, cy + 14); g.lineTo(cx - 5, cy + 6); g.lineTo(cx - 12, cy + 6); g.closePath(); g.fill();
      g.strokeStyle = '#5be37d'; g.lineWidth = 4; for (const r of [10, 17]) { g.beginPath(); g.arc(cx + 5, cy, r, -0.9, 0.9); g.stroke(); }
    }
    const tex = new T.CanvasTexture(c); if ('colorSpace' in tex && T.SRGBColorSpace) tex.colorSpace = T.SRGBColorSpace;
    const mat = new T.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, sizeAttenuation: false });
    this.sprite = new T.Sprite(mat); this.sprite.renderOrder = 999; this.sprite.userData.aspect = W / H; this.sprite.visible = this.visible; this.sprite.userData.coopNameplate = this.id;
    this.scene.add(this.sprite);
  }
  /** state = session.sampleRemote(now) ; ctx = { camera, viewportH } (viewportH in CSS px of the render area) */
  update(state, { camera, viewportH = 800 } = {}) {
    const av = this.avatar; this.lastState = state;
    const show = !!(this.info.connected !== false && state && av?.root); this.visible = show; if (av?.root) av.root.visible = show; if (this.sprite) this.sprite.visible = show;
    if (!show) return;
    const r = av.root; r.position.set(state.x, state.y, state.z); r.rotation.y = state.yaw + (av.yawOffset || 0);
    let a = state.anim || 'Idle'; if (state.swinging && !SWING.has(a)) a = 'Charged_Axe_Chop';
    if (a !== this.anim) { this.anim = a; try { av.setAnim(a, { swinging: !!state.swinging }); } catch (e) { console.warn('[coop] setAnim', e); } }
    if (this.sprite) {
      this.sprite.position.set(state.x, state.y + (av.headHeight || 2.1) + 0.25, state.z);
      const fov = (camera?.fov || 60) * Math.PI / 180; const hs = this.plateH * 2 * Math.tan(fov / 2) / viewportH;
      this.sprite.scale.set(hs * this.sprite.userData.aspect, hs, 1);
    }
  }
  dispose() {
    this.loadToken++; try { this.avatar?.dispose?.(); this.avatar?.root?.removeFromParent(); } catch {}
    if (this.sprite) { this.sprite.material.map.dispose(); this.sprite.material.dispose(); this.scene.remove(this.sprite); }
    this.avatar = null; this.sprite = null;
  }
}

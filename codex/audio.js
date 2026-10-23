// All sound is generated locally. No samples, network requests, or audio libraries.
const clamp=(value,min=0,max=1)=>Math.min(max,Math.max(min,Number(value)||0));
const midi=n=>440*2**((n-69)/12);
export const AUDIO_STORAGE_KEY='backyard-audio-v1';
export const AUDIO_NODE_LIMIT=180;
export function seededRandom(seed=8128){return ()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};}
export class AudioManager {
  constructor({storage,contextFactory,document:doc=globalThis.document,timers=globalThis,seed=8128}={}){
    this.storage=storage;this.usesNativeContext=!contextFactory;this.contextFactory=contextFactory??(()=>{const C=globalThis.AudioContext||globalThis.webkitAudioContext;return C?new C():null;});
    this.doc=doc;this.timers=timers;this.rand=seededRandom(seed);this.musicOn=true;this.sfxOn=true;this.musicVolume=.32;this.sfxVolume=.7;
    try{const s=JSON.parse(storage?.getItem(AUDIO_STORAGE_KEY)||'null');if(s){for(const k of ['musicOn','sfxOn'])if(typeof s[k]==='boolean')this[k]=s[k];for(const k of ['musicVolume','sfxVolume'])if(Number.isFinite(s[k]))this[k]=clamp(s[k]);}}catch{/* Private/session play. */}
    this.ctx=null;this.voices=new Set();this.eventsPlayed={};this.limits=new Map();this.plucks=new Map();this.ambient=[];
    this.musicSection='menu';this.intensity=0;this.activityUntil=0;this.nextStep=0;this.step=0;this.musicPlaying=false;this.timer=null;this.hidden=!!doc?.hidden;
    this.environment={weather:'sun',hour:16.5,wind:0};this.game={combo:0,boss:false,menu:false};this.nextNature=0;this.nextThunder=0;this.demo=null;this.pendingBossIntro=false;this.disposed=false;
    this.visibility=()=>this.setHidden(!!this.doc.hidden);doc?.addEventListener('visibilitychange',this.visibility);
  }
  async unlock(){
    if(this.disposed||this.hidden)return false;
    // Console/test hooks can swing before a gesture. Stay silent until the
    // browser has user activation instead of provoking an autoplay warning.
    if(!this.ctx&&this.usesNativeContext&&globalThis.navigator?.userActivation?.hasBeenActive===false)return false;
    try{
      if(!this.ctx){this.ctx=this.contextFactory();if(!this.ctx)return false;this.buildGraph();this.ctx.onstatechange=()=>{if(this.ctx.state!=='running'){this.stopClock();this.clearVoices();}else if(!this.hidden)this.startClock();};}
      if(this.ctx.state==='closed')return false;
      if(this.ctx.state!=='running')await this.ctx.resume();
      if(this.ctx.state!=='running'||this.hidden)return false;
      this.startClock();return true;
    }catch{return false;}
  }
  buildGraph(){
    const c=this.ctx;this.master=c.createGain();this.master.gain.value=.78;
    this.peakGuard=c.createWaveShaper();const curve=new Float32Array(1025);for(let i=0;i<curve.length;i++){const x=i/512-1;curve[i]=.98*Math.tanh(x/.98);}this.peakGuard.curve=curve;this.peakGuard.oversample='2x';
    this.limiter=c.createDynamicsCompressor();this.limiter.threshold.value=-12;this.limiter.knee.value=5;this.limiter.ratio.value=16;this.limiter.attack.value=.003;this.limiter.release.value=.15;
    this.sfxBus=c.createGain();this.musicBus=c.createGain();this.duck=c.createGain();this.ambientBus=c.createGain();
    this.sfxBus.connect(this.limiter);this.musicBus.connect(this.duck).connect(this.limiter);this.ambientBus.connect(this.sfxBus);this.limiter.connect(this.peakGuard).connect(this.master).connect(c.destination);this.applyVolumes();
    // Reuse the same two seconds of white/brown noise for all bursts and beds.
    this.white=c.createBuffer(1,c.sampleRate*2,c.sampleRate);this.brown=c.createBuffer(1,c.sampleRate*2,c.sampleRate);
    const w=this.white.getChannelData(0),b=this.brown.getChannelData(0);let last=0;
    for(let i=0;i<w.length;i++){w[i]=this.rand()*2-1;last=(last+w[i]*.035)/1.035;b[i]=last*4;}
  }
  applyVolumes(){
    if(!this.ctx)return;const t=this.ctx.currentTime;
    for(const [bus,v]of [[this.musicBus,this.musicOn?this.musicVolume:0],[this.sfxBus,this.sfxOn?this.sfxVolume:0]]){bus.gain.cancelScheduledValues(t);bus.gain.setTargetAtTime(v,t,.035);}
  }
  configure(settings){
    const wasPlaying=this.musicOn&&this.musicVolume>0;
    for(const k of ['musicOn','sfxOn'])if(typeof settings[k]==='boolean')this[k]=settings[k];
    for(const k of ['musicVolume','sfxVolume'])if(Number.isFinite(settings[k]))this[k]=clamp(settings[k]);
    if(wasPlaying&&(!this.musicOn||!this.musicVolume)){this.clearVoices('music');this.musicPlaying=false;}
    if(!this.sfxOn||!this.sfxVolume)this.clearVoices('sfx');
    this.applyVolumes();try{this.storage?.setItem(AUDIO_STORAGE_KEY,JSON.stringify({musicOn:this.musicOn,sfxOn:this.sfxOn,musicVolume:this.musicVolume,sfxVolume:this.sfxVolume}));}catch{/* Optional persistence. */}
  }
  getAudioState(){return {ctxState:this.ctx?.state??((globalThis.AudioContext||globalThis.webkitAudioContext)?'locked':'unavailable'),musicOn:this.musicOn,musicPlaying:this.musicPlaying&&this.ctx?.state==='running'&&!this.hidden,musicSection:this.musicSection,intensity:this.intensity,activeVoices:this.nodeCount(),sfxVolume:this.sfxVolume,musicVolume:this.musicVolume,eventsPlayed:{...this.eventsPlayed}};}
  nodeCount(){let n=0;for(const voice of this.voices)n+=voice.nodes.length;return n;}
  // Every source owns its entire local graph. onended releases every node,
  // including filters and envelopes; stop paths use the same idempotent cleanup.
  voice(source,nodes,bus,start,duration,kind){
    if(this.nodeCount()+nodes.length>AUDIO_NODE_LIMIT){for(const n of nodes)n.disconnect();return false;}
    const record={source,nodes,kind};let cleaned=false;
    record.clean=()=>{if(cleaned)return;cleaned=true;source.onended=null;for(const n of nodes)n.disconnect();this.voices.delete(record);};
    source.onended=record.clean;nodes[nodes.length-1].connect(bus);this.voices.add(record);
    try{source.start(start);if(Number.isFinite(duration))source.stop(start+duration);}catch{record.clean();return false;}return true;
  }
  clearVoices(kind){for(const v of [...this.voices])if(!kind||v.kind===kind){try{v.source.stop();}catch{/* Already ended. */}v.clean();}if(!kind)this.ambient=[];}
  tone(frequency,duration=.18,volume=.1,{at=this.ctx.currentTime,type='sine',end=frequency,cutoff=0,kind='sfx',attack=.004}={}){
    const c=this.ctx,o=c.createOscillator(),g=c.createGain(),nodes=[o];o.type=type;o.frequency.setValueAtTime(Math.max(20,frequency),at);o.frequency.exponentialRampToValueAtTime(Math.max(20,end),at+duration);
    if(cutoff){const f=c.createBiquadFilter();f.type='lowpass';f.frequency.value=Math.min(c.sampleRate*.49,cutoff);o.connect(f);nodes.push(f);f.connect(g);}else o.connect(g);nodes.push(g);
    g.gain.setValueAtTime(.0001,at);g.gain.linearRampToValueAtTime(Math.max(.0002,volume),at+attack);g.gain.exponentialRampToValueAtTime(.0001,at+duration);
    return this.voice(o,nodes,kind==='music'?this.musicBus:this.sfxBus,at,duration+.02,kind);
  }
  noise(duration=.16,volume=.12,{at=this.ctx.currentTime,frequency=1000,end=frequency,type='lowpass',q=.7,brown=false,kind='sfx'}={}){
    const c=this.ctx,s=c.createBufferSource(),f=c.createBiquadFilter(),g=c.createGain();s.buffer=brown?this.brown:this.white;s.loop=true;
    f.type=type;f.Q.value=q;f.frequency.setValueAtTime(clamp(frequency,25,c.sampleRate*.49),at);f.frequency.exponentialRampToValueAtTime(clamp(end,25,c.sampleRate*.49),at+duration);
    g.gain.setValueAtTime(.0001,at);g.gain.linearRampToValueAtTime(Math.max(.0002,volume),at+.006);g.gain.exponentialRampToValueAtTime(.0001,at+duration);s.connect(f).connect(g);
    return this.voice(s,[s,f,g],kind==='music'?this.musicBus:this.sfxBus,at,duration+.02,kind);
  }
  pluck(note,at,volume=.16,bright=1){
    // Karplus–Strong: seeded excitation circulating through a damped delay line.
    // Bounded cache avoids generating a buffer on every scheduled note.
    const key=`${note}:${bright>.7?1:0}`;let buffer=this.plucks.get(key);
    if(!buffer){const c=this.ctx,period=Math.round(c.sampleRate/midi(note)),ring=new Float32Array(period);for(let i=0;i<period;i++)ring[i]=this.rand()*2-1;
      buffer=c.createBuffer(1,c.sampleRate*1.4,c.sampleRate);const data=buffer.getChannelData(0),damping=bright>.7?.993:.978;let j=0;
      for(let i=0;i<data.length;i++){const v=ring[j];ring[j]=(v+ring[(j+1)%period])*.5*damping;data[i]=v;j=(j+1)%period;}
      if(this.plucks.size>=48)this.plucks.delete(this.plucks.keys().next().value);this.plucks.set(key,buffer);
    }
    const s=this.ctx.createBufferSource(),g=this.ctx.createGain();s.buffer=buffer;g.gain.setValueAtTime(.0001,at);g.gain.linearRampToValueAtTime(volume,at+.002);g.gain.exponentialRampToValueAtTime(.0001,at+1.3);s.connect(g);return this.voice(s,[s,g],this.musicBus,at,1.4,'music');
  }
  allowed(name,gap){const now=this.ctx.currentTime;if(now-(this.limits.get(name)??-Infinity)<gap)return false;this.limits.set(name,now);return true;}
  play(name,data={}){
    if(!this.ctx||this.ctx.state!=='running'||this.hidden||!this.sfxOn||!this.sfxVolume)return false;
    const gaps={hover:.075,click:.04,timingTick:.09,perfectZone:.3,fragmentLand:.065,fragmentRoll:.23,crack:.12,creak:.2,points:.12};
    if(!this.allowed(name,gaps[name]??.025))return false;
    this.eventsPlayed[name]=(this.eventsPlayed[name]??0)+1;const t=this.ctx.currentTime,a=t+(data.delay??0),p=clamp((data.power??100)/150*.65+clamp((data.speed??7)/12)*.35),v=clamp((data.speed??4)/7,.1,1),d=clamp(data.damage??.4),r=this.rand();
    const strength=clamp(data.volume??1,0,1.3);
    const tone=(f,len,vol,options={})=>this.tone(f,len,vol*strength,{at:a,...options});const noise=(len,vol,options={})=>this.noise(len,vol*strength,{at:a,...options});
    const motif=(notes,spacing,volume)=>this.motif(notes,spacing,volume,a);
    switch(name){
      case 'footstep':tone(data.surface==='mulch'?85:65,.09,.055,{end:32});noise(.12,data.surface==='grass'?.045:.075,{frequency:data.surface==='grass'?900:1400,end:280,brown:true});break;
      case 'treeHit':tone(135,.22,.23,{end:45});noise(.16,.20,{frequency:1900,end:330});break;
      case 'treeCreak':tone(145,1.4,.09,{type:'sawtooth',end:42,cutoff:480});noise(1.5,.10,{frequency:360,end:100,brown:true});break;
      case 'treeFall':tone(65,.85,.30,{end:23});noise(1.2,.26,{frequency:1800,end:120,brown:true});noise(.4,.14,{at:a+.2,frequency:3100,end:800});break;
      case 'swing':noise(.1+p*.18,.045+p*.19,{type:'bandpass',frequency:350+p*1450,end:160+p*450,q:.8});break;
      case 'woodSoft':tone(140,.18,.19,{end:48});noise(.19,.18,{frequency:1350,end:260});break;
      case 'woodHard':tone(220,.16,.18,{end:80});tone(510,.09,.05);noise(.12,.16,{frequency:2600,end:600});break;
      case 'woodIron':tone(315,.14,.19,{end:130});tone(780,.2,.055);noise(.09,.18,{frequency:3600,end:900});break;
      case 'knot':tone(460,.12,.1,{type:'triangle',end:160});noise(.14,.09,{type:'bandpass',frequency:700,q:5});break;
      case 'wet':noise(.22,.13,{frequency:630,end:180,brown:true});tone(80,.13,.09,{end:40});break;
      case 'rotten':noise(.32,.2,{frequency:900,end:160,brown:true});tone(67,.13,.1,{end:33});break;
      case 'hollow':for(const f of [175,292,417])tone(f,.38,.045,{end:f*.92});break;
      case 'glance':noise(.23,.1,{type:'highpass',frequency:2300,end:650});tone(610,.08,.055,{end:190});break;
      case 'missBlock':tone(95,.15,.15,{end:38});noise(.12,.1,{frequency:700});break;
      case 'missGround':noise(.24,.14,{frequency:420,brown:true});tone(54,.1,.07,{end:28});break;
      case 'steel':for(const [i,f]of [890,1447,2371,3599].entries())tone(f,1.1-i*.18,.1/(i+1),{end:f*.995});noise(.045,.18,{type:'highpass',frequency:4800});break;
      case 'stone':noise(.25,.19,{frequency:4300,end:1200});for(let i=0;i<3;i++)tone(440+i*247,.06,.055,{at:a+i*.035,end:160});break;
      case 'iceCrack':noise(.15,.13,{type:'highpass',frequency:3900});tone(1900,.14,.045,{end:650});break;
      case 'iceShatter':for(let i=0;i<5;i++)tone(1700+this.rand()*3100,.13,.035,{at:a+i*.027,end:900+i*190});noise(.25,.1,{frequency:6200});break;
      case 'crack':for(let i=0;i<3;i++)noise(.035+d*.055,.07+d*.06,{at:a+i*(.045-d*.025),frequency:1500+d*2600,end:500});break;
      case 'creak':tone(175-d*70,.36+d*.3,.055,{type:'sawtooth',end:65,cutoff:600});noise(.4,.04,{frequency:420,q:8,type:'bandpass'});break;
      case 'split':tone(185,.14,.24,{end:42});noise(.09,.24,{frequency:4200,end:1600});noise(.48,.19,{at:a+.035,frequency:2300,end:240});break;
      case 'fragmentLand':tone(95+v*90,.13,.025+v*.13,{end:40});noise(.1,.02+v*.1,{frequency:600+v*1200});break;
      case 'fragmentRoll':noise(.2,.02+v*.045,{frequency:330+v*500,brown:true});tone(110,.08,.02+v*.03,{end:65});break;
      case 'wedgeDrive':tone(1440,.3,.09);tone(2280,.2,.045);tone(310,.24,.06,{type:'triangle',end:170});noise(.08,.08,{frequency:1600});break;
      case 'wedgeSeat':tone(410,.09,.08,{end:200});noise(.12,.07,{frequency:600,q:6,type:'bandpass'});break;
      case 'wedgeExtract':tone(290,.32,.075,{type:'triangle',end:640});noise(.25,.08,{frequency:850,end:2300});break;
      case 'bossIntro':motif([38,45,50,57],.17,.13);noise(.5,.1,{frequency:130,brown:true});break;
      case 'bossHit':tone(49,.4,.14,{end:28});tone(146,.3,.04);break;
      case 'phaseBreak':motif([50,57,62],.11,.1);noise(.3,.1,{frequency:2100,end:400});break;
      case 'bossDefeated':motif([50,54,57,62,66,69,74],.12,.105);break;
      case 'hover':tone(720,.035,.018);break;
      case 'click':tone(430,.065,.045,{end:600});noise(.025,.025,{frequency:2100});break;
      case 'menuOpen':motif([62,69],.08,.045);break;
      case 'menuClose':motif([69,62],.06,.04);break;
      case 'purchase':motif([62,66,69,74],.085,.08);tone(1800,.11,.04,{at:a+.08});break;
      case 'denied':tone(115,.16,.06,{type:'sawtooth',end:83,cutoff:450});break;
      case 'sharpen':for(let i=0;i<3;i++)noise(.14,.085,{at:a+i*.15,type:'bandpass',frequency:2200+i*350,q:3});tone(1400,.16,.04,{at:a+.48});break;
      case 'repair':tone(900,.09,.07);tone(1350,.14,.07,{at:a+.13});break;
      case 'timingTick':tone(360,.028,.024);break;
      case 'perfectZone':tone(1320,.1,.035);break;
      case 'points':tone(740,.12,.04,{end:990});break;
      case 'combo':motif([62+Math.min(12,Math.max(0,(data.combo??1)-1)*2),69+Math.min(12,(data.combo??1)*2)],.065,.06);break;
      case 'perfect':motif([74,81,86],.065,.065);break;
      case 'levelUp':motif([57,62,66,69,74],.105,.08);break;
      case 'chapterComplete':motif([50,57,62,66,69],.15,.085);break;
      case 'campaignComplete':motif([50,54,57,62,66,69,74,78],.15,.1);break;
      case 'achievement':motif([81,78,86],.12,.065);break;
      case 'contractComplete':motif([62,66,69,74,69,74],.11,.075);break;
      case 'reset':tone(360,.11,.035,{end:180});break;
      case 'aim':tone(620,.045,.022);break;
      case 'cancel':noise(.06,.035,{frequency:600});break;
      case 'bird':for(let i=0;i<3;i++)tone(2200+r*1100,.08,.018,{at:a+i*.14,end:3400+r*700});break;
      case 'cricket':for(let i=0;i<4;i++)noise(.035,.017,{at:a+i*.095,frequency:4600,type:'bandpass',q:22});break;
      case 'drip':tone(900+r*600,.09,.022,{end:450});break;
      case 'gust':noise(2.5,.075,{frequency:450+r*350,end:160,brown:true});break;
      case 'thunder':noise(3.5,.22,{frequency:160,end:45,brown:true});tone(43,1.8,.065,{end:25});break;
      default:return false;
    }return true;
  }
  motif(notes,spacing=.1,volume=.07,t=this.ctx.currentTime){notes.forEach((n,i)=>this.tone(midi(n),.28,volume,{at:t+i*spacing,type:'triangle',cutoff:2800}));}
  celebrate(perfect=false){
    if(!this.ctx||this.ctx.state!=='running'||this.hidden||!this.sfxOn||!this.sfxVolume)return;
    const t=this.ctx.currentTime;this.duck.gain.cancelScheduledValues(t);this.duck.gain.setTargetAtTime(.28,t,.012);this.duck.gain.setTargetAtTime(1,t+.26,.18);
    this.motif(perfect?[74,78,81,86]:[62,66,69,74],.055,.065);
  }
  impact(result,log,condition={}){
    if(result.source==='miss'){this.play(Math.hypot(result.x??1,result.z??1)<.4?'missBlock':'missGround');return;}
    if(result.tool==='wedge'){this.play('wedgeDrive');}
    if(result.hazard)this.play(result.hazardKind==='stone'?'stone':'steel');
    else {
      const rottenCore=log.rotten&&(result.coreCrumbled||result.section>=(log.boss?6:4));
      this.play(rottenCore?'rotten':log.name==='Pine'?'woodSoft':log.name==='Ironwood'?'woodIron':'woodHard',{volume:clamp((result.speed??5)/8,.35,1.2)});
      if(result.knot>.45)this.play('knot');if(log.hollow)this.play('hollow');if(condition.moisture>.35)this.play('wet');
      if(condition.frost>.3)this.play(result.split||result.panelBroken?'iceShatter':'iceCrack');if(result.alignment<.6||result.accuracy<.45)this.play('glance');
    }
    if(log.boss)this.play('bossHit');
    if(result.split||result.panelBroken){this.play('split');if(log.boss&&result.panelBroken&&!result.split)this.play('phaseBreak');}
    else if(!result.hazard&&!result.braced){this.play('crack',{damage:result.damage,delay:.035});this.play('creak',{damage:result.damage,delay:.12});}
  }
  setGameState(state){if(state.boss&&!this.game.boss)this.pendingBossIntro=true;if(state.boss===false)this.pendingBossIntro=false;this.game={...this.game,...state};this.updateSection();}
  activity(){if(this.ctx)this.activityUntil=this.ctx.currentTime+18;this.game.menu=false;this.updateSection();}
  updateSection(){
    const game=this.demo?.game??this.game,active=this.ctx&&this.ctx.currentTime<this.activityUntil&&!game.menu;
    this.musicSection=active?(game.boss?'boss':'gameplay'):'menu';this.intensity=this.musicSection==='menu'?.08:clamp(.2+Math.min(10,game.combo)*.065+(this.musicSection==='boss'?.25:0));
  }
  startClock(){
    if(this.timer!==null||this.hidden||this.ctx.state!=='running')return;
    this.nextStep=this.ctx.currentTime+.045;this.nextNature=this.ctx.currentTime+.4;this.nextThunder=this.ctx.currentTime+8;this.startAmbience();this.tick();
  }
  stopClock(){if(this.timer!==null)this.timers.clearTimeout(this.timer);this.timer=null;this.musicPlaying=false;}
  tick(){
    this.timer=null;if(this.hidden||this.disposed||this.ctx.state!=='running')return;
    const now=this.ctx.currentTime;this.updateSection();
    if(this.pendingBossIntro&&!this.demo){this.play('bossIntro');this.pendingBossIntro=false;}
    if(this.demo&&now>=this.demo.next){this.demoStep();}
    this.musicPlaying=this.musicOn&&this.musicVolume>0;
    // One 25 ms look-ahead clock schedules batches on AudioContext time.
    // Late callbacks skip the gap instead of dumping an overdue note backlog.
    if(this.nextStep<now)this.nextStep=now+.025;
    let scheduled=0;
    while(this.nextStep<now+.16&&scheduled++<8){if(this.musicPlaying)this.scheduleStep(this.step,this.nextStep);this.step++;this.nextStep+=60/this.tempo()/2;}
    this.nature(now);this.timer=this.timers.setTimeout(()=>this.tick(),25);
  }
  tempo(){return this.musicSection==='menu'?78:this.musicSection==='boss'?116+this.intensity*8:104+this.intensity*10;}
  scheduleStep(step,at){
    const bar=Math.floor(step/8),s=step%8,menu=this.musicSection==='menu',boss=this.musicSection==='boss',intensity=this.intensity;
    // D / G / D / A, then Bm / G / A / D; seeded substitutions and
    // ornaments are chosen each bar, so the second eight bars develop the first.
    if(s===0||!this.chord){const roots=[50,55,50,57,59,55,57,50];let root=roots[bar%8];if(bar>7&&this.rand()<.28)root=[50,55,57,59][Math.floor(this.rand()*4)];this.chord={root,third:root+(root===59?3:4),variant:Math.floor(this.rand()*3)};}
    const {root,third,variant}=this.chord,notes=[root+12,third+12,root+19,root+24,root+19,third+12,root+14,root+19];
    if(!menu||s%2===0)this.pluck(notes[(s+variant*2)%8],at,.14+(s===0?.04:0),menu?.4:.6+intensity*.4);
    if(!menu&&intensity>.48&&s%2===1)this.pluck(root+24+[0,2,7][(bar+s)%3],at+.025,.065,1);
    if(s===0||s===4)this.tone(midi(root-12+(s===4?7:0)),menu?.5:.3,.2,{at,type:'triangle',end:midi(root-12+(s===4?7:0))*.99,cutoff:260,kind:'music',attack:.007});
    if(!menu){
      if(s===0||s===4||intensity>.65&&s===6)this.tone(110,.16,.23,{at,end:38,kind:'music'});
      if(s===2||s===6){this.noise(.09,.11,{at,frequency:1700,type:'bandpass',kind:'music'});this.noise(.045,.055,{at:at+.018,frequency:2800,kind:'music'});}
      if(intensity>.36&&s%2===1)this.noise(.035,.028+intensity*.025,{at,frequency:5000,type:'highpass',kind:'music'});
      if(boss&&s%4===0)this.tone(midi(root+12),.55,.022,{at,type:'sawtooth',cutoff:850+intensity*850,kind:'music',attack:.09});
    }
    if(!menu&&intensity>.75&&s===7&&this.rand()<.55)this.pluck(root+26,at+.12,.07,1);
  }
  startAmbience(){
    if(this.ambient.length)return;const c=this.ctx;
    for(const rain of [false,true]){const s=c.createBufferSource(),f=c.createBiquadFilter(),g=c.createGain();s.buffer=rain?this.white:this.brown;s.loop=true;f.type=rain?'highpass':'lowpass';f.frequency.value=rain?900:460;g.gain.value=0;s.connect(f).connect(g);
      this.voice(s,[s,f,g],this.ambientBus,c.currentTime,Infinity,'ambient');this.ambient.push({s,f,g,rain});}
    this.setEnvironment(this.environment,true,true);
  }
  setEnvironment(state,force=false,fromDemo=false){
    if(this.demo&&!fromDemo){this.demo.restoreEnvironment={...this.demo.restoreEnvironment,...state};return;}
    const before=this.environment;this.environment={...before,...state};const e=this.environment,night=e.hour<6||e.hour>=20;
    if(!this.ctx)return;
    const rainIntensity=clamp(e.rainIntensity??(.55+clamp(e.wind)*.45));
    const rainChanged=Math.abs(rainIntensity-(this.rainIntensity??-1))>.08;
    if(force||rainChanged||e.weather!==before.weather||night!==(before.hour<6||before.hour>=20)){
      const t=this.ctx.currentTime;for(const layer of this.ambient){const level=layer.rain?(e.weather==='rain'?.035+rainIntensity*.055:0):e.weather==='snow'?.004:e.weather==='wind'?.04:e.weather==='fog'?.009:night?.009:.018;
        layer.g.gain.cancelScheduledValues(t);layer.g.gain.setTargetAtTime(level,t,.65);}
      this.rainIntensity=rainIntensity;this.ambientBus.gain.setTargetAtTime(e.weather==='snow'?.55:1,t,.65);
    }
  }
  nature(now){
    if(now<this.nextNature)return;this.nextNature=now+1.5+this.rand()*2.5;const {weather,hour,wind}=this.environment;
    if(weather==='rain'){this.play('drip');if(now>this.nextThunder){this.play('thunder');this.nextThunder=now+18+this.rand()*22;}}
    else if(weather!=='snow'){if(hour<6||hour>=20)this.play('cricket');else if(weather==='sun'||weather==='fog')this.play('bird');}
    if(weather==='wind'||wind>.4)this.play('gust');
  }
  setHidden(hidden){
    this.hidden=hidden;if(!this.ctx)return;
    if(hidden){this.stopClock();this.clearVoices();this.ctx.suspend().catch(()=>{});}else this.unlock();
  }
  async audioDemo(seconds=60){
    if(!await this.unlock())return false;const duration=clamp(seconds,1,120);this.demo={next:this.ctx.currentTime,end:this.ctx.currentTime+duration,index:0,restoreEnvironment:{...this.environment},restoreActivity:this.activityUntil};this.activity();return true;
  }
  demoStep(){
    const d=this.demo,now=this.ctx.currentTime;if(now>=d.end){this.demo=null;this.setEnvironment(d.restoreEnvironment);this.activityUntil=d.restoreActivity;this.updateSection();return;}
    const i=d.index++;d.next=now+1.15;d.game={combo:Math.min(10,Math.floor(i/3)),boss:i%24>=16,menu:i<4};this.activityUntil=now+4;
    this.setEnvironment({weather:['sun','rain','wind','snow'][Math.floor(i/12)%4],hour:i%40>32?23:16.5},false,true);this.updateSection();
    this.play('swing',{power:40+i%5*27});
    const events=['woodSoft','woodHard','woodIron','knot','wet','rotten','hollow','glance','missBlock','missGround','steel','stone','iceCrack','iceShatter','crack','creak','wedgeDrive','wedgeSeat','wedgeExtract','bossIntro','bossHit','phaseBreak','bossDefeated','split'];
    this.play(events[i%events.length],{delay:.22,damage:(i%5)/5});this.play('fragmentLand',{speed:1+i%6,delay:.53});
    if(i%4===3){this.play('combo',{combo:1+i%8});this.celebrate(i%8===7);}
  }
  dispose(){this.disposed=true;this.stopClock();this.clearVoices();this.doc?.removeEventListener('visibilitychange',this.visibility);if(this.ctx){this.ctx.onstatechange=null;for(const n of [this.master,this.peakGuard,this.limiter,this.musicBus,this.sfxBus,this.ambientBus,this.duck])n.disconnect();this.ctx.close().catch(()=>{});}this.plucks.clear();}
}

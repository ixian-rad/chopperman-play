// Pure progression rules: no renderer dependency, also used by the smoke tests.
export const LOGS = [
  {name:'Pine', threshold:42, mass:3.0, color:0xf2d6a0, knot:false, grain:0, tip:'A forgiving start. Pull down on the log and release.'},
  {name:'Oak', threshold:72, mass:3.6, color:0xd8b27c, knot:false, grain:.32, tip:'Dense grain. Revisit your crack or drive a wedge.'},
  {name:'Hickory', threshold:96, mass:4.2, color:0xc6aa85, knot:false, grain:-.38, tip:'Long tough fibers. Match the grain to open a deep cut.'},
  {name:'Knotty oak', threshold:110, mass:3.9, color:0xc79e6a, knot:true, hazard:true, grain:.18, tip:'Work around the dark knot. Steel damages your edge.'},
  {name:'Twisted elm', threshold:122, mass:4.4, color:0xbc9468, knot:true, twist:.65, grain:-.22, tip:'Interlocked fibers turn across the face. A wedge follows an open crack.'},
  {name:'Ironwood', threshold:168, mass:5.8, color:0xaa8260, knot:false, grain:.45, tip:'Very dense wood. Open a cut, then let the wedge do the work.'}
];
export const CHAPTERS=['First firewood','Read the rings','Stubborn fibers','Hidden steel','Against the twist','The iron crown'];
export const BOSS_NAMES=['The Big Pine','Old Yard Oak','Hickory Heart','The Nailkeeper','The Tangle','The Iron Crown'];
export const WEATHER = {
  sun:{label:'Dry wood · steady grip', resistance:1, friction:.74, wind:0},
  rain:{label:'Wet wood · +18% resistance · slippery', resistance:1.18, friction:.24, wind:.009},
  snow:{brittle:true,label:'Frozen grain · +12% resistance · brittle center', resistance:1.12, friction:.36, wind:.005},
  wind:{label:'Gusts · aim drifts up to 2 cm', resistance:1, friction:.65, wind:.02},
  fog:{label:'Damp wood · +8% resistance · low visibility', resistance:1.08, friction:.58, wind:.003}
};
export const STORAGE_KEY='backyard-grain-v2';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export class Game {
  constructor(storage){this.storage=storage;this.reset(false);this.storageAvailable=!!storage;try{const p=JSON.parse(storage?.getItem(STORAGE_KEY)||'null');if(p?.version===2){for(const k of ['score','xp','coins','clears'])if(Number.isFinite(p[k]))this[k]=clamp(Math.floor(p[k]),0,1e9);this.edge=clamp(Number.isFinite(p.edge)?p.edge:1,.65,1);this.partialXP=clamp(Math.floor(Number(p.partialXP)||0),0,12);for(const k of ['sharpness','weight','stamina'])this.upgrades[k]=clamp(Math.floor(Number(p.upgrades?.[k])||0),0,5);}}catch{this.storageAvailable=false;}this.stamina=this.maxStamina;}
  get level(){return 1+Math.floor(Math.sqrt(this.xp/100));}
  get chapter(){return Math.min(LOGS.length-1,Math.floor(this.clears/3));}
  get campaignComplete(){return this.clears>=LOGS.length*3;}
  get log(){const chapter=this.chapter,base=LOGS[chapter],boss=this.clears%3===2;return {...base,boss,bossName:boss?BOSS_NAMES[chapter]:null,burl:chapter===3&&this.clears%3!==0,mineral:chapter===5&&boss,stony:chapter===5&&this.clears%3!==0,hollow:chapter===1&&this.clears%3!==0,forked:chapter===4&&this.clears%3!==0,rotten:chapter===2&&this.clears%3!==0,radius:boss?.32:.225,threshold:base.threshold*(boss?2.5:1),mass:base.mass*(boss?2:1),chapter:chapter+1,round:this.clears%3+1};}
  get maxStamina(){return 100+this.upgrades.stamina*12;}
  get axeMass(){return 2.4+this.upgrades.weight*.28;}
  get sharpness(){return (1+this.upgrades.sharpness*.12)*this.edge;}
  get cost(){return 20+this.upgrades.weight*1.5;}
  regenerate(dt){this.stamina=clamp(this.stamina+dt*(7+this.upgrades.stamina*1.4),0,this.maxStamina);}
  begin(cost=this.cost){if(this.stamina<cost)return false;this.stamina-=cost;this.save();return true;}
  hit(result,log=this.log){
    const boss=log.boss,miss=result.source==='miss'||result.braced;
    const clean=result.split&&result.accuracy>=.72&&result.alignment>=.82&&!result.hazard&&result.tool!=='wedge';
    this.combo=clean?this.combo+1:0;this.bestCombo=Math.max(this.bestCombo,this.combo);
    const penalty=result.hazard?35:Math.round((1-result.accuracy)*22+(1-result.alignment)*16);
    let points=Math.max(0,Math.round((result.split?90:12)*result.accuracy*result.alignment*(1+Math.min(this.combo,10)*.16))-penalty);
    if(miss||result.contract&&!result.split)points=0;
    if(Number.isFinite(result.precisionPoints))points=miss?0:result.precisionPoints;
    const gainedXP=miss?0:result.split?30+(clean?15:0)+(boss?75:0):result.hazard?0:Math.min(3,12-this.partialXP);
    if(result.split)this.partialXP=0;else this.partialXP+=gainedXP;
    const coins=miss?0:result.split?25+(clean?10:0)+(boss?60:0):0;
    if(result.hazard)this.edge=clamp(this.edge-(result.hazardKind==='stone'?.12:.18),.65,1);
    this.score+=points;if(this.award)this.award({xp:gainedXP,gold:coins,reason:'Log chopping'});else{this.xp+=gainedXP;this.coins+=coins;}if(result.split){this.clears++;this.stamina=clamp(this.stamina+(boss?40:15),0,this.maxStamina);}
    this.lastHit={...result,clean,boss,points,xp:gainedXP,coins,combo:this.combo,campaignVictory:result.split&&!result.contract&&this.clears===18};this.save();return this.lastHit;
  }
  price(stat){return 70*(this.upgrades[stat]+1);}
  upgrade(stat){if(!(stat in this.upgrades)||this.upgrades[stat]>=5||this.coins<this.price(stat))return false;this.coins-=this.price(stat);this.upgrades[stat]++;this.save();return true;}
  repair(){if(this.edge>=1||this.coins<12)return false;this.coins-=12;this.edge=1;this.save();return true;}
  save(){try{this.storage?.setItem(STORAGE_KEY,JSON.stringify({version:2,score:this.score,xp:this.xp,coins:this.coins,clears:this.clears,edge:this.edge,partialXP:this.partialXP,upgrades:this.upgrades}));this.storageAvailable=!!this.storage;}catch{this.storageAvailable=false;}}
  reset(persist=true){this.score=0;this.combo=0;this.bestCombo=0;this.xp=0;this.coins=0;this.clears=0;this.stamina=100;this.edge=1;this.upgrades={sharpness:0,weight:0,stamina:0};this.lastHit=null;this.partialXP=0;if(persist)this.save();}
  snapshot(log=this.log){return {score:this.score,combo:this.combo,xp:this.xp,level:this.level,stamina:this.stamina,logType:log.name,partialXP:this.partialXP,burl:!!log.burl,mineral:!!log.mineral,stony:!!log.stony,hollow:!!log.hollow,rotten:!!log.rotten,forked:!!log.forked,boss:!!log.boss,bossName:log.bossName,chapter:log.chapter,chapterName:CHAPTERS[(log.chapter??1)-1],round:log.round,campaignComplete:this.campaignComplete,edge:this.edge,sharpness:this.sharpness,axeMass:this.axeMass,lastHit:this.lastHit,coins:this.coins,upgrades:{...this.upgrades},maxStamina:this.maxStamina,clears:this.clears};}
}

import { LOGS } from './game.js';
import { precisionGrade } from './mechanics.js';

export const CHALLENGE_KEY='backyard-contracts-v1';
export function dailySeed(date=new Date()){return date.toISOString().slice(0,10);}
function hash(text){let h=2166136261;for(const c of text)h=Math.imul(h^c.charCodeAt(0),16777619);return h>>>0;}
export function contractRound(mode,seed,index){
  if(mode==='precision'){
    const i=Math.min(index,5),base=LOGS[[0,1,3,1,5,5][i]],grain=[.2,-.5,.18,.7,.45,-.3][i];
    const [x,z,power]=[[.045,-.04,65],[-.065,.045,80],[.005,.09,95],[.075,.06,70],[-.055,.065,90],[-.095,.015,105]][i];
    return {...base,grain,stony:i>=4,hollow:false,rotten:false,forked:false,boss:false,bossName:null,radius:.225,mass:base.mass,threshold:base.threshold*.18,chapter:1,round:index+1,weather:'sun',precisionTarget:{x,z,power}};
  }
  const value=hash(`${seed}:${index}`),chapter=mode==='daily'?(index===0?0:1+value%4):Math.min(5,Math.floor(index/3));
  const boss=mode==='daily'?index===5:index%5===4;
  const hollow=mode==='daily'?index===1||boss:chapter===1;
  const base=LOGS[hollow?1:chapter];
  return {...base,grain:((value%1000)/1000-.5)*1.2,hollow,stony:!hollow&&chapter===5,rotten:!hollow&&chapter===2,forked:!hollow&&chapter===4,boss,bossName:boss?(hollow?'The Hollow Sentinel':'Contract champion'):null,radius:boss?.32:.225,mass:base.mass*(boss?2:1),threshold:base.threshold*(boss?2.5:1),chapter:(hollow?1:chapter)+1,round:index+1,weather:['sun','rain','snow','wind'][value>>>10&3]};
}
export function compareResults(a,b){
  if(!b)return 1;
  return a.score-b.score||(b.elapsed??Infinity)-a.elapsed||(b.misses??Infinity)-a.misses||(b.swings??Infinity)-a.swings;
}
export function contractMedal(result){
  if(!result.clears)return 'Practice';
  const accuracy=1-result.misses/Math.max(1,result.swings);
  if(result.mode==='precision')return result.clears<6?'Practice':result.score>=690&&result.bullseyes>=4&&result.misses===0?'Gold':result.score>=480?'Silver':'Bronze';
  if(result.mode==='daily')return result.clears<6?'Practice':result.elapsed<=90&&result.misses===0&&result.cleanSplits>=3?'Gold':result.elapsed<=150&&accuracy>=.8?'Silver':'Bronze';
  return result.clears>=6&&accuracy>=.9?'Gold':result.clears>=4&&accuracy>=.8?'Silver':'Bronze';
}
export class Contract {
  constructor(mode,seed=dailySeed(),storage){
    this.mode=mode;this.seed=seed;this.storage=storage;this.round=0;this.elapsed=0;this.started=false;this.finished=false;this.swings=0;this.misses=0;this.clean=0;this.best=0;this.bestRecord=null;this.result=null;this.history=[];
    this.pendingQuality=0;this.pendingAttempts=0;this.bullseyes=0;this.precisionCombo=0;this.lastGrade=null;
    try{
      const records=JSON.parse(storage?.getItem(CHALLENGE_KEY)||'{}'),record=records?.[this.key];
      if(typeof record==='number'&&Number.isFinite(record))this.best=record;
      else if(record&&Number.isFinite(record.score)){this.best=record.score;this.bestRecord=record;}
      this.history=Array.isArray(records?._history)?records._history.slice(0,5):[];
    }catch{/* Optional results storage. */}
  }
  get key(){return this.mode==='daily'?`daily:${this.seed}`:this.mode==='precision'?'precision:v1':'time';}
  get log(){return contractRound(this.mode,this.seed,this.round);}
  get remaining(){return this.mode==='time'?Math.max(0,90-this.elapsed):null;}
  begin(){if(this.finished||this.mode==='precision'&&this.swings>=12)return false;this.started=true;this.swings++;return true;}
  grade(result,log=this.log){
    if(this.mode!=='precision'||this.finished)return {};
    const grade=precisionGrade(result,log.precisionTarget);
    this.pendingQuality+=grade.quality;this.pendingAttempts++;
    let points=0;
    if(result.split){
      const first=this.pendingAttempts===1;
      this.precisionCombo=first&&grade.bullseye?this.precisionCombo+1:0;
      if(first&&grade.bullseye)this.bullseyes++;
      points=Math.round(this.pendingQuality/this.pendingAttempts)+(first?25:0)+Math.min(3,this.precisionCombo)*10;
      this.pendingQuality=0;this.pendingAttempts=0;
    }
    this.lastGrade={...grade,points};return {precisionPoints:points,precisionGrade:{...this.lastGrade}};
  }
  tick(dt,score){if(!this.started||this.finished)return;this.elapsed+=Math.max(0,dt);if(this.mode==='time'&&this.elapsed>=90){this.elapsed=90;this.finish(score);}}
  hit(hit,score){if(this.finished)return;if(hit.source==='miss')this.misses++;if(hit.clean)this.clean++;if(hit.split)this.round++;if((this.mode==='daily'||this.mode==='precision')&&this.round>=6||this.mode==='precision'&&this.swings>=12)this.finish(score);}
  finish(score){
    if(this.finished)return;this.finished=true;
    const result={mode:this.mode,seed:this.seed,score,elapsed:this.elapsed,clears:this.round,swings:this.swings,misses:this.misses,cleanSplits:this.clean,bullseyes:this.bullseyes};
    result.medal=contractMedal(result);result.newBest=compareResults(result,this.bestRecord??(this.best?{score:this.best}:null))>0;
    this.result=result;if(result.newBest){this.bestRecord={...result};this.best=score;}
    this.history=[{...result},...this.history].slice(0,5);
    try{const stored=JSON.parse(this.storage?.getItem(CHALLENGE_KEY)||'{}'),records=stored&&typeof stored==='object'&&!Array.isArray(stored)?stored:{};records[this.key]=this.bestRecord??this.best;records._history=this.history;this.storage?.setItem(CHALLENGE_KEY,JSON.stringify(records));}catch{/* Session result is still displayed. */}
  }
  snapshot(){return {mode:this.mode,seed:this.seed,started:this.started,finished:this.finished,elapsed:this.elapsed,remaining:this.remaining,clears:this.round,swings:this.swings,misses:this.misses,cleanSplits:this.clean,bullseyes:this.bullseyes,attemptsLeft:this.mode==='precision'?Math.max(0,12-this.swings):null,target:this.mode==='precision'?{...this.log.precisionTarget}:null,lastGrade:this.lastGrade?{...this.lastGrade}:null,best:this.best,bestRecord:this.bestRecord?{...this.bestRecord}:null,result:this.result?{...this.result}:null,history:this.history.map(r=>({...r}))};}
}

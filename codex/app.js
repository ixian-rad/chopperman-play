import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createWoodMaterials, standard, mesh } from './environment.js';
import { createHumanoid } from './humanoid.js';
import { AssetBackyard } from './assets-v2.js';
import { Simulation } from './physics.js';
import { Game, WEATHER, CHAPTERS } from './game.js';
import { Contract, dailySeed } from './challenges.js';
import { grainAt, crackPoint, LOG_RADIUS, LOG_TOP, evolveCondition, conditionPhysics, pullGesture, inclusions, inclusionAt, knotAt, burlSectorAt } from './mechanics.js';
import { Atmosphere } from './atmosphere.js';
import { AudioManager } from './audio.js';

const $=id=>document.getElementById(id);
const viewport=$('viewport');if(innerWidth<=760)$('conditions').open=false;
if(innerWidth<=760)$('grain-reader').open=false;
const renderer=new THREE.WebGLRenderer({antialias:false,powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(window.devicePixelRatio,1));renderer.setSize(innerWidth,innerHeight);
renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.12;
viewport.appendChild(renderer.domElement);
const scene=new THREE.Scene();scene.background=new THREE.Color(0xdce2d2);scene.fog=new THREE.Fog(0xdce2d2,18,48);
const reflectionGenerator=new THREE.PMREMGenerator(renderer),reflectionRoom=new RoomEnvironment();
const reflection=reflectionGenerator.fromScene(reflectionRoom,.04);scene.environment=reflection.texture;scene.environmentIntensity=.35;reflectionRoom.dispose();reflectionGenerator.dispose();
const ambient=new THREE.HemisphereLight(0xf7f1dc,0x78825b,2.25);scene.add(ambient);
const sun=new THREE.DirectionalLight(0xffe2ac,3.25);sun.position.set(-3.5,8,4.5);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);sun.shadow.camera.left=-10;sun.shadow.camera.right=10;sun.shadow.camera.top=10;sun.shadow.camera.bottom=-10;sun.shadow.camera.near=.5;sun.shadow.camera.far=30;sun.shadow.normalBias=.025;sun.shadow.bias=-.0003;sun.shadow.radius=4;sun.target.position.set(0,.3,-1);scene.add(sun,sun.target);
const fill=new THREE.DirectionalLight(0xd8e8e1,.5);fill.position.set(4,3,-5);scene.add(fill);
const camera=new THREE.PerspectiveCamera(37,innerWidth/innerHeight,.1,240);
const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=.065;controls.minDistance=3.4;controls.maxDistance=20;controls.maxPolarAngle=Math.PI/2-.035;controls.minPolarAngle=.18;controls.target.set(-.7,1,-.32);controls.enablePan=false;controls.mouseButtons={LEFT:null,MIDDLE:THREE.MOUSE.DOLLY,RIGHT:THREE.MOUSE.ROTATE};controls.touches={ONE:null,TWO:THREE.TOUCH.DOLLY_ROTATE};controls.screenSpacePanning=false;
function resetCamera(){
  camera.position.set(innerWidth<=760?3.6:3.3,innerWidth<=760?3.3:2.65,innerWidth<=760?7.2:6.5);
  controls.target.set(-.05,innerWidth<=760?1.05:1.15,-.3);camera.fov=innerWidth<=760?48:45;
  camera.updateProjectionMatrix();controls.update();
}resetCamera();
const wood=createWoodMaterials();
// The original hand-built character remains an asset-load fallback.
const actor=createHumanoid(scene);actor.group.visible=false;
let backyard;
let storage;try{if(!new URLSearchParams(location.search).has('test'))storage=localStorage;}catch{/* Session play is available without storage. */}
const audio=new AudioManager({storage});
const campaignGame=new Game(storage);let game=campaignGame,contract=null,contractLastTick=performance.now();
let condition={moisture:.08,frost:0},campaignConditions=null;const frostColor=new THREE.Color(0xdce4df);
function equippedToolStats(){
  const axe=contract?'sergey':backyard?.axe??'sergey';
  return {axeMass:game.axeMass+(axe==='maul'?.55:0),sharpness:game.sharpness*(axe==='golden'?1.12:axe==='double_bit'?1.04:1)};
}
function physicalWeather(){return conditionPhysics(condition,WEATHER[atmosphere.weather]);}
const atmosphere=new Atmosphere(scene,sun,ambient,wood);
let currentLog=game.log,aim={x:0,z:0},yaw=currentLog.grain,slowMotion=false,armed=false,meterStart=0,meter=.82,feedbackUntil=0;
let lowPixelScale=.4;
let quality='medium',qualityMode='auto',composer,postLoading=false,qualityEpoch=0;
let fps=60,frameTime=0,frames=0,qualityClock=0,lastReadout=0,lastSave=0;
const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)').matches;
let impactEffects=!reducedMotion,hitStopUntil=0,perfectUntil=0,shakeUntil=0,shakeStrength=0;
$('impact-effects').checked=impactEffects;
const simulation=new Simulation(scene,wood,result=>{
  if(contract?.finished)return;
  const previousLevel=game.level,previousBestCombo=game.bestCombo;
  const graded=contract?.grade(result,currentLog)??{};const hit=game.hit({...result,...graded,contract:!!contract},currentLog);contract?.hit(hit,game.score);
  const perfectPrecision=!!hit.precisionGrade?.bullseye&&result.split;
  $('energy').textContent=Math.round(result.energy);$('fracture').textContent=result.panelBroken&&!result.split?`${result.remainingPanels} ${currentLog.burl?'stump sections':currentLog.mineral?'stone-bound sections':currentLog.rotten?'pieces':currentLog.forked?'sections':'walls'} remain`:result.split?`Split into ${simulation.dynamic.length}`:result.source==='miss'?'Missed':result.hazard?result.hazardKind==='stone'?'Embedded stone!':'Steel staple!':`${Math.round(result.damage*100)}% · grain holding`;$('penetration').textContent=`${Math.round(result.penetration*1000)} mm`;
  $('hit-title').textContent=perfectPrecision&&!contract?.finished?`${contract.precisionCombo}× · Bullseye. Grain and power matched.`:contract?.finished?'Contract complete.':result.coreCrumbled&&!result.split?'The rotten heart crumbles.':result.braced?'The limbs brace this crotch.':result.panelBroken&&!result.split?currentLog.burl?result.section===1?'The knot heart breaks free.':'A flank peels away. The heart relaxes.':currentLog.mineral?'A stone-bound section breaks free.':currentLog.forked?result.remainingPanels===1?'Both limbs down. Open the crotch.':'A limb breaks free.':'A wall breaks free.':hit.campaignVictory?'The Iron Crown is yours.':hit.boss&&result.split?'Boss timber down!':result.hazard?result.hazardKind==='stone'?'Stone! Your edge is chipped.':'Steel! Your edge is chipped.':hit.clean?`${game.combo>1?game.combo+'× · ':''}Right through the grain.`:result.split?result.tool==='wedge'?'The wedge opens it up.':'Wood gives way.':result.source==='miss'?currentLog.hollow||currentLog.rotten?'Empty space. Aim for a wall.':'Just wide.':result.alignment<.6?'Turn with the grain.':result.knot>.5?'Work around the knot.':'A deeper cut. Keep working it.';
  $('hit-detail').textContent=`+${hit.points} points · +${hit.xp} XP · +${hit.coins} coins${result.split?'':` · ${Math.min(99,Math.round(simulation.damage*100))}% fractured`}${result.hazard?` · −${Math.round(result.edgeWear*100)}% edge`:''}${hit.precisionGrade?` · precision ${hit.precisionGrade.quality}/100${hit.precisionGrade.bullseye?' · BULLSEYE':''}`:''}`;
  $('hit-feedback').classList.add('visible');feedbackUntil=performance.now()+3600;
  $('scene-status').textContent=result.coreCrumbled&&!result.split?'Soft core gone. The dense outer walls still hold. C finds a standing wall.':contract?.finished?`Contract complete · ${game.score} points · best ${contract.best}. Replay or return to campaign.`:result.braced?'Take off both upper limbs first. C aims at a standing limb.':result.panelBroken&&!result.split?currentLog.burl?`${result.remainingPanels} stump sections remain. Each removed flank eases the knot heart. C finds the next safe cut.`:currentLog.mineral?`${result.remainingPanels} stone-bound sections remain. Each holds its own cuts. C finds safe grain in the next section.`:currentLog.forked?result.remainingPanels===1?'The interlocked crotch is exposed. Follow its grain; W can finish the cut.':'One limb remains. Aim at its end grain; C finds it.':`${result.remainingPanels} walls remain. Aim at another standing wall.`:hit.campaignVictory?'Campaign complete! Keep chopping ironwood in the open yard.':result.split?hit.boss?'Chapter cleared! +60 boss coins, +75 XP, and a second wind.':'Split complete. +15 stamina. Next log when you are.':result.hazard?'Work around visible steel and stone. Repair the edge in the tool shed for 12 coins.':result.source==='miss'?currentLog.hollow||currentLog.rotten?'Strike the standing rim. C aligns with the next wall.':'Aim inside the end grain. C centers your strike.':'Follow the same crack, or press W to drive a wedge.';
  if(impactEffects&&result.energy>0){const now=performance.now();hitStopUntil=now+(hit.clean||perfectPrecision?65:40);perfectUntil=hit.clean||perfectPrecision?now+350:0;shakeUntil=now+(result.split?280:150);shakeStrength=result.hazard?.018:result.split?.035:.013;}
  if(result.hazard)atmosphere.spark(result.x,result.z);
  if(result.panelBroken)game.stamina=Math.min(game.maxStamina,game.stamina+8);
  guide.visible=!result.split;audio.impact(result,currentLog,condition);
  if(hit.points>0)audio.play('points');
  if(hit.combo>1)audio.play('combo',{combo:hit.combo});
  if(hit.clean||hit.precisionGrade?.bullseye){audio.play('perfect');audio.celebrate(!!hit.precisionGrade?.bullseye);}
  if(game.level>previousLevel)audio.play('levelUp');
  if(game.level>previousLevel||result.split&&hit.boss)backyard?.celebrate();
  if(hit.combo>=5&&previousBestCombo<5)audio.play('achievement');
  if(result.split&&hit.boss){audio.play('bossDefeated');audio.play('chapterComplete',{delay:.7});}
  if(hit.campaignVictory)audio.play('campaignComplete',{delay:1.1});
  updateHUD();
});
simulation.onSoundEvent=(name,data)=>audio.play(name,data);
simulation.configure({log:currentLog,recoil:impactEffects});simulation.reset();

// End-grain target, grain direction, knot and staple all share the physics coordinates.
const guide=new THREE.Group();scene.add(guide);guide.position.y=1.338;
const ring=mesh(new THREE.RingGeometry(.035,.042,48),new THREE.MeshBasicMaterial({color:0xf7e6bc,side:THREE.DoubleSide,depthWrite:false}),guide);ring.rotation.x=-Math.PI/2;ring.castShadow=false;
const bladeGuide=mesh(new THREE.BoxGeometry(.009,.003,.07),new THREE.MeshBasicMaterial({color:0xb64b2d}),guide);bladeGuide.position.y=.004;bladeGuide.castShadow=false;
const grainGuide=new THREE.Group();guide.add(grainGuide);
for(const x of [-.018,.018]){const g=mesh(new THREE.BoxGeometry(.002,.002,.35),new THREE.MeshBasicMaterial({color:0x6d552c,transparent:true,opacity:.65}),grainGuide,[x,0,0]);g.castShadow=false;}
const knot=mesh(new THREE.CircleGeometry(.041,24),standard(0x62482d,{roughness:.95}),guide,[.075,.001,-.025]);knot.rotation.x=-Math.PI/2;knot.scale.y=.68;knot.castShadow=false;
const knotRing=mesh(new THREE.RingGeometry(.046,.049,24),standard(0x8c653b),guide,[.075,.002,-.025]);knotRing.rotation.x=-Math.PI/2;knotRing.scale.y=.7;knotRing.castShadow=false;
const precisionMarker=new THREE.Group();guide.add(precisionMarker);
for(const radius of [.025,.055]){const marker=mesh(new THREE.RingGeometry(radius-.0015,radius,32),new THREE.MeshBasicMaterial({color:0x4ff5c8,side:THREE.DoubleSide,depthWrite:false}),precisionMarker);marker.rotation.x=-Math.PI/2;marker.castShadow=false;}
const wedgeGuide=mesh(new THREE.RingGeometry(.014,.019,24),new THREE.MeshBasicMaterial({color:0xf5bb49,side:THREE.DoubleSide,depthWrite:false}),guide);wedgeGuide.rotation.x=-Math.PI/2;wedgeGuide.castShadow=false;
function updateGuide(){simulation.wedgeAim={...aim};guide.position.y=(simulation.surfaceAt(aim.x,aim.z)?.top??LOG_TOP)+.005;guide.visible=!simulation.split;ring.position.set(aim.x,.004,aim.z);bladeGuide.position.set(aim.x,.006,aim.z);bladeGuide.rotation.y=yaw;grainGuide.rotation.y=grainAt(simulation.materialLog,aim.x,aim.z);grainGuide.position.set(aim.x,0,aim.z);grainGuide.scale.z=(currentLog.burl||currentLog.hollow||currentLog.forked||currentLog.rotten||currentLog.mineral)?.36:(currentLog.radius??LOG_RADIUS)/LOG_RADIUS;const knotCenter=knotAt(currentLog);knot.position.set(knotCenter.x,.001,knotCenter.z);knotRing.position.set(knotCenter.x,.002,knotCenter.z);knot.visible=knotRing.visible=!!currentLog.knot&&!currentLog.forked&&(!currentLog.burl||!simulation.shell[1]?.released);precisionMarker.visible=!!currentLog.precisionTarget;if(currentLog.precisionTarget)precisionMarker.position.set(currentLog.precisionTarget.x,.009,currentLog.precisionTarget.z);const danger=inclusionAt(simulation.materialLog,aim.x,aim.z,yaw);ring.material.color.setHex(danger?0xff643c:0xf7e6bc);const cut=simulation.wedgeCrack;wedgeGuide.visible=!!cut;if(cut)wedgeGuide.position.set(cut.x,(simulation.surfaceAt(cut.x,cut.z)?.top??LOG_TOP)-guide.position.y+.012,cut.z);drawGrainReader();}

const modeName=mode=>mode==='daily'?'DAILY SIX':mode==='precision'?'PRECISION SIX':'90 SECOND SPRINT';
let resultsSignature='';
function updateResults(){
  const result=contract?.result;$('contract-results').hidden=!result;
  if(!result){resultsSignature='';return;}
  const signature=JSON.stringify(result);if(signature===resultsSignature)return;resultsSignature=signature;audio.play('contractComplete');if(result.newBest)audio.play('achievement',{delay:.5});
  $('result-medal').textContent=`${result.medal.toUpperCase()} · ${modeName(contract.mode)}`;
  $('contract-results').dataset.medal=result.medal.toLowerCase();
  $('result-score').textContent=`${result.score.toLocaleString()} points`;
  $('result-detail').textContent=`${result.clears} logs · ${result.elapsed.toFixed(1)}s · ${result.swings} swings · ${result.misses} misses · ${result.cleanSplits} clean splits${result.mode==='precision'?` · ${result.bullseyes} bullseyes`:''}`;
  $('result-record').textContent=result.newBest?'Personal best!':`Best ${contract.best} points${contract.bestRecord?` · ${contract.bestRecord.elapsed.toFixed(1)}s · ${contract.bestRecord.misses} misses`:''}`;
  const list=$('result-history');list.replaceChildren();
  for(const run of contract.history){const item=document.createElement('li');item.textContent=`${run.mode==='daily'?run.seed:run.mode==='precision'?'Precision':'Sprint'} · ${run.medal} · ${run.score} pts · ${Number(run.elapsed).toFixed(1)}s · ${run.misses} misses`;list.appendChild(item);}
}
function updateHUD(){
  $('yard-wallet').textContent=`${campaignGame.coins} coins · ${campaignGame.xp} XP`;
  $('control-panel').dataset.mode=contract?.mode??'campaign';
  const locked=!!contract?.finished;
  audio.setGameState({combo:contract?.mode==='precision'?contract.precisionCombo:game.combo,boss:!!currentLog.boss&&!simulation.split,menu:!!contract?.finished||!!$('help-dialog').open});
  updateResults();
  $('start-contract').disabled=simulation.running;
  $('contract-status').textContent=contract?contract.finished?`FINISHED · ${game.score} pts · BEST ${contract.best}`:contract.mode==='precision'?`${contract.round} / 6 logs · ${12-contract.swings} strikes left · ${contract.bullseyes} bullseyes`:contract.mode==='daily'?`${contract.seed} UTC · ${contract.round} / 6 logs · ${Math.floor(contract.elapsed)}s`:`${Math.ceil(contract.remaining)}s · ${contract.round} logs · BEST ${contract.best}`:'Campaign progress saves automatically.';
  $('contract-status').classList.toggle('finished',locked);
  const level=game.level,base=100*(level-1)**2,next=100*level**2;
  $('score').textContent=game.score.toLocaleString();const combo=contract?.mode==='precision'?contract.precisionCombo:game.combo;$('combo').textContent=combo?`${combo}×`:'—';$('level').textContent=`LV ${level}`;$('xp-label').textContent=`${game.xp-base} / ${next-base} XP`;$('xp').max=next-base;$('xp').value=game.xp-base;
  $('stamina').max=game.maxStamina;$('stamina').value=game.stamina;$('stamina-label').textContent=Math.floor(game.stamina);
  $('log-type').textContent=currentLog.boss?currentLog.bossName:currentLog.burl?'Knot-bound stump':currentLog.rotten?'Heart-rotted hickory':currentLog.name;$('log-count').textContent=currentLog.boss?'BOSS':`LOG ${String(game.clears+(simulation.split?0:1)).padStart(2,'0')}`;
  $('campaign-label').textContent=contract?`${modeName(contract.mode)} · ${contract.finished?'FINISHED':!contract.started?'STARTS ON FIRST SWING':contract.mode==='time'?`${Math.ceil(contract.remaining)}s LEFT`:`${contract.round} / 6 · ${Math.floor(contract.elapsed)}s`}`:game.campaignComplete?'CAMPAIGN CLEARED · OPEN YARD':`CHAPTER ${currentLog.chapter} / 6 · ${CHAPTERS[currentLog.chapter-1]}`;
  $('campaign-progress').max=contract&&contract.mode!=='time'?6:18;$('campaign-progress').value=contract?contract.round:Math.min(18,game.clears);$('campaign-progress').setAttribute('aria-valuetext',contract?`${contract.round} contract logs cleared`:`${Math.min(18,game.clears)} of 18 logs cleared`);
  $('control-panel').classList.toggle('boss-round',!!currentLog.boss);
  $('center-button').textContent=currentLog.precisionTarget?'◎ Aim precision target':currentLog.burl?'◎ Find safe peeling cut':currentLog.stony?'◎ Find safe grain':currentLog.rotten?simulation.snapshot().coreRemaining?'◎ Aim soft core':'◎ Aim standing wall':currentLog.forked?'◎ Aim next section':currentLog.hollow?'◎ Aim standing wall':'◎ Center aim';
  $('log-tip').textContent=currentLog.precisionTarget?`Precision · mint bullseye, local grain, ${currentLog.precisionTarget.power}% power. Six logs / twelve strikes. First-strike bullseyes build a bonus.`:currentLog.burl?`Knot-bound stump · ${simulation.shell.filter(p=>!p.released).length} pieces. Peel the flanks to ease the knot heart (${simulation.snapshot().confinement.toFixed(2)}× resistance). Steel lies in the left flank. C finds safe grain; W follows your cut.`:currentLog.stony?currentLog.mineral?`The Iron Crown · ${simulation.shell.filter(p=>!p.released).length} stone-bound sections. Faint seams show their borders. Deepen a safe cut in each; aim at its dark kerf and W to wedge. C finds the next section.`:'Stone-bound ironwood · pale, angular inclusions chip the edge by 12%. The aim ring turns orange when the blade would touch stone. Work beside it.':currentLog.rotten?simulation.snapshot().coreRemaining?'Heart rot · dark, spongy core crumbles easily. Its work stays separate from the dense outer walls. C finds the core.':'Core cleared · strike the solid rim and turn the blade radially. Every outer wall must fall to finish. C finds one.':currentLog.forked?simulation.snapshot().phase==='limbs'?'Forked elm · remove both leaning limbs, then split the tough crotch. Each limb has its own grain. C finds the next section.':'Crotch exposed · interlocked fibers resist. Open a cut and drive the wedge.':currentLog.hollow?`Hollow oak · ${simulation.shell.filter(p=>!p.released).length} walls remain. Aim halfway across the rim; align the blade radially. C finds a standing wall.`:currentLog.boss?`${currentLog.name} · oversized round. Follow a crack; W drives the wedge. +60 boss coins.`:currentLog.tip;
  $('coins').textContent=`${game.coins} coins`;$('axe-stats').textContent=`${equippedToolStats().axeMass.toFixed(2)} kg · cutting ${Math.round(equippedToolStats().sharpness*100)}% · edge ${Math.round(game.edge*100)}%`;
  $('repair-edge').disabled=locked||simulation.running||game.edge>=1||game.coins<12;
  $('wedge-button').disabled=locked||!simulation.wedgeReady||game.stamina<12;
  $('wedge-button').textContent=simulation.wedgeReady?simulation.seatedWedge?'Drive seated wedge · 12 stamina [W]':'Seat / drive selected cut · 12 stamina [W]':simulation.bestCrack?.depth>=.018?'Aim near a dark cut to place wedge':'Wedge · open a cut first';
  $('extract-wedge').hidden=!simulation.seatedWedge;$('extract-wedge').disabled=locked||simulation.running||game.stamina<simulation.extractionCost;
  $('extract-wedge').textContent=`Pull wedge · ${simulation.extractionCost} stamina [X]`;
  $('aim-label').textContent=Math.hypot(aim.x,aim.z)<.035?'CENTER AIM':`${Math.round(Math.hypot(aim.x,aim.z)*1000)} mm OFF CENTER`;
  $('angle-label').textContent=`GRAIN ${Math.round((yaw-grainAt(simulation.materialLog,aim.x,aim.z))*180/Math.PI)}°`;
  document.querySelectorAll('[data-upgrade]').forEach(button=>{const stat=button.dataset.upgrade,maxed=game.upgrades[stat]>=5;button.disabled=!!contract||simulation.running||maxed||game.coins<game.price(stat);button.querySelector('b').textContent=maxed?'MAX':`${game.price(stat)} ¢`;button.dataset.tooltip=`Rank ${game.upgrades[stat]} / 5`;button.setAttribute('aria-description',button.dataset.tooltip);});
  $('save-state').textContent=contract?'Contract scores are separate. Campaign progress is preserved.':storage&&game.storageAvailable!==false?'Progress saves locally.':'Storage unavailable · session progress only.';
  const button=$('swing-button');button.disabled=locked||simulation.running||game.stamina<game.cost;
  button.querySelector('span').textContent=locked?'Contract finished':simulation.running?'Swinging…':game.stamina<game.cost?'Catching your breath…':pointer?'Release pull to chop':armed?'Stop in the green zone':simulation.split?'Next log · start meter':'Start your swing';
}
function clearTelemetry(){$('energy').textContent='—';$('speed').textContent='0.0';$('fracture').textContent='Intact';$('penetration').textContent='0 mm';}
function prepareLog(){
  currentLog=contract?contract.log:game.log;
  if(contract){atmosphere.setWeather(currentLog.weather);$('weather').value=currentLog.weather;condition={moisture:currentLog.weather==='rain'?.65:.08,frost:currentLog.weather==='snow'?.65:0};}
  simulation.configure({log:currentLog,weather:physicalWeather(),...equippedToolStats()});simulation.reset();
  const target=simulation.goodAim();aim={x:target.x,z:target.z};yaw=target.yaw;clearTelemetry();updateGuide();
}
function resetScene(){
  audio.play('reset');
  // Replacing a log during a precision windup still spends that attempt.
  if(contract?.mode==='precision'&&simulation.running&&!simulation.impactHandled&&!contract.finished){const miss={source:'miss',split:false,accuracy:0,alignment:0,hazard:false,tool:'axe'};const hit=game.hit({...miss,...contract.grade(miss,currentLog),contract:true},currentLog);contract.hit(hit,game.score);}
  armed=false;pointer=null;clearPull();hitStopUntil=perfectUntil=shakeUntil=0;prepareLog();$('timing-label').textContent='Ready to find your rhythm';$('timing-value').textContent='100%';$('timing-needle').style.left='82%';$('hit-feedback').classList.remove('visible');$('scene-status').textContent='Aim on the log or grain reader. Pull down and release to chop.';updateHUD();return window.getSimulationState();}
function performSwing(power,automatic=false,pointerSwing=false){
  if(backyard?.mode==='yard')return backyard.swingTree();
  if(simulation.running||contract?.finished)return false;
  if(pointer){pointer=null;clearPull();}
  if(game.stamina<game.cost){audio.play('denied');$('scene-status').textContent='Let your stamina recover for a moment.';return false;}
  if(simulation.split)prepareLog();
  if(power===undefined)power=automatic?(currentLog.precisionTarget?.power??100):100;
  if(automatic){const target=simulation.goodAim();aim={x:target.x,z:target.z};yaw=target.yaw;updateGuide();}
  const timingQuality=automatic||pointerSwing?1:1-Math.min(1,Math.abs(meter-.81)/.81);
  const strikeAim=automatic?{...aim}:{x:aim.x+Math.sin(performance.now()*.003)*(1-timingQuality)*.015,z:aim.z};
  const strikeYaw=automatic?yaw:yaw+(1-timingQuality)*.08;
  const number=Number(power);power=Number.isFinite(number)?THREE.MathUtils.clamp(number,30,150):100;
  if(!game.begin())return false;beginContract();
  armed=false;unlockAudio();audio.activity();$('timing-label').textContent='Power locked';$('timing-value').textContent=`${Math.round(power)}%`;$('energy').textContent='—';$('hit-feedback').classList.remove('visible');
  aim={...strikeAim};yaw=strikeYaw;updateGuide();
  simulation.swing(power,{tool:'axe',log:currentLog,weather:physicalWeather(),...equippedToolStats(),aim:strikeAim,yaw:strikeYaw,timing:meter});
  backyard?.stumpSwing(simulation);
  $('scene-status').textContent='Weight up. Eyes on the grain.';updateHUD();return true;
}
function driveWedge(){
  if(contract?.finished||!simulation.wedgeReady||!game.begin(12)){audio.play('denied');return false;}beginContract();
  armed=false;unlockAudio();audio.activity();if(!simulation.seatedWedge)audio.play('wedgeSeat');simulation.swing(100,{tool:'wedge',aim:{...aim},log:currentLog,weather:physicalWeather(),...equippedToolStats()});
  $('hit-feedback').classList.remove('visible');$('scene-status').textContent='Wedge seated. Drive the existing fracture open.';updateHUD();return true;
}
function extractWedge(){
  if(contract?.finished||simulation.running||!simulation.seatedWedge||!game.begin(simulation.extractionCost)){audio.play('denied');return false;}
  audio.play('wedgeExtract');simulation.extractWedge();$('scene-status').textContent='Wedge pulled. Aim near another open crack to seat it there.';updateGuide();updateHUD();return true;
}
$('extract-wedge').addEventListener('click',extractWedge);
function meterAction(){
  if(backyard?.mode==='yard'){backyard.swingTree();return;}
  if(pointer||contract?.finished||simulation.running||game.stamina<game.cost)return;
  unlockAudio();if(!armed){if(simulation.split)prepareLog();armed=true;meterStart=performance.now();$('timing-label').textContent='Stop in the green zone';updateHUD();}
  else {const timing=1-Math.min(1,Math.abs(meter-.81)/.81);performSwing(45+timing*75);}
}
function unlockAudio(){return audio.unlock();}

// First gesture anywhere unlocks both the soundtrack and SFX. The listeners
// remain available to recover a browser-interrupted AudioContext later.
for(const event of ['pointerdown','keydown','click'])document.addEventListener(event,()=>audio.unlock(),{capture:true,passive:true});
function syncAudioControls(){
  $('music-volume').value=Math.round(audio.musicVolume*100);$('sfx-volume').value=Math.round(audio.sfxVolume*100);
  $('music-mute').checked=!audio.musicOn;$('sfx-mute').checked=!audio.sfxOn;
  $('music-volume-value').textContent=`${Math.round(audio.musicVolume*100)}%`;$('sfx-volume-value').textContent=`${Math.round(audio.sfxVolume*100)}%`;
}
for(const channel of ['music','sfx']){
  $(`${channel}-volume`).addEventListener('input',e=>{audio.configure({[`${channel}Volume`]:Number(e.target.value)/100});syncAudioControls();});
  $(`${channel}-mute`).addEventListener('change',e=>{audio.configure({[`${channel}On`]:!e.target.checked});syncAudioControls();});
}
syncAudioControls();
document.addEventListener('click',e=>{const target=e.target.closest?.('button,summary,a');if(target&&!target.disabled)audio.play('click');},true);
document.addEventListener('pointerover',e=>{const target=e.target.closest?.('button,summary,select,a');if(target&&!target.disabled&&!target.contains(e.relatedTarget))audio.play('hover');});
document.addEventListener('focusin',e=>{if(e.target.matches?.('button,summary,select'))audio.play('hover');});
document.addEventListener('pointerdown',e=>{
  const target=e.target.closest?.('button:disabled');if(!target)return;
  const price=target.matches('[data-upgrade]')?game.price(target.dataset.upgrade):target.id==='repair-edge'?12:Infinity;
  if(game.coins<price||target.matches('#swing-button,#wedge-button,#extract-wedge'))audio.play('denied');
},true);
document.addEventListener('input',e=>{if(e.target.matches?.('input[type=range]'))audio.play('click');});
document.addEventListener('change',e=>{if(e.target.matches?.('select,input[type=checkbox]'))audio.play('click');});
for(const details of document.querySelectorAll('details'))details.addEventListener('toggle',()=>audio.play(details.open?'menuOpen':'menuClose'));
window.addEventListener('keydown',e=>{if(e.code==='KeyM'&&!e.repeat&&!e.ctrlKey&&!e.metaKey&&!e.altKey&&!e.target?.matches?.('input,textarea,select')){audio.configure({musicOn:!audio.musicOn});syncAudioControls();}});
window.getAudioState=()=>audio.getAudioState();
window.audioDemo=seconds=>audio.audioDemo(seconds);

// Input: screen coordinates are projected onto the physical top of the log.
const ray=new THREE.Raycaster(),pointerNDC=new THREE.Vector2(),aimPlane=new THREE.Plane(new THREE.Vector3(0,1,0),-1.333),hitPoint=new THREE.Vector3();
const reader=$('grain-map'),readerContext=reader.getContext('2d');let readerSignature='';
let pointer=null;
function clearPull(){ $('pull-guide').hidden=true; }
function previewPull(e){
  const p=pointer;if(!p)return;p.lastX=e.clientX;p.lastY=e.clientY;
  const pull=pullGesture(e.clientX-p.x,e.clientY-p.y,(performance.now()-p.time)/1000);
  yaw=p.yaw+pull.yawDelta;updateGuide();
  const align=Math.round(Math.cos(yaw-grainAt(simulation.materialLog,aim.x,aim.z))**2*100),danger=inclusionAt(simulation.materialLog,aim.x,aim.z,yaw);
  $('pull-guide').hidden=pull.distance<=12;
  const line=$('pull-line');for(const [key,value]of Object.entries({x1:p.x,y1:p.y,x2:e.clientX,y2:e.clientY}))line.setAttribute(key,value);
  $('pull-guide').dataset.aligned=align>=85&&!danger?'true':'false';
  const label=$('pull-label');label.textContent=`${Math.round(pull.power)}% power · ${align}% grain${danger?` · ${danger.kind.toUpperCase()}!`:currentLog.precisionTarget?` · target ${currentLog.precisionTarget.power}%`:''}`;
  const labelBounds=label.getBoundingClientRect();
  label.style.left=`${Math.max(8,Math.min(innerWidth-labelBounds.width-8,e.clientX+15))}px`;label.style.top=`${Math.max(8,Math.min(innerHeight-labelBounds.height-8,e.clientY-labelBounds.height-8))}px`;
  $('timing-label').textContent='Release to chop';$('timing-value').textContent=`${Math.round(pull.power)}% pull`;
}
function drawGrainReader(){
  if(!readerContext||!$('grain-reader').open)return;
  const signature=[currentLog.name,currentLog.boss,currentLog.burl,currentLog.hollow,currentLog.forked,currentLog.rotten,currentLog.stony,currentLog.grain,JSON.stringify(currentLog.precisionTarget),simulation.dynamic.length,aim.x,aim.z,yaw,simulation.split,simulation.cracks.map(c=>c.damage).join(','),simulation.wedgeCrack?.x,simulation.wedgeCrack?.z,!!simulation.seatedWedge].join('|');
  if(signature===readerSignature)return;readerSignature=signature;
  const ctx=readerContext,r=currentLog.radius??LOG_RADIUS,scale=58/(r*(currentLog.forked?1.3:1));
  ctx.setTransform(2,0,0,2,0,0);ctx.clearRect(0,0,208,136);ctx.save();ctx.translate(104,68);
  ctx.fillStyle=simulation.split?'#c3c5ac':'#d5b27c';ctx.beginPath();ctx.arc(0,0,59,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#624a33';ctx.lineWidth=5;ctx.stroke();
  ctx.save();ctx.beginPath();ctx.arc(0,0,56,0,Math.PI*2);ctx.clip();
  if(currentLog.burl||currentLog.hollow||currentLog.forked||currentLog.rotten||currentLog.mineral){
    ctx.clearRect(-62,-62,124,124);ctx.fillStyle='#342b22';ctx.beginPath();ctx.arc(0,0,59,0,Math.PI*2);ctx.fill();
    for(const panel of simulation.shell.filter(p=>!p.released).sort((a,b)=>(a.top??LOG_TOP)-(b.top??LOG_TOP)))for(const polygon of (panel.polygons??[panel.polygon])){ctx.beginPath();polygon.forEach(([x,z],i)=>i?ctx.lineTo(x*scale,z*scale):ctx.moveTo(x*scale,z*scale));ctx.closePath();ctx.fillStyle=panel.core?'#5d4937':'#c9a46e';ctx.fill();ctx.lineWidth=.7;ctx.strokeStyle='#745635';ctx.stroke();}
    ctx.beginPath();for(const panel of simulation.shell.filter(p=>!p.released).sort((a,b)=>(a.top??LOG_TOP)-(b.top??LOG_TOP)))for(const polygon of (panel.polygons??[panel.polygon])){polygon.forEach(([x,z],i)=>i?ctx.lineTo(x*scale,z*scale):ctx.moveTo(x*scale,z*scale));ctx.closePath();}ctx.clip();
  }
  ctx.lineWidth=.65;ctx.strokeStyle='#8f683957';
  if(!currentLog.forked)for(let i=currentLog.hollow?7:1;i<14;i++){ctx.beginPath();ctx.ellipse(-2,1,i*4.5,i*4.2,.1,0,Math.PI*2);ctx.stroke();}
  if(currentLog.forked)for(const p of simulation.shell.filter(p=>!p.released)){
    ctx.strokeStyle='#87613980';ctx.lineWidth=.7;for(let i=1;i<7;i++){ctx.beginPath();ctx.ellipse(p.cx*scale,0,p.rx*scale*i/7,p.rz*scale*i/7,0,0,Math.PI*2);ctx.stroke();}
  }
  if(currentLog.rotten&&simulation.snapshot().coreRemaining){
    ctx.fillStyle='#241d18aa';for(let i=0;i<45;i++){const a=i*2.399,radius=Math.sqrt((i+.5)/45)*r*.43*scale;ctx.beginPath();ctx.ellipse(Math.cos(a)*radius,Math.sin(a)*radius,1.4,.8,a,0,Math.PI*2);ctx.fill();}
  }
  ctx.strokeStyle='#887545';ctx.lineWidth=.8;
  for(const offset of [-.018,.018]){ctx.beginPath();for(let i=0;i<=24;i++){const p=crackPoint({x:aim.x+offset,z:aim.z,yaw:grainAt(simulation.materialLog,aim.x,aim.z)},(i/24*2-1)*r,currentLog);i?ctx.lineTo(p.x*scale,p.z*scale):ctx.moveTo(p.x*scale,p.z*scale);}ctx.stroke();}
  if(currentLog.knot&&!currentLog.forked&&(!currentLog.burl||!simulation.shell[1]?.released)){const center=knotAt(currentLog);ctx.fillStyle='#64472d';ctx.beginPath();ctx.ellipse(center.x*scale,center.z*scale,.041*scale,.028*scale,0,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#ac804c';ctx.stroke();}
  for(const p of inclusions(simulation.materialLog)){ctx.beginPath();if(p.kind==='stone'){for(let i=0;i<6;i++){const a=i*Math.PI/3,x=(p.x+Math.cos(a)*p.radius)*scale,z=(p.z+Math.sin(a)*p.radius)*scale;i?ctx.lineTo(x,z):ctx.moveTo(x,z);}ctx.closePath();ctx.fillStyle='#868d89';ctx.fill();ctx.lineWidth=1.2;ctx.strokeStyle='#d1d6cd';ctx.stroke();}else{ctx.strokeStyle='#d9e4e0';ctx.lineWidth=4;ctx.arc(p.x*scale,p.z*scale,.025*scale,0,Math.PI);ctx.stroke();}}
  if(!simulation.split)for(const c of simulation.cracks.filter(c=>!(currentLog.burl||currentLog.hollow||currentLog.forked||currentLog.rotten||currentLog.mineral)||!simulation.shell[c.sector]?.released)){ctx.strokeStyle='#302015';ctx.lineWidth=1+c.damage*3;ctx.beginPath();for(let i=0;i<=24;i++){const p=crackPoint(c,(i/24*2-1)*r*(.25+.75*c.damage),currentLog);i?ctx.lineTo(p.x*scale,p.z*scale):ctx.moveTo(p.x*scale,p.z*scale);}ctx.stroke();}
  const selected=simulation.wedgeCrack;if(selected&&!simulation.split){ctx.strokeStyle='#ffc453';ctx.lineWidth=2;ctx.beginPath();ctx.arc(selected.x*scale,selected.z*scale,4,0,Math.PI*2);ctx.stroke();}
  ctx.restore();
  if(!simulation.split&&currentLog.precisionTarget){const p=currentLog.precisionTarget;ctx.strokeStyle='#36edbd';ctx.lineWidth=1.5;for(const radius of [.025,.055]){ctx.beginPath();ctx.arc(p.x*scale,p.z*scale,radius*scale,0,Math.PI*2);ctx.stroke();}}
  if(!simulation.split){ctx.translate(aim.x*scale,aim.z*scale);ctx.strokeStyle=inclusionAt(simulation.materialLog,aim.x,aim.z,yaw)?'#ff643c':'#fff8e8';ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(0,0,8,0,Math.PI*2);ctx.stroke();ctx.rotate(-yaw);ctx.strokeStyle='#a43822';ctx.lineWidth=2.5;ctx.beginPath();ctx.moveTo(0,-.035*scale);ctx.lineTo(0,.035*scale);ctx.stroke();}
  ctx.restore();
}
function aimAt(event){
  if(backyard?.mode==='yard')return false;
  if(simulation.running)return false;
  if(event.currentTarget===reader){const rect=reader.getBoundingClientRect(),r=currentLog.radius??LOG_RADIUS;const extent=r*(currentLog.forked?1.3:1),x=((event.clientX-rect.left)/rect.width*208-104)*extent/58,z=((event.clientY-rect.top)/rect.height*136-68)*extent/58;if(Math.hypot(x,z)>extent)return false;aim={x,z};}
  else {const rect=renderer.domElement.getBoundingClientRect();pointerNDC.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);ray.setFromCamera(pointerNDC,camera);let found=false;
    for(const top of currentLog.forked?[...new Set(simulation.shell.filter(p=>!p.released).map(p=>p.top))].sort((a,b)=>b-a):[LOG_TOP]){
      aimPlane.constant=-top;if(ray.ray.intersectPlane(aimPlane,hitPoint)&&Math.hypot(hitPoint.x,hitPoint.z)<.48){const target=simulation.surfaceAt(hitPoint.x,hitPoint.z);if(!currentLog.forked||target&&Math.abs(target.top-top)<.001){aim={x:hitPoint.x,z:hitPoint.z};found=true;break;}}
    }if(!found)return false;}
  updateGuide();return true;
}
for(const surface of [renderer.domElement,reader]){
  surface.addEventListener('pointermove',e=>{if(!pointer)aimAt(e);else if(pointer.id===e.pointerId)previewPull(e);});
  surface.addEventListener('pointerdown',e=>{if(backyard?.mode==='yard'||e.button!==0||simulation.running||contract?.finished)return;if(simulation.split)prepareLog();if(!aimAt(e))return;audio.play('aim');pointer={id:e.pointerId,x:e.clientX,y:e.clientY,time:performance.now(),lastX:e.clientX,lastY:e.clientY,yaw,wasArmed:armed};surface.setPointerCapture(e.pointerId);unlockAudio();if(!armed){armed=true;meterStart=performance.now();}updateHUD();});
  surface.addEventListener('pointerup',e=>{
    if(!pointer||pointer.id!==e.pointerId)return;
    const p=pointer,pull=pullGesture(e.clientX-p.x,e.clientY-p.y,(performance.now()-p.time)/1000);pointer=null;clearPull();
    if(pull.distance>12){yaw=p.yaw+pull.yawDelta;yaw=Math.atan2(Math.sin(yaw),Math.cos(yaw));performSwing(pull.power,false,true);updateGuide();}
    else {yaw=p.yaw;if(p.wasArmed||performance.now()-p.time>180)meterAction();else $('scene-status').textContent='Meter running. Click Swing or press Space to stop it.';}
  });
  const cancelPull=()=>{if(pointer){audio.play('cancel');yaw=pointer.yaw;pointer=null;armed=false;clearPull();updateGuide();updateHUD();}};
  surface.addEventListener('pointercancel',cancelPull);surface.addEventListener('lostpointercapture',cancelPull);
}
$('swing-button').addEventListener('click',meterAction);$('reset-button').addEventListener('click',resetScene);
$('wedge-button').addEventListener('click',driveWedge);
$('repair-edge').addEventListener('click',()=>{if(simulation.running)return;const repaired=game.repair();audio.play(repaired?'repair':'denied');if(repaired)audio.play('sharpen');$('shop-message').textContent=repaired?'Edge restored. Avoid visible steel.':'Repair costs 12 coins and restores a chipped edge.';updateHUD();});
function beginContract(){
  if(contract&&!contract.started)contractLastTick=performance.now();
  contract?.begin();
}
function selectMode(mode){
  if(simulation.running)return false;
  if(!['campaign','time','daily','precision'].includes(mode))return false;
  if(!contract&&mode!=='campaign')campaignConditions={condition:{...condition},weather:atmosphere.weather,hour:atmosphere.hour,cycle:atmosphere.cycle};
  contract=mode==='campaign'?null:new Contract(mode,mode==='daily'?dailySeed():mode==='precision'?'precision-v1':'sprint-v1',storage);
  game=contract?new Game(null):campaignGame;contractLastTick=performance.now();
  if(contract){atmosphere.hour=16.5;atmosphere.cycle=false;}
  else if(campaignConditions){condition={...campaignConditions.condition};atmosphere.setWeather(campaignConditions.weather);atmosphere.hour=campaignConditions.hour;atmosphere.cycle=campaignConditions.cycle;campaignConditions=null;}
  $('weather').value=atmosphere.weather;$('time').value=atmosphere.hour;$('day-cycle').checked=atmosphere.cycle;
  $('time').disabled=$('day-cycle').disabled=!!contract;
  $('game-mode').value=mode;$('weather').disabled=!!contract;$('slow-motion').disabled=!!contract;
  slowMotion=false;$('slow-motion').checked=false;resetScene();return true;
}
$('start-contract').addEventListener('click',()=>selectMode($('game-mode').value));
$('replay-contract').addEventListener('click',()=>{if(contract)selectMode(contract.mode);});
$('return-campaign').addEventListener('click',()=>selectMode('campaign'));
function centerAim(){if(simulation.running)return;audio.play('aim');const target=simulation.goodAim();aim={x:target.x,z:target.z};yaw=target.yaw;updateGuide();updateHUD();}
$('center-button').addEventListener('click',centerAim);
document.querySelectorAll('[data-upgrade]').forEach(button=>button.addEventListener('click',()=>{if(simulation.running||contract)return;const upgraded=game.upgrade(button.dataset.upgrade);audio.play(upgraded?'purchase':'denied');if(upgraded&&button.dataset.upgrade==='sharpness')audio.play('sharpen');$('shop-message').textContent=upgraded?'Ready for your next swing.':'A few more good chops will pay for it.';updateHUD();}));
$('weather').addEventListener('change',e=>{if(!contract)atmosphere.setWeather(e.target.value);});
$('time').addEventListener('input',e=>{if(contract)return;atmosphere.hour=Number(e.target.value);atmosphere.cycle=false;$('day-cycle').checked=false;});
$('day-cycle').addEventListener('change',e=>{if(!contract)atmosphere.cycle=e.target.checked;});
$('slow-motion').addEventListener('change',e=>{slowMotion=!contract&&e.target.checked;e.target.checked=slowMotion;});
$('impact-effects').addEventListener('change',e=>{impactEffects=e.target.checked;simulation.configure({recoil:impactEffects});if(!impactEffects)hitStopUntil=perfectUntil=shakeUntil=0;});
$('debug-physics').addEventListener('change',e=>{simulation.setDebug(e.target.checked);if(e.target.checked)selfCheck();});
$('camera-button').addEventListener('click',()=>{if(backyard?.mode==='yard'){backyard.pitch=.2;backyard.followCamera(1,true);}else resetCamera();});
let resetConfirmUntil=0;
$('reset-progress').addEventListener('click',()=>{if(performance.now()>resetConfirmUntil){resetConfirmUntil=performance.now()+4000;$('reset-progress').textContent='Click again to erase saved progress';return;}campaignGame.reset();backyard.goldenUnlocked=false;backyard.setAxe('sergey');if(contract)selectMode('campaign');else resetScene();$('reset-progress').textContent='Reset saved progress';});
const dialog=$('help-dialog');$('help-button').addEventListener('click',()=>{dialog.showModal();audio.play('menuOpen');audio.setGameState({menu:true});});dialog.addEventListener('close',()=>{audio.play('menuClose');audio.setGameState({menu:false});});dialog.querySelector('.dialog-close').addEventListener('click',()=>dialog.close());dialog.querySelector('.dialog-done').addEventListener('click',()=>dialog.close());
window.addEventListener('keydown',e=>{
  if(backyard?.mode==='yard'||e.code==='Escape')return;
  if(dialog.open||e.target?.matches?.('input,textarea,select,button,a,summary')||e.ctrlKey||e.metaKey||e.altKey||e.repeat)return;
  if(e.code==='Space'){e.preventDefault();meterAction();}
  else if(e.code==='KeyX')extractWedge();else if(e.code==='KeyR')resetScene();else if(e.code==='KeyW')driveWedge();else if(e.code==='KeyC')centerAim();else if(e.code==='KeyS'&&!contract){$('slow-motion').checked=!slowMotion;$('slow-motion').dispatchEvent(new Event('change'));}
  else if(!simulation.running){if(e.code==='KeyQ')yaw-=Math.PI/36;if(e.code==='KeyF')yaw+=Math.PI/36;
    yaw=Math.atan2(Math.sin(yaw),Math.cos(yaw));
    if(['KeyQ','KeyF'].includes(e.code))audio.play('aim');
    if(e.code.startsWith('Arrow')){audio.play('aim');e.preventDefault();const step=.015;if(e.code==='ArrowLeft')aim.x-=step;if(e.code==='ArrowRight')aim.x+=step;if(e.code==='ArrowUp')aim.z-=step;if(e.code==='ArrowDown')aim.z+=step;aim.x=THREE.MathUtils.clamp(aim.x,-.34,.34);aim.z=THREE.MathUtils.clamp(aim.z,-.34,.34);}updateGuide();updateHUD();}
});

async function setQuality(value){
  const epoch=++qualityEpoch;quality=value;lowPixelScale=.4;frameTime=0;frames=0;qualityClock=0;if(backyard){backyard.qualityMode=qualityMode;backyard.applyQuality(value);}const pixel=value==='low'?lowPixelScale:softwareRenderer?(value==='high'?.7:.6):value==='medium'?.85:Math.min(devicePixelRatio,1.25);
  renderer.setPixelRatio(pixel);renderer.setSize(innerWidth,innerHeight);renderer.shadowMap.enabled=value!=='low'&&!softwareRenderer;renderer.shadowMap.type=value==='low'?THREE.PCFShadowMap:THREE.PCFSoftShadowMap;
  const size=value==='low'?512:value==='medium'?1024:2048;sun.shadow.mapSize.set(size,size);if(sun.shadow.map){sun.shadow.map.dispose();sun.shadow.map=null;}
  simulation.chipLimit=value==='low'?14:value==='medium'?24:36;simulation.chipPoolLimit=value==='low'?32:value==='medium'?56:80;simulation.trimChips();if(simulation.debugGroup.visible)simulation.rebuildDebug();atmosphere.count=value==='low'?160:value==='medium'?350:650;
  if(composer){composer.dispose();for(const pass of composer.passes)pass.dispose?.();composer=null;}
  if(value==='high'&&!softwareRenderer){
    postLoading=true;
    try{const [{EffectComposer},{RenderPass},{SSAOPass},{UnrealBloomPass},{OutputPass}]=await Promise.all([import('three/addons/postprocessing/EffectComposer.js'),import('three/addons/postprocessing/RenderPass.js'),import('three/addons/postprocessing/SSAOPass.js'),import('three/addons/postprocessing/UnrealBloomPass.js'),import('three/addons/postprocessing/OutputPass.js')]);
      if(epoch!==qualityEpoch)return;composer=new EffectComposer(renderer);composer.addPass(new RenderPass(scene,camera));const ao=new SSAOPass(scene,camera,innerWidth,innerHeight);ao.kernelRadius=8;ao.minDistance=.003;ao.maxDistance=.12;composer.addPass(ao);composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth,innerHeight),.14,.5,1.15));composer.addPass(new OutputPass());composer.setSize(innerWidth,innerHeight);
    }catch(error){$('performance').textContent='Post effects unavailable; using balanced.';if(epoch===qualityEpoch)await setQuality('medium');}finally{postLoading=false;}
  }
}
$('quality').addEventListener('change',e=>{qualityMode=e.target.value;qualityClock=0;frameTime=0;frames=0;setQuality(qualityMode==='auto'?(softwareRenderer?'low':'medium'):qualityMode);});
function toggleSceneView(){const open=document.body.classList.toggle('scene-view');$('scene-view').setAttribute('aria-pressed',String(open));$('scene-view').innerHTML=`${open?'Show panels':'Scene view'} <kbd>V</kbd>`;renderer.domElement.focus({preventScroll:true});}
$('scene-view').addEventListener('click',toggleSceneView);
window.addEventListener('keydown',e=>{if(e.code==='KeyV'&&!e.repeat&&!e.ctrlKey&&!e.metaKey&&!e.altKey&&!e.target?.matches?.('input,textarea,select,button,a,summary')&&!document.querySelector('dialog[open]')){e.preventDefault();toggleSceneView();}});
window.addEventListener('resize',()=>{renderer.setSize(innerWidth,innerHeight);composer?.setSize(innerWidth,innerHeight);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();});
renderer.domElement.addEventListener('webglcontextlost',event=>{event.preventDefault();$('load-error').hidden=false;$('error-detail').textContent='The graphics context was interrupted. Reload to return to the backyard.';});
document.addEventListener('visibilitychange',()=>{previous=performance.now();frameTime=0;frames=0;});window.addEventListener('pagehide',()=>game.save());

function selfCheck(){
  const s=simulation.snapshot(),failures=[];const check=(ok,message)=>{console.assert(ok,message);if(!ok)failures.push(message);};
  check(!(s.burl||s.hollow||s.forked||s.rotten||s.mineral)||s.remainingPanels+s.pieces===s.expectedPieces,'Sections must remain supported or become physical fragments');
  if(s.burl||s.hollow||s.forked||s.rotten||s.mineral){const mass=simulation.shell.reduce((sum,p)=>sum+(p.released?p.body.mass:currentLog.mass*p.massFraction),0);check(Math.abs(mass-currentLog.mass)<1e-8,'Section releases must conserve the round mass');}
  check(simulation.inclusionMeshes.every((p,i)=>{const owner=s.burl?burlSectorAt({...currentLog,removedSections:[]},p.x,p.z):i;return p.mesh.parent&&(s.mineral||s.burl?simulation.shell[owner].released?p.mesh.parent===simulation.shell[owner].mesh:p.mesh.parent===scene:s.split?p.mesh.parent!==scene:p.mesh.parent===scene);}),'Inclusions must stay attached to their wood');
  check(s.chips<=s.chipBudget,'Chips must respect the active quality budget');
  check(Number.isFinite(s.energy)&&Number.isFinite(s.speed),'Physics measurements must be finite');
  check(s.peakSpeed<=15.2,'Measured axe edge speed must remain calibrated');
  check(!s.split||(!s.logVisible&&s.pieces===s.expectedPieces&&s.fragmentMeshes===s.expectedPieces),'Fracture must replace the intact log with matching physical fragments');
  for(const {body,mesh:m}of simulation.dynamic){check(m.position.distanceTo(new THREE.Vector3(body.position.x,body.position.y,body.position.z))<.0001,'Fragment mesh must follow its rigid body');}
  check($('swing-button').querySelector('span').textContent!=='Swinging…'||s.running,'Swing button must match simulation state');
  check(game.stamina>=0&&game.stamina<=game.maxStamina,'Stamina must stay within limits');
  return {ok:failures.length===0,failures};
}
window.swing=power=>performSwing(power,true);
window.driveWedge=driveWedge;
window.extractWedge=extractWedge;
window.resetScene=resetScene;
window.getGameState=()=>({...game.snapshot(currentLog),axe:backyard?.axe??'sergey',effectiveAxeMass:equippedToolStats().axeMass,effectiveSharpness:equippedToolStats().sharpness,mode:contract?.mode??'campaign',contract:contract?.snapshot()??null});
window.startChallenge=mode=>selectMode(mode);
window.getSimulationState=()=>({...simulation.snapshot(),inclusions:inclusions(simulation.materialLog).map(p=>({...p})),slowMotion,debugPhysics:simulation.debugGroup.visible,weather:atmosphere.weather,hour:atmosphere.hour,quality,fps,condition:{...condition},material:physicalWeather(),bodies:simulation.world.bodies.length,renderer:{calls:renderer.info.render.calls,triangles:renderer.info.render.triangles}});
// This helper is deliberately restricted to sessions with persistence disabled.
window.loadTestRound=index=>{if(!new URLSearchParams(location.search).has('test'))return false;simulation.running=false;selectMode('campaign');game.reset(false);game.clears=THREE.MathUtils.clamp(Math.floor(Number(index)||0),0,17);resetScene();return game.snapshot(currentLog);};
window.runSelfChecks=selfCheck;
// Deterministic stress runner for ?debug=1, advances the actual solver in large
// frame chunks. Isolated world and materials; never awards XP or changes saves.
window.runPhysicsChecks=()=>{
  const testScene=new THREE.Scene(),testWood={...wood,end:wood.end.clone()},test=new Simulation(testScene,testWood);const trials=[];
  for(const delta of [1/60,1/15,.25,.5]){test.configure({log:{...currentLog},weather:{...WEATHER.sun},aim:{x:0,z:0},yaw:currentLog.grain,sharpness:game.sharpness,axeMass:game.axeMass});test.reset();const target=test.goodAim();test.swing(100,{aim:{x:target.x,z:target.z},yaw:target.yaw});for(let t=0;t<4;t+=delta)test.update(delta);const s=test.snapshot();trials.push({delta,hit:s.energy>0,peakSpeed:s.peakSpeed,source:s.contactSource,visualsMatch:!s.split||!s.logVisible&&s.fragmentMeshes===s.expectedPieces});}
  test.reset();testScene.traverse(o=>{o.geometry?.dispose();if(o.material){for(const m of Array.isArray(o.material)?o.material:[o.material])if(!Object.values(wood).includes(m))m.dispose?.();}});return {ok:trials.every(t=>t.hit&&t.peakSpeed<=15.2&&t.visualsMatch),trials};
};
let previous=performance.now(),lastMeterBucket=-1,lastPerfectZone=false;
function animate(now){
  const elapsed=Math.max(0,(now-previous)/1000),dt=Math.min(elapsed,.5);previous=now;
  const wasRunning=simulation.running,impactScale=now<hitStopUntil?0:now<perfectUntil?.3:1;const wasFinished=contract?.finished;
  contract?.tick(Math.max(0,(now-contractLastTick)/1000),game.score);contractLastTick=now;
  if(contract?.finished&&!wasFinished){armed=false;pointer=null;clearPull();$('scene-status').textContent=`Time! ${game.score} points · ${contract.round} logs · best ${contract.best}. Replay or return to campaign.`;updateHUD();}
  simulation.update(dt*(slowMotion?.25:impactScale));game.regenerate(dt);
  condition=evolveCondition(condition,atmosphere.weather,Math.min(elapsed,5));
  simulation.configure({weather:simulation.running?simulation.settings.weather:physicalWeather()});
  if(wasRunning&&!simulation.running)updateHUD();if(actor.group.visible)actor.update(simulation.time,simulation.effort,...simulation.handPositions());
  atmosphere.update(Math.min(dt,.1),quality,simulation.time,backyard?.player.position);if(backyard?.mode!=='yard')controls.update();updateGuide();if(backyard?.mode==='yard')guide.visible=false;backyard?.update(dt,atmosphere,simulation);
  if(pointer)previewPull({clientX:pointer.lastX,clientY:pointer.lastY});
  if(armed&&!pointer){meter=(Math.sin((now-meterStart)/1000*4.4-Math.PI/2)+1)/2;$('timing-needle').style.left=`${meter*100}%`;if(!pointer)$('timing-value').textContent=`${Math.round(45+(1-Math.min(1,Math.abs(meter-.81)/.81))*75)}%`;}
  if(!armed||pointer){lastMeterBucket=-1;lastPerfectZone=false;}
  else {const bucket=Math.floor(meter*10),perfectZone=meter>=.75&&meter<=.87;if(bucket!==lastMeterBucket){audio.play('timingTick');lastMeterBucket=bucket;}if(perfectZone&&!lastPerfectZone)audio.play('perfectZone');lastPerfectZone=perfectZone;}
  if(now-lastReadout>120){updateHUD();audio.setEnvironment({weather:atmosphere.weather,hour:atmosphere.hour,wind:simulation.wind.strength});
    simulation.wood.bark.roughness=.9-condition.moisture*.48;simulation.wood.end.roughness=.85-condition.moisture*.35;
    simulation.wood.end.color.setHex(currentLog.color??0xffffff).multiplyScalar(1-condition.moisture*.15).lerp(frostColor,condition.frost*.45);
    simulation.wood.bark.color.setRGB(1-condition.moisture*.25,1-condition.moisture*.23,1-condition.moisture*.2).lerp(frostColor,condition.frost*.75);
    $('wood-condition').textContent=`Moisture ${Math.round(condition.moisture*100)}% · frost ${Math.round(condition.frost*100)}%`;
    const material=physicalWeather();$('weather-effect').textContent=`${WEATHER[atmosphere.weather].label.split(' · ')[0]} · resistance +${Math.round((material.resistance-1)*100)}% · friction ${material.friction.toFixed(2)}`;$('speed').textContent=(simulation.running?simulation.preSpeed:simulation.impactSpeed).toFixed(1);$('time').value=atmosphere.hour;$('time-label').textContent=`${String(Math.floor(atmosphere.hour)).padStart(2,'0')}:${String(Math.floor(atmosphere.hour%1*60)).padStart(2,'0')}`;
    if(now>feedbackUntil)$('hit-feedback').classList.remove('visible');if(resetConfirmUntil&&now>resetConfirmUntil){resetConfirmUntil=0;$('reset-progress').textContent='Reset saved progress';}
    if(simulation.debugGroup.visible)selfCheck();lastReadout=now;}
  if(!document.hidden){frameTime+=elapsed;frames++;qualityClock+=elapsed;}
  if(frameTime>=3){fps=frames/frameTime;$('performance').textContent=`${qualityMode==='auto'?'Auto · ':''}${quality} · ${Math.round(fps)} FPS${postLoading?' · loading effects':''}`;
    if(quality==='low'&&fps<22&&qualityClock>4&&lowPixelScale>.35){lowPixelScale=Math.max(.35,lowPixelScale-.05);renderer.setPixelRatio(lowPixelScale);renderer.setSize(innerWidth,innerHeight);qualityClock=0;}
    if(quality==='low'&&fps>48&&qualityClock>8&&lowPixelScale<.6){lowPixelScale=Math.min(.6,lowPixelScale+.05);renderer.setPixelRatio(lowPixelScale);renderer.setSize(innerWidth,innerHeight);qualityClock=0;}
    if(qualityMode==='auto'&&fps<27&&quality!=='low'&&qualityClock>4){setQuality(quality==='high'?'medium':'low');qualityClock=0;}frameTime=0;frames=0;}
  if(now-lastSave>15000){game.save();lastSave=now;}
  const shake=now<shakeUntil?shakeStrength*Math.min(1,(shakeUntil-now)/160):0;
  camera.position.x+=Math.sin(now*.11)*shake;camera.position.y+=Math.cos(now*.14)*shake*.6;
  if(composer)composer.render();else renderer.render(scene,camera);
  camera.position.x-=Math.sin(now*.11)*shake;camera.position.y-=Math.cos(now*.14)*shake*.6;requestAnimationFrame(animate);
}
// Select the efficient preset before the first render on software GPUs.
const gl=renderer.getContext(),debugRenderer=gl.getExtension('WEBGL_debug_renderer_info');
const gpu=debugRenderer?gl.getParameter(debugRenderer.UNMASKED_RENDERER_WEBGL):'';
const softwareRenderer=/swiftshader|llvmpipe|software|lavapipe/i.test(gpu);
backyard=new AssetBackyard({scene,camera,controls,renderer,storage,audio,
  onStatus:text=>{$('scene-status').textContent=text;},
  onShake:(strength,ms)=>{if(impactEffects){shakeStrength=strength;shakeUntil=performance.now()+ms;}},
  onMode:mode=>{armed=false;pointer=null;clearPull();document.body.dataset.playMode=mode;if(mode==='stump')resetCamera();$('scene-status').textContent=mode==='yard'?'Explore the yard. Face a trunk and click or press Space.':'Find the grain. Esc returns to the yard.';},
  onReward:tree=>{const level=campaignGame.level;campaignGame.xp+=35;campaignGame.coins+=20;campaignGame.save();if(campaignGame.level>level)audio.play('levelUp');audio.play('points');updateHUD();},
});
backyard.softwareRenderer=softwareRenderer;
$('yard-setting').addEventListener('change',e=>backyard.setSetting(e.target.value));
$('sergey-costume').addEventListener('change',e=>backyard.setCostume(e.target.value));
$('sergey-axe').addEventListener('change',e=>{if(e.target.value!=='golden'||backyard.goldenUnlocked)backyard.setAxe(e.target.value);});
$('explore-yard').addEventListener('click',()=>backyard.enterYard());
$('return-stump').addEventListener('click',()=>{if(backyard.player.position.length()<2.6)backyard.enterStump();else $('scene-status').textContent='Walk back to the block, then press E.';});
$('buy-golden-axe').addEventListener('click',()=>{if(contract||backyard.goldenUnlocked)return;if(campaignGame.coins<180){audio.play('denied');$('shop-message').textContent='Golden axe costs 180 coins. Trees earn 20; splitting logs earns more.';return;}campaignGame.coins-=180;campaignGame.save();backyard.goldenUnlocked=true;backyard.setAxe('golden');audio.play('purchase');$('shop-message').textContent='Golden axe unlocked · +12% cutting efficiency.';updateHUD();});
if(new URLSearchParams(location.search).has('assetdebug'))window.assetDebug={backyard,scene,renderer,simulation};
window.chopperTest={
  ready:()=>backyard.loaded,
  setSetting:value=>backyard.setSetting(value),setCostume:value=>backyard.setCostume(value),setAxe:value=>backyard.setAxe(value),
  setQuality:value=>{qualityMode=value;$('quality').value=value;return setQuality(value);},
  enterYard:()=>backyard.enterYard(),enterStump:()=>backyard.enterStump(),teleportNearTree:()=>backyard.teleportNearTree(),chopTree:()=>backyard.chopTree(),state:()=>backyard.state()
};
resetScene();qualityMode=backyard.qualityMode;$('quality').value=qualityMode;setQuality(qualityMode==='auto'?(softwareRenderer?'low':'medium'):qualityMode);$('reset-button').disabled=false;
backyard.init().then(()=>{simulation.axeMesh.visible=false;simulation.stumpVisual.visible=false;window.simulationReady=true;document.documentElement.dataset.simulation='ready';}).catch(error=>{actor.group.visible=true;$('asset-loading').hidden=true;$('load-error').hidden=false;$('error-detail').textContent=`An asset could not load: ${error.message}`;console.error(error);});
if(new URLSearchParams(location.search).has('debug')){simulation.setDebug(true);$('debug-physics').checked=true;console.assert(window.runPhysicsChecks().ok,'Continuous collision stress check failed');}
requestAnimationFrame(animate);

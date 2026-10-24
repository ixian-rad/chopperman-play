import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { loadTreeLibrary } from './assets/trees_v2/runtime/trees.js';
import { YardTreeField } from './yard-trees.js';
import { WIND, updateWind } from './assets/trees_v2/runtime/wind.js';
import { randomSource } from './environment.js';

const AXES={sergey:'axe_sergey',double_bit:'axe_double_bit',maul:'splitting_maul',golden:'axe_golden'};
export const CHARACTERS={sergey:{name:'Sergey',costumes:{tee:'Black tee',jacket:'Blue jacket'}},alex:{name:'Alex',costumes:{camo:'Camo tee',bomber:'Navy bomber'}}};
const LOW_PROPS=new Set(['shed_nj','chopping_stump_nj','firewood_heap_nj','tarp_woodpile','siding_wall','chopping_block','split_log_halves','house_wall_grapevine','mangal','bench','lada_car','well','khrushchevka','cathedral','iron_tools_horseshoe']);
const LOW_DRESSING=new Set(['arborvitae','grill_gas','wheelbarrow','tomato_garden']);
const SPECIES={nj:['pine','oak','maple','birch'],tiraspol:['walnut','apricot','poplar','birch']};
const UP=new THREE.Vector3(0,1,0);
const clamp=THREE.MathUtils.clamp;
const setText=(id,text)=>{const element=document.getElementById(id);if(element.textContent!==text)element.textContent=text;};
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));

function shadowTexture(){
  const canvas=document.createElement('canvas');canvas.width=canvas.height=64;
  const ctx=canvas.getContext('2d'),gradient=ctx.createRadialGradient(32,32,2,32,32,32);
  gradient.addColorStop(0,'rgba(24,30,18,.48)');gradient.addColorStop(.4,'rgba(24,30,18,.25)');gradient.addColorStop(1,'rgba(24,30,18,0)');
  ctx.fillStyle=gradient;ctx.fillRect(0,0,64,64);return new THREE.CanvasTexture(canvas);
}

// Strip horizontal root motion: yard movement and collision own the world position.
function inPlace(clip,name=clip.name){
  const c=clip.clone();c.name=name;
  for(const track of c.tracks){
    if(track.name==='Hips.position')for(let i=0;i<track.values.length;i+=3){track.values[i]=0;track.values[i+2]=0;}
    if(track.name==='Hips.quaternion'){const q=new THREE.Quaternion(),e=new THREE.Euler(0,0,0,'YXZ');for(let i=0;i<track.values.length;i+=4){q.fromArray(track.values,i);e.setFromQuaternion(q,'YXZ');e.y=0;q.setFromEuler(e).toArray(track.values,i);}}
  }
  return c;
}

function plantedStance(clip){
  const c=inPlace(clip);
  // The supplied idle includes planted-foot pivots. Removing root yaw without
  // these pivots made the shoes drift. Keep its breathing/head motion above hips.
  for(const track of c.tracks)if(/^(Hips|Left(UpLeg|Leg|Foot|ToeBase)|Right(UpLeg|Leg|Foot|ToeBase))\./.test(track.name)){
    const size=track.getValueSize();for(let i=size;i<track.values.length;i++)track.values[i]=track.values[i%size];
  }
  return c;
}

export class AssetBackyard {
  constructor({scene,camera,controls,renderer,storage,audio,onReward,onMode,onStatus,onShake}){
    Object.assign(this,{scene,camera,controls,renderer,storage,audio,onReward,onMode,onStatus,onShake});
    this.player=new THREE.Group();this.player.name='Sergey';scene.add(this.player);
    this.player.position.set(0,0,-.72);this.mode='stump';this.characterId='sergey';this.playerName='Sergey';this.worldSeed=0;this.remoteActors=new Set();this.costume='tee';this.axe='sergey';this.setting='nj';this.quality='low';this.qualityMode='auto';this.anim='Idle';
    this.materialCache=new WeakMap();this.loaded=false;this.keys=new Set();this.heading=0;this.pitch=.2;this.stepDistance=0;this.swinging=null;this.cheerUntil=0;this.colliders=[];this.yards=new Map();this.models=new Map();this.characterCache=new Map();this.axeCache=new Map();this.chips=[];this.settingsEpoch=0;
    this.actionWeights=new Map();this.moveSpeed=0;this.gazeYaw=0;this.gazePitch=0;
    this.cameraLook=new THREE.Vector3();this.cameraDesired=new THREE.Vector3();this.frameForward=new THREE.Vector3();this.moveStart=new THREE.Vector3();this.moveDelta=new THREE.Vector3();this.travel=new THREE.Vector3();
    try{const s=JSON.parse(storage?.getItem('backyard-assets-v2')||'{}');for(const key of ['setting','characterId','playerName','costume','axe','quality','qualityMode','goldenUnlocked'])if(s[key]!==undefined)this[key]=s[key];}catch{/* Optional preferences. */}
    if(!['auto','low','medium','high'].includes(this.qualityMode))this.qualityMode='auto';
    if(!CHARACTERS[this.characterId])this.characterId='sergey';this.playerName=String(this.playerName||CHARACTERS[this.characterId].name).slice(0,16);
    if(!SPECIES[this.setting])this.setting='nj';if(!CHARACTERS[this.characterId].costumes[this.costume])this.costume=Object.keys(CHARACTERS[this.characterId].costumes)[0];if(!AXES[this.axe])this.axe='sergey';if(this.axe==='golden'&&!this.goldenUnlocked)this.axe='sergey';
    this.manager=new THREE.LoadingManager();this.manager.onProgress=(_url,done,total)=>{const bar=document.getElementById('asset-progress');bar.value=done;bar.max=total;document.getElementById('asset-progress-label').textContent=`Unpacking the backyard · ${done} / ${total}`;};
    this.loader=new GLTFLoader(this.manager).setMeshoptDecoder(MeshoptDecoder);this.textureLoader=new THREE.TextureLoader(this.manager);
    this.targetRing=new THREE.Mesh(new THREE.RingGeometry(.45,.49,48),new THREE.MeshBasicMaterial({color:0xffd787,side:THREE.DoubleSide,depthWrite:false}));this.targetRing.rotation.x=-Math.PI/2;this.targetRing.visible=false;scene.add(this.targetRing);
    this.contactMaterial=new THREE.MeshBasicMaterial({map:shadowTexture(),transparent:true,depthWrite:false,toneMapped:false});
    this.playerShadow=new THREE.Mesh(new THREE.PlaneGeometry(1.1,.8),this.contactMaterial);this.playerShadow.rotation.x=-Math.PI/2;scene.add(this.playerShadow);
    this.bindInputs();
  }
  save(){try{this.storage?.setItem('backyard-assets-v2',JSON.stringify({setting:this.setting,characterId:this.characterId,playerName:this.playerName,costume:this.costume,axe:this.axe,quality:this.quality,qualityMode:this.qualityMode,goldenUnlocked:!!this.goldenUnlocked}));}catch{/* Session preferences still work. */}}
  model(group,name){const url=`assets/models/${group}/${name}.glb`;if(!this.models.has(url))this.models.set(url,this.loader.loadAsync(url));return this.models.get(url);}
  texture(url){return this.textureLoader.loadAsync(url).then(t=>{t.colorSpace=THREE.SRGBColorSpace;return t;});}
  async init(){
    const costumes=[this.loadCharacter(this.characterId,this.costume)];
    const axes=Object.entries(AXES).map(async([key,file])=>{const gltf=await this.model('common',file);this.axeCache.set(key,gltf.scene);});
    const trees=loadTreeLibrary(this.loader,Object.fromEntries([...new Set(Object.values(SPECIES).flat())].map(s=>[s,`assets/trees_v2/models/tree_${s}.glb`]))).then(lib=>{
      // Alpha-to-coverage without MSAA keeps pale fringe texels instead of
      // discarding them. This renderer uses hard alpha tests at every preset.
      for(const species of Object.values(lib))for(const variant of species.variants)for(const material of Object.values(variant.materials)){material.alphaToCoverage=false;material.needsUpdate=true;}
      this.library=lib;
    });
    const textures=Promise.all([this.texture('assets/art/common/fx_woodchips_sheet_4x4.webp'),this.texture('assets/art/nj/tex_mulch_chips_decal.webp')]).then(([chips,mulch])=>{this.chipAtlas=chips;this.mulchTexture=mulch;});
    await Promise.all([...costumes,...axes,trees,textures,this.loadYard('nj'),this.loadYard('tiraspol')]);
    for(const key of ['nj','tiraspol']){const yard=await this.loadYard(key);const mulch=new THREE.Mesh(new THREE.PlaneGeometry(4.6,4.6),new THREE.MeshStandardMaterial({map:this.mulchTexture,transparent:true,depthWrite:false,roughness:1}));mulch.rotation.x=-Math.PI/2;mulch.position.set(0,.012,0);mulch.receiveShadow=true;yard.group.add(mulch);}
    await this.setCostume(this.requestedCostume??this.costume);await this.setSetting(this.setting);this.loaded=true;
    document.getElementById('asset-loading').hidden=true;
    this.onStatus(`${CHARACTERS[this.characterId].name} is ready. Find the grain, or step into the yard.`);
    this.syncUI();return this;
  }
  async loadCharacter(character,costume){
    this.characterLoads??=new Map();const key=`${character}:${costume}`;
    if(!this.characterLoads.has(key))this.characterLoads.set(key,(async()=>{
      const prefix=`char_${character}${['jacket','bomber'].includes(costume)?'_jacket':''}`;
      const [gltf,low,walk,run]=await Promise.all([this.model('common',`${prefix}_animated_pbr`),character==='sergey'?this.model('derived/sergey-low',`${prefix}_animated_pbr`):this.model('common',`${prefix}_animated_pbr`),this.model('common',`${prefix}_walking_armature`),this.model('common',`${prefix}_running_armature`)]);
      // These atlases have tiny, tightly packed UV islands. Ordinary mipmaps
      // mix skin into the black clothing at game distance (golden speckles).
      for(const source of [gltf,low])source.scene.traverse(o=>{if(!o.isMesh)return;for(const material of Array.isArray(o.material)?o.material:[o.material])for(const key of ['map','normalMap','roughnessMap','metalnessMap']){const texture=material[key];if(texture){texture.minFilter=THREE.LinearFilter;texture.generateMipmaps=false;texture.anisotropy=this.softwareRenderer?1:Math.min(4,this.renderer.capabilities.getMaxAnisotropy());texture.needsUpdate=true;}}});
      const entry={gltf,low,clips:[...gltf.animations.map(c=>c.name==='Idle'?plantedStance(c):c.name==='Axe_Stance'?plantedStance(THREE.AnimationUtils.subclip(c,c.name,138,182,30)):inPlace(c.name==='Charged_Axe_Chop'?THREE.AnimationUtils.subclip(c,c.name,91,147,30):c)),inPlace(walk.animations[0],'Walk'),inPlace(run.animations[0],'Run')]};this.characterCache.set(costume,entry);return entry;
    })());
    return this.characterLoads.get(key);
  }
  async setCharacter(value){
    if(!CHARACTERS[value])throw Error('Unknown character');
    const oldName=CHARACTERS[this.characterId].name;
    const previous=this.characterId,previousName=this.playerName;this.characterId=value;
    if(this.playerName===oldName)this.playerName=CHARACTERS[value].name;
    try{return await this.setCostume(Object.keys(CHARACTERS[value].costumes)[0]);}
    catch(error){this.characterId=previous;this.playerName=previousName;this.requestedCostume=this.costume;throw error;}
  }
  async setCostume(value){
    if(!CHARACTERS[this.characterId].costumes[value])throw Error('Unknown costume');
    this.requestedCostume=value;const epoch=this.characterEpoch=(this.characterEpoch??0)+1,character=this.characterId;
    const entry=await this.loadCharacter(character,value);if(epoch!==this.characterEpoch)return;
    this.cancelSwing();this.stumpAction=null;this.mixer?.stopAllAction();if(this.character)this.mixer?.uncacheRoot(this.character);this.character?.traverse(o=>{if(o.isSkinnedMesh)o.skeleton.dispose();});this.character?.removeFromParent();
    this.costume=value;this.characterLow=this.quality==='low'||this.softwareRenderer;this.character=cloneSkeleton((this.characterLow?entry.low:entry.gltf).scene);this.player.add(this.character);
    this.character.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;o.frustumCulled=false;}});
    this.bones=Object.fromEntries(['RightArm','RightForeArm','RightHand','LeftArm','LeftForeArm','LeftHand','Head','Spine','Spine01','Spine02'].map(name=>[name,this.character.getObjectByName(name)]));
    this.mixer=new THREE.AnimationMixer(this.character);this.actions=new Map(entry.clips.map(c=>[c.name,this.mixer.clipAction(c)]));
    const idle=this.actions.get('Idle');idle.reset().setEffectiveWeight(1).play();this.mixer.update(0);this.relaxedLeft=['LeftArm','LeftForeArm','LeftHand'].map(name=>this.bones[name].quaternion.clone());idle.stop();
    this.currentAction=null;this.actionWeights.clear();this.blend=null;this.hand=this.bones.RightHand;this.setAxe(this.axe);this.play(this.mode==='stump'?'Axe_Stance':'Idle',0);this.mixer.update(0);
    this.animationPose=Object.values(this.bones).map(bone=>({bone,rotation:bone.quaternion.clone()}));
    this.player.updateMatrixWorld(true);this.poseCarry();this.save();this.syncUI();
  }
  play(name,fade=.18,once=false){
    const next=this.actions?.get(name);if(!next||this.currentAction===next&&!once)return;
    const previous=this.currentAction,phase=previous?previous.time/previous.getClip().duration%1:0;
    next.reset().setEffectiveTimeScale(1).setLoop(once?THREE.LoopOnce:THREE.LoopRepeat,once?1:Infinity);next.clampWhenFinished=once;next.play();
    if(previous&&['Walk','Run','Casual_Walk'].includes(name)&&['Walk','Run','Casual_Walk'].includes(this.anim))next.time=phase*next.getClip().duration;
    if(previous&&fade>0){this.blend={time:0,duration:fade,from:new Map(this.actionWeights),next};if(!this.actionWeights.has(next))this.actionWeights.set(next,0);}
    else {for(const action of this.actionWeights.keys())if(action!==next)action.stop();this.actionWeights.clear();this.actionWeights.set(next,1);this.blend=null;}
    for(const [action,weight]of this.actionWeights)action.setEffectiveWeight(weight);
    this.currentAction=next;this.anim=name;
  }
  blendActions(dt){
    if(!this.blend)return;
    const b=this.blend;b.time+=dt;const u=THREE.MathUtils.smoothstep(b.time,0,b.duration);
    for(const [action]of this.actionWeights){const weight=THREE.MathUtils.lerp(b.from.get(action)??0,action===b.next?1:0,u);action.setEffectiveWeight(weight);this.actionWeights.set(action,weight);if(u===1&&action!==b.next){action.stop();this.actionWeights.delete(action);}}
    if(u===1)this.blend=null;
  }
  setAxe(value){
    if(!AXES[value])throw Error('Unknown axe');this.axe=value;this.heldAxe?.removeFromParent();if(!this.hand||!this.axeCache.has(value))return;
    const source=this.axeCache.get(value).clone(true),holder=new THREE.Group(),aligned=new THREE.Group();aligned.add(source);
    // Meshy axes use different primary axes. Standardize handle to local +Y.
    let b=new THREE.Box3().setFromObject(source),s=b.getSize(new THREE.Vector3());
    if(s.x>s.y)source.rotation.z=value==='maul'?2.15:Math.PI/2;
    b=new THREE.Box3().setFromObject(source);s=b.getSize(new THREE.Vector3());const center=b.getCenter(new THREE.Vector3());
    const length=value==='sergey'?.78:.90;aligned.scale.setScalar(length/s.y);
    source.position.sub(center);source.position.y+=s.y*.38;
    holder.add(aligned);holder.name=`Held_${value}`;
    aligned.updateMatrixWorld(true);const points=[];
    aligned.traverse(o=>{if(!o.isMesh)return;const a=o.geometry.getAttribute('position');for(let i=0;i<a.count;i++)points.push(new THREE.Vector3(a.getX(i),a.getY(i),a.getZ(i)).applyMatrix4(o.matrixWorld));});
    const handle=points.filter(p=>Math.abs(p.y)<length*.045);
    const grip=new THREE.Box3().setFromPoints(handle.length?handle:points).getCenter(new THREE.Vector3());grip.y=0;aligned.position.sub(grip);points.forEach(p=>p.sub(grip));
    const head=points.filter(p=>p.y>length*.45),edge=head.reduce((best,p)=>p.x<best.x?p:best,head[0]??new THREE.Vector3(0,length*.7,0));
    const edgePoints=head.filter(p=>p.x<edge.x+.008);this.bladeAnchor=edgePoints.length?edgePoints.reduce((sum,p)=>sum.add(p),new THREE.Vector3()).multiplyScalar(1/edgePoints.length):edge.clone();
    // Bones are authored in centimetres under a 0.01 armature scale.
    holder.scale.setScalar(100);holder.position.set(0,6,1);holder.rotation.set(0,Math.PI/2,0);
    source.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});this.hand.add(holder);this.heldAxe=holder;
    if(this.lastToolPose&&this.mixer){this.player.updateMatrixWorld(true);this.poseTool(this.lastToolPose.grip,this.lastToolPose.rotation,this.lastToolPose.twoHands,this.lastToolPose.gripSpacing,this.lastToolPose.leftWeight);}
    this.materialsDirty=true;this.save();this.syncUI();
  }
  async loadYard(setting){
    if(this.yards.has(setting))return this.yards.get(setting);
    const promise=this.buildYard(setting);this.yards.set(setting,promise);return promise;
  }
  async buildYard(setting){
    const group=new THREE.Group();group.name=`${setting} backyard`;const colliders=[],details=[],propLODs=[],shadows=[],fenceObjects=[];let choppingObject;
    const add=async(folder,name,height,x,z,rot=0,collidable=true,detail=false)=>{
      const [{scene:source},low]=await Promise.all([this.model(folder,name),LOW_PROPS.has(name)?this.model('derived/low',name):LOW_DRESSING.has(name)?this.model('derived/dressing-low',name):Promise.resolve(null)]);const object=source.clone(true);object.rotation.y=rot;object.userData.keepOnLow=LOW_DRESSING.has(name);
      const bounds=new THREE.Box3().setFromObject(object),size=bounds.getSize(new THREE.Vector3());object.scale.setScalar(name==='chips_scatter'?1:height/size.y);
      if(name==='chopping_stump_nj'||name==='chopping_block'){const width=Math.max(size.x,size.z)*height/size.y;object.scale.x*=.9/width;object.scale.z*=.9/width;}
      bounds.setFromObject(object);const center=bounds.getCenter(new THREE.Vector3());object.position.set(x-center.x,-bounds.min.y,z-center.z);group.add(object);object.updateMatrixWorld(true);
      object.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});
      if(name.startsWith('fence_')){const width=new THREE.Box3().setFromObject(object).getSize(new THREE.Vector3());object.scale.x*=4.1/(Math.abs(Math.sin(rot))>.5?width.z:width.x);const b=new THREE.Box3().setFromObject(object),c=b.getCenter(new THREE.Vector3());object.position.x+=x-c.x;object.position.z+=z-c.z;object.updateMatrixWorld(true);fenceObjects.push(object);}
      if(collidable){const b=new THREE.Box3().setFromObject(object);colliders.push({object,minX:b.min.x,maxX:b.max.x,minZ:b.min.z,maxZ:b.max.z,minY:b.min.y,maxY:b.max.y});}
      if(!name.startsWith('fence_')&&height<5&&name!=='siding_wall'&&name!=='chips_scatter'){
        const b=new THREE.Box3().setFromObject(object),s=b.getSize(new THREE.Vector3());shadows.push({object,x,z,w:s.x*1.15+.3,d:s.z*1.15+.3});
      }
      if(low){const full=object.children.slice(),reduced=low.scene.clone(true);object.add(reduced);reduced.traverse(o=>{if(o.isMesh)o.receiveShadow=true;});propLODs.push({full,reduced});}
      if(name==='chopping_stump_nj'||name==='chopping_block')choppingObject=object;
      if(detail&&!name.startsWith('fence_'))details.push(object);return object;
    };
    // Quiet, softly varied turf keeps the original warm editorial palette.
    const canvas=document.createElement('canvas');canvas.width=canvas.height=256;const ctx=canvas.getContext('2d'),noise=randomSource(this.worldSeed^(setting==='nj'?17:32));ctx.fillStyle=setting==='nj'?'#7b8a55':'#8a8c64';ctx.fillRect(0,0,256,256);for(let i=0;i<9000;i++){ctx.fillStyle=i%3===0?'#b4af7240':'#3b562b30';ctx.fillRect(noise()*256,noise()*256,1+noise()*3,1+noise()*5);}const turf=new THREE.CanvasTexture(canvas);turf.colorSpace=THREE.SRGBColorSpace;turf.wrapS=turf.wrapT=THREE.RepeatWrapping;turf.repeat.set(100,100);
    const ground=new THREE.Mesh(new THREE.PlaneGeometry(320,320),new THREE.MeshStandardMaterial({map:turf,color:0xffffff,roughness:1}));ground.rotation.x=-Math.PI/2;ground.receiveShadow=true;group.add(ground);
    const rnd=randomSource(this.worldSeed^(setting==='nj'?816:937));const dummy=new THREE.Object3D();
    const flecks=new THREE.InstancedMesh(new THREE.CircleGeometry(.17,5),new THREE.MeshBasicMaterial({color:setting==='nj'?0x71814d:0x7e8252}),550);
    for(let i=0;i<550;i++){dummy.position.set((rnd()-.5)*48,.006,(rnd()-.5)*48);dummy.rotation.set(-Math.PI/2,0,rnd()*6.28);dummy.scale.setScalar(.4+rnd()*2);dummy.updateMatrix();flecks.setMatrixAt(i,dummy.matrix);}group.add(flecks);details.push(flecks);
    const jobs=[];
    if(setting==='nj'){
      jobs.push(add('nj','shed_nj',2.4,-4,-3.8,.08),add('nj','chopping_stump_nj',.74,0,0,0,false),add('nj','firewood_heap_nj',.7,2.2,-1.9,0,true),add('nj','tarp_woodpile',1.1,-6.6,-3.9,0,true),add('nj','patio_set',2.4,7,-7,0,true,true),add('nj','grill_gas',1.1,5,-5.5,0,true,true),add('nj','swing_set',2.2,-8,-5,0,true,true),add('nj','recycling_bin',1.1,-6.1,-4.1,0,true,true),add('nj','siding_wall',2.7,10,-5,Math.PI/2));
      for(let i=0;i<5;i++)jobs.push(add('nj','arborvitae',2.7+rnd()*.4,-7+i*1.4,-10.4,0,false,true).then(o=>{o.userData.keepOnLow=i%2===0;return o;}));
    }else{
      jobs.push(add('common','chopping_block',.74,0,0,0,false),add('tiraspol','house_wall_grapevine',3.3,-5.2,-6,.1),add('tiraspol','mangal',1.05,1.9,-5.2,0,true),add('tiraspol','bench',.85,-2.9,-4.1,0,true),add('tiraspol','lada_car',1.45,4.3,-8.8,-.45,true),add('tiraspol','well',2.2,-7,3,0,true),add('tiraspol','tomato_garden',1.6,7,-3,0,true,true),add('tiraspol','khrushchevka',15,-58,-78,.12,true),add('tiraspol','cathedral',18,-28,-95,-.18,true),add('tiraspol','iron_tools_horseshoe',.9,.2,-7.87,0,false).then(o=>{o.position.y=.55;return o;}));
      // A low partition beside the mangal gives the tools a fence to hang on.
      jobs.push(add('tiraspol','fence_planks',1.65,.2,-8,0,true,true));
    }
    jobs.push(add('common','wheelbarrow',.7,3,2.1,.4,true,true),add('common','split_log_halves',.28,1.1,.6,.5,false),add('common','chips_scatter',.035,.05,.2,0,false),add('common','firewood_pile',.7,3,-2.7,0,true,true));
    // Fences enclose a generous walkable yard. Rear corner gaps frame distant trees.
    const fenceFolder=setting==='nj'?'nj':'tiraspol',fence=setting==='nj'?'fence_splitrail':'fence_planks';
    for(const x of [-10,-6,-2,2,6,10])jobs.push(add(fenceFolder,fence,setting==='nj'?1.2:1.5,x,-12,0,false,true));
    for(const z of [-8,-4,0,4,8,12])for(const x of [-12,12])jobs.push(add(fenceFolder,fence,setting==='nj'?1.2:1.5,x,z,Math.PI/2,false,true));
    for(const x of [-10,-6,-2,2,6,10])jobs.push(add(fenceFolder,fence,setting==='nj'?1.2:1.5,x,14,0,false,true));
    const lowFence=new THREE.Group();group.add(lowFence);
    const woodCanvas=document.createElement('canvas');woodCanvas.width=64;woodCanvas.height=256;const wc=woodCanvas.getContext('2d');wc.fillStyle=setting==='nj'?'#9d8058':'#a39b88';wc.fillRect(0,0,64,256);
    for(let i=0;i<650;i++){wc.strokeStyle=i%3===0?'#392c2332':'#fff5d322';wc.lineWidth=.3+rnd();const x=rnd()*64,y=rnd()*256;wc.beginPath();wc.moveTo(x,y);wc.bezierCurveTo(x-1,y+12,x+1,y+28,x,y+45+rnd()*70);wc.stroke();}
    const fenceTexture=new THREE.CanvasTexture(woodCanvas);fenceTexture.colorSpace=THREE.SRGBColorSpace;
    const railMat=new THREE.MeshLambertMaterial({map:fenceTexture,color:0xffffff}),fenceMatrices=[];
    const addFenceBox=(w,h,d,x,y,z,cx,cz,rot)=>{const o=new THREE.Object3D();o.position.set(cx+Math.cos(rot)*x+Math.sin(rot)*z,y,cz-Math.sin(rot)*x+Math.cos(rot)*z);o.rotation.y=rot;o.scale.set(w,h,d);o.updateMatrix();fenceMatrices.push(o.matrix.clone());};
    for(const [cx,cz,rot,length]of [[0,-12,0,24],[0,14,0,24],[-12,1,Math.PI/2,26],[12,1,Math.PI/2,26]]){
      if(setting==='nj'){for(let x=-length/2;x<=length/2;x+=2)addFenceBox(.13,1.3,.13,x,.65,0,cx,cz,rot);for(const y of [.4,.9])addFenceBox(length,.11,.09,0,y,0,cx,cz,rot);}
      else {for(let x=-length/2;x<length/2;x+=.18){const h=1.45+rnd()*.1;addFenceBox(.168,h,.07,x,h/2,0,cx,cz,rot);}for(const y of [.35,1.12])addFenceBox(length,.09,.10,0,y,.055,cx,cz,rot);}
    }
    if(setting==='tiraspol')for(let x=-2;x<2;x+=.18)addFenceBox(.168,1.65,.07,x,.825,0,.2,-8,0);
    const fenceInstance=new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1),railMat,fenceMatrices.length);fenceMatrices.forEach((m,i)=>{fenceInstance.setMatrixAt(i,m);fenceInstance.setColorAt(i,new THREE.Color().setScalar(.79+rnd()*.25));});lowFence.add(fenceInstance);
    const backs=Promise.all(['wide','dusk','night'].map(time=>this.texture(`assets/art/${setting}/${setting}_background_${time}.webp`)));
    await Promise.all(jobs);const maps=await backs;
    // Repeated textured fence sections share one instanced draw per source mesh.
    const fullFence=new THREE.Group(),fenceBatches=new Map();group.add(fullFence);
    for(const object of fenceObjects){object.updateMatrixWorld(true);object.traverse(mesh=>{if(!mesh.isMesh)return;const key=mesh.geometry.uuid+mesh.material.uuid;if(!fenceBatches.has(key))fenceBatches.set(key,{source:mesh,matrices:[]});fenceBatches.get(key).matrices.push(mesh.matrixWorld.clone());});object.removeFromParent();}
    for(const {source,matrices}of fenceBatches.values()){const mesh=new THREE.InstancedMesh(source.geometry,source.material,matrices.length);matrices.forEach((m,i)=>mesh.setMatrixAt(i,m));mesh.castShadow=true;mesh.receiveShadow=true;mesh.computeBoundingSphere();fullFence.add(mesh);}
    const contactShadows=new THREE.InstancedMesh(new THREE.PlaneGeometry(1,1),this.contactMaterial,shadows.length);
    const shadowMatrices=shadows.map(s=>{dummy.position.set(s.x,.018,s.z);dummy.rotation.set(-Math.PI/2,0,0);dummy.scale.set(s.w,s.d,1);dummy.updateMatrix();return dummy.matrix.clone();});group.add(contactShadows);
    const backdropMaterial=new THREE.MeshBasicMaterial({map:maps[0],fog:true,transparent:true,opacity:.42,depthWrite:false,color:0xffffff});
    backdropMaterial.onBeforeCompile=shader=>{shader.fragmentShader=shader.fragmentShader.replace('#include <alphatest_fragment>',`diffuseColor.a *= smoothstep(0.0,0.18,vMapUv.x)*smoothstep(0.0,0.18,1.0-vMapUv.x)*smoothstep(0.0,0.22,vMapUv.y)*smoothstep(0.0,0.20,1.0-vMapUv.y);\n#include <alphatest_fragment>`);};
    const backdrop=new THREE.Mesh(new THREE.PlaneGeometry(48,24),backdropMaterial);backdrop.position.set(setting==='nj'?-26:-44,0,setting==='nj'?-95:-145);group.add(backdrop);
    group.visible=false;this.scene.add(group);return {group,colliders,details,maps,backdrop,lowFence,fullFence,propLODs,choppingObject,contactShadows,shadows,shadowMatrices};
  }
  async setSetting(value){
    if(!SPECIES[value])throw Error('Unknown setting');const epoch=++this.settingsEpoch;const yard=await this.loadYard(value);if(epoch!==this.settingsEpoch)return;
    this.cancelSwing();this.yard?.group&&(this.yard.group.visible=false);this.yard=yard;yard.group.visible=true;this.colliders=yard.colliders;
    this.setting=value;this.fields??=new Map();if(this.field)this.field.group.visible=false;
    if(!this.fields.has(value)){
      const field=new YardTreeField(this.scene,this.library,{lod1Distance:8,lod2Distance:20,castShadow:false}),random=randomSource(this.worldSeed^(value==='nj'?8123:3974)),species=SPECIES[value];
      // First trees are reachable from the block; the rest give the yard a layered edge.
      // Leave room between the lowest branches and the boundary, plus interior
      // lanes wide enough for a whole crown to land without crossing the fence.
      const positions=[[6.5,8],[-6.4,7.5],[8,.5],[-7,4.8],[4,9],[-3,10.5],[2,10.7],[-8.4,-.8],[8.2,4.8]];
      if(value==='tiraspol'){positions[0]=[4.8,6.5];positions[4]=[-1,8.4];}
      for(let i=positions.length;i<46;i++){const a=(i-9)*2.39996,r=17+(i%4)*5+random()*3;positions.push([Math.sin(a)*r,Math.cos(a)*r]);}
      if(value==='tiraspol')for(const p of positions){if(p[1]<-14&&Math.abs(p[0]-(1-p[1]*-.29))<5)p[0]-=11;}
      for(let i=0;i<positions.length;i++){const [x,z]=positions[i];const tree=field.place(species[i%4],i%3,x,z,{rotY:random()*Math.PI*2,scale:.9+random()*.2});tree.userIndex=i;}
      this.fields.set(value,field);
    }
    const fenceHeight=value==='nj'?1.3:1.5;
    this.field=this.fields.get(value);this.field.sharedWorld=!!this.sharedWorld;this.field.obstacles=[...this.colliders,{minX:-12.1,maxX:-11.9,minZ:-12,maxZ:14,minY:0,maxY:fenceHeight},{minX:11.9,maxX:12.1,minZ:-12,maxZ:14,minY:0,maxY:fenceHeight},{minX:-12,maxX:12,minZ:-12.1,maxZ:-11.9,minY:0,maxY:fenceHeight},{minX:-12,maxX:12,minZ:13.9,maxZ:14.1,minY:0,maxY:fenceHeight},{minX:-.48,maxX:.48,minZ:-.48,maxZ:.48,minY:0,maxY:.78}];
    this.field.group.visible=true;this.field.update(this.camera,0);this.applyQuality(this.quality);this.player.position.set(this.mode==='yard'?1.5:0,0,this.mode==='yard'?2.7:-.72);this.heading=this.mode==='yard'?Math.PI:0;this.player.rotation.y=this.heading;this.moveSpeed=0;this.cheerUntil=0;this.play(this.mode==='yard'?'Idle':'Axe_Stance');
    if(this.mode==='yard')this.followCamera(1,true);this.save();this.syncUI();
  }
  applyQuality(value){
    this.quality=value;const count=this.sharedWorld?46:value==='low'?25:value==='medium'?36:46;
    if(this.character&&this.characterLow!==(value==='low'||this.softwareRenderer))this.setCostume(this.costume);
    if(this.field){this.field.lod1D=value==='low'?5:this.softwareRenderer?7:value==='medium'?18:28;this.field.lod2D=value==='low'?11:this.softwareRenderer?18:value==='medium'?45:75;this.field.castShadow=value!=='low'&&!this.softwareRenderer;
      for(const tree of this.field.trees){if(tree.userIndex>=count&&tree.state==='standing')tree.state='gone';else if(tree.userIndex<count&&tree.state==='gone')tree.state='standing';}
      this.field._dirty=true;this.field.group.traverse(o=>{if(o.isMesh)o.castShadow=this.field.castShadow&&!o.material?.name?.startsWith('impostor');});
    }
    if(this.yard){const reduced=value==='low'||this.softwareRenderer;this.yard.lowFence.visible=reduced;this.yard.fullFence.visible=!reduced;for(const lod of this.yard.propLODs){lod.reduced.visible=reduced;lod.full.forEach(o=>{o.visible=!reduced;});}
      this.yard.details.forEach(o=>{o.visible=value!=='low'||!!o.userData.keepOnLow;});
      let i=0;this.yard.shadows.forEach((s,index)=>{if(s.object.visible)this.yard.contactShadows.setMatrixAt(i++,this.yard.shadowMatrices[index]);});this.yard.contactShadows.count=i;this.yard.contactShadows.instanceMatrix.needsUpdate=true;
    }this.efficientMaterials();this.save();this.syncUI();
  }
  efficientMaterials(){
    const cheapMode=this.quality==='low'||this.softwareRenderer;
    this.scene.traverse(o=>{
      if(!o.isMesh)return;
      if(!o.userData.assetFullMaterial)o.userData.assetFullMaterial=o.material;
      const full=o.userData.assetFullMaterial;
      const convert=m=>{
        if(!m?.isMeshStandardMaterial)return m;
        let cheap=this.materialCache.get(m);if(!cheap){const tree=!!o.geometry?.getAttribute('_wind');const Type=o.isSkinnedMesh?THREE.MeshLambertMaterial:THREE.MeshBasicMaterial;cheap=new Type({name:m.name,map:m.map,color:m.color,transparent:m.transparent,opacity:m.opacity,alphaTest:m.alphaTest,side:m.side,depthWrite:m.depthWrite,fog:m.fog,vertexColors:m.vertexColors});if(cheap.isMeshLambertMaterial){cheap.emissive.copy(m.emissive);cheap.emissiveMap=m.emissiveMap;}if(tree){cheap.onBeforeCompile=(shader,renderer)=>{m.onBeforeCompile(shader,renderer);shader.vertexShader=shader.vertexShader.replaceAll('objectNormal *','normal *');};cheap.customProgramCacheKey=()=>m.customProgramCacheKey()+'_basic';}this.materialCache.set(m,cheap);}
        cheap.color.copy(m.color);if(cheap.isMeshBasicMaterial)cheap.color.multiplyScalar(this.lightFactor??1);
        return cheap;
      };
      o.material=cheapMode?(Array.isArray(full)?full.map(convert):convert(full)):full;
    });
    this.lastMaterialLight=this.lightFactor??1;this.materialsDirty=false;
  }
  async enterYard(){
    this.keys.clear();this.moveSpeed=0;this.cheerUntil=0;this.mode='yard';this.stumpAction=null;this.cancelSwing();this.player.position.set(1.5,0,2.7);this.player.rotation.y=this.heading=Math.PI;this.controls.enabled=false;this.camera.fov=52;this.camera.updateProjectionMatrix();this.play('Idle');this.followCamera(1,true);this.onMode('yard');this.renderer.domElement.focus({preventScroll:true});this.syncUI();
  }
  async enterStump(){
    this.keys.clear();this.moveSpeed=0;this.cheerUntil=0;this.stumpAction=null;this.cancelSwing();this.mode='stump';this.player.position.set(0,0,-.72);this.player.rotation.y=0;this.controls.enabled=true;this.play('Axe_Stance');this.onMode('stump');this.renderer.domElement.focus({preventScroll:true});this.syncUI();
  }
  forward(){return new THREE.Vector3(Math.sin(this.heading),0,Math.cos(this.heading));}
  bindInputs(){
    window.addEventListener('keydown',e=>{
      if(e.target?.matches?.('input,textarea,select,button,a,summary')||document.querySelector('dialog[open]')||e.ctrlKey||e.metaKey||e.altKey)return;
      if(this.mode==='yard'&&['KeyW','KeyA','KeyS','KeyD','ShiftLeft','ShiftRight'].includes(e.code)){e.preventDefault();this.keys.add(e.code);}
      if(e.repeat)return;
      if((e.code==='Escape'||e.code==='KeyE')&&this.mode==='stump'){e.preventDefault();this.enterYard();}
      else if(this.mode==='yard'&&e.code==='KeyE'&&this.player.position.length()<2.6){e.preventDefault();this.enterStump();}
      else if(this.mode==='yard'&&e.code==='Space'){e.preventDefault();this.swingTree();}
    });
    window.addEventListener('keyup',e=>this.keys.delete(e.code));window.addEventListener('blur',()=>{this.keys.clear();this.drag=null;});
    const canvas=this.renderer.domElement;
    canvas.tabIndex=0;canvas.setAttribute('aria-label','Backyard game. E switches modes at the block; V shows panels.');
    canvas.addEventListener('contextmenu',e=>e.preventDefault());
    canvas.addEventListener('pointerdown',e=>{
      if(this.mode!=='yard')return;
      if(e.button===2){this.drag={id:e.pointerId,x:e.clientX,y:e.clientY};canvas.setPointerCapture(e.pointerId);}
      if(e.button===0){
        const ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2(e.clientX/innerWidth*2-1,-e.clientY/innerHeight*2+1),this.camera);
        const p=new THREE.Vector3(),blockHit=this.yard?.choppingObject&&ray.intersectObject(this.yard.choppingObject,true).length>0;const groundHit=ray.ray.intersectPlane(new THREE.Plane(UP,0),p)&&Math.hypot(p.x,p.z)<.8;if(this.player.position.length()<2.6&&(blockHit||groundHit))this.enterStump();else this.swingTree();
      }
    });
    canvas.addEventListener('pointermove',e=>{if(this.mode!=='yard'||!this.drag)return;this.heading-=(e.clientX-this.drag.x)*.006;this.pitch=clamp(this.pitch+(e.clientY-this.drag.y)*.004,-.15,.7);this.drag.x=e.clientX;this.drag.y=e.clientY;});
    canvas.addEventListener('pointerup',()=>{this.drag=null;});canvas.addEventListener('lostpointercapture',()=>{this.drag=null;});
  }
  collide(position,radius=.32){
    this.field?.collide(position,radius);position.x=clamp(position.x,-11.5,11.5);position.z=clamp(position.z,-11.3,13.4);
    for(const b of this.colliders){if(!b.object.visible)continue;const x=clamp(position.x,b.minX,b.maxX),z=clamp(position.z,b.minZ,b.maxZ),dx=position.x-x,dz=position.z-z,d=Math.hypot(dx,dz);
      if(d<radius){if(d>.00001){position.x=x+dx/d*radius;position.z=z+dz/d*radius;}else{const edges=[{d:position.x-b.minX,x:b.minX-radius,z:position.z},{d:b.maxX-position.x,x:b.maxX+radius,z:position.z},{d:position.z-b.minZ,x:position.x,z:b.minZ-radius},{d:b.maxZ-position.z,x:position.x,z:b.maxZ+radius}].sort((a,b)=>a.d-b.d);position.x=edges[0].x;position.z=edges[0].z;}}
    }
    const d=Math.hypot(position.x,position.z);if(d<.80){if(d<.001)position.z=-.8;else{position.x*=.80/d;position.z*=.80/d;}}
    // Settled trunks stay solid too. Crowns remain soft to avoid trapping players.
    for(const tree of this.field?.trees??[]){if(!['fallen','stump'].includes(tree.state)||!tree.fallDirection||!tree.obj?.hinge.visible)continue;
      const a=tree.position,dir=tree.fallDirection,angle=tree.anim?.th??Math.PI/2,fullLength=(tree.meta.height-tree.meta.chopHeight)*tree.scale,length=fullLength*Math.sin(angle);
      const t=clamp((position.x-a.x)*dir.x+(position.z-a.z)*dir.z,0,length),x=a.x+dir.x*t,z=a.z+dir.z*t,dx=position.x-x,dz=position.z-z,dist=Math.hypot(dx,dz),r=tree.radius+radius;
      if(tree.meta.chopHeight*tree.scale+t/Math.max(length,.001)*fullLength*Math.cos(angle)>1.65+tree.radius)continue;
      if(dist<r&&dist>1e-5){position.x=x+dx/dist*r;position.z=z+dz/dist*r;}
    }
  }
  followCamera(dt,snap=false){
    const look=this.cameraLook.copy(this.player.position);look.y+=1.1;
    const desired=this.cameraDesired.set(look.x-Math.sin(this.heading)*4.5+Math.cos(this.heading)*.5,look.y+1.15+this.pitch*3,look.z-Math.cos(this.heading)*4.5-Math.sin(this.heading)*.5);
    // Shorten the boom before a tree or large prop can hide the player.
    let factor=1;for(let i=1;i<=24;i++){const t=i/24,x=THREE.MathUtils.lerp(look.x,desired.x,t),y=THREE.MathUtils.lerp(look.y,desired.y,t),z=THREE.MathUtils.lerp(look.z,desired.z,t);let blocked=false;
      for(const tree of this.field?.trees??[]){
        if(tree.state!=='gone'&&y<(tree.state==='standing'||tree.state==='chopping'?tree.meta.height*tree.scale:.7)&&(x-tree.position.x)**2+(z-tree.position.z)**2<(tree.radius+.3)**2){blocked=true;break;}
        if(tree.fallDirection&&tree.obj?.hinge.visible){
          const angle=tree.anim.th,length=(tree.meta.height-tree.meta.chopHeight)*tree.scale,dx=tree.fallDirection.x*length*Math.sin(angle),dy=length*Math.cos(angle),dz=tree.fallDirection.z*length*Math.sin(angle),ax=tree.position.x,ay=tree.position.y+tree.meta.chopHeight*tree.scale,az=tree.position.z;
          const u=clamp(((x-ax)*dx+(y-ay)*dy+(z-az)*dz)/(dx*dx+dy*dy+dz*dz),0,1);
          if((x-ax-dx*u)**2+(y-ay-dy*u)**2+(z-az-dz*u)**2<(tree.radius+.24)**2){blocked=true;break;}
        }
      }
      if(!blocked)for(const b of this.colliders)if(b.object.visible&&y<b.maxY+.2&&x>b.minX-.22&&x<b.maxX+.22&&z>b.minZ-.22&&z<b.maxZ+.22){blocked=true;break;}
      if(blocked||Math.abs(x)>11.85||z< -11.7||z>13.8){factor=Math.max(.18,t-.08);break;}}
    desired.lerp(look,1-factor);
    const inward=factor<(this.cameraFraction??1);this.cameraFraction=factor;
    this.camera.position.lerp(desired,snap||inward?1:1-Math.exp(-dt*8));this.camera.lookAt(look);this.controls.target.copy(look);
  }
  target(){return this.field?.pick(this.player.position,this.forward(),1.7,.5)??null;}
  cancelSwing(){this.swingEpoch=(this.swingEpoch??0)+1;if(this.swinging)this.swinging.resolve(this.swinging.result??{felled:false,hits:this.swinging.target.tree.hits});this.swinging=null;}
  async swingTree(){
    if(this.mode!=='yard'||this.swinging||!this.loaded)return {felled:false,hits:0};
    const target=this.target();if(!target){this.onStatus('Walk closer to a trunk and face it to chop.');return {felled:false,hits:0};}
    const direction=target.tree.position.clone().sub(this.player.position).setY(0).normalize();
    this.heading=Math.atan2(direction.x,direction.z);
    this.cheerUntil=0;
    return new Promise(resolve=>{this.swinging={time:0,land:.67,duration:1.18,target,resolve,result:null,action:null,freeze:0,approach:target.approachPoint.clone()};});
  }
  landTreeSwing(swing){
    const target=this.target();if(!target||target.tree!==swing.target.tree){swing.result={felled:false,hits:swing.target.tree.hits};return;}
    const dir=target.tree.position.clone().sub(this.player.position).setY(0).normalize();const shared=this.coop?.inSession();
    const result=shared?{felled:false,hits:target.tree.hits+1,hitsToFell:target.tree.meta.hitsToFell}:this.field.hit(target.tree,dir,1);
    swing.result=result;swing.freeze=.075;this.materialsDirty=true;this.spawnChips(target.point);this.audio.play('treeHit');this.onShake(.018,140);
    this.onStatus(`${target.tree.species[0].toUpperCase()+target.tree.species.slice(1)} · ${result.hits} / ${result.hitsToFell} cuts${result.felled?' · Timber! +35 XP · +20 coins':''}`);
    if(shared){this.coop.session.hitTree(target.tree.id,1);result.felled=['falling','fallen','stump'].includes(target.tree.state);}
    if(result.felled&&!shared){
      this.audio.play('treeCreak');target.tree.anim.onLand=()=>{this.audio.play('treeFall');this.onShake(.07,500);this.cheerUntil=performance.now()+1900;};
      this.onReward(target.tree);
    }
  }
  spawnChips(point){
    const count=this.quality==='low'?9:18;for(let i=0;i<count;i++){
      const map=this.chipAtlas.clone();map.repeat.set(.25,.25);const frame=Math.floor(Math.random()*16);map.offset.set((frame%4)*.25,Math.floor(frame/4)*.25);
      const material=new THREE.SpriteMaterial({map,transparent:true,depthWrite:false,color:0xffe1af});const sprite=new THREE.Sprite(material);sprite.position.copy(point);sprite.scale.setScalar(.045+Math.random()*.07);this.scene.add(sprite);this.chips.push({sprite,map,life:.8,velocity:new THREE.Vector3((Math.random()-.5)*3,1+Math.random()*2,(Math.random()-.5)*3)});
    }
  }
  celebrate(){this.cheerUntil=performance.now()+2300;}
  // Two-bone arm corrections retain the authored body motion while keeping the
  // actual hand-held tool on the same arc that determines contact and damage.
  solveArm(side,target){
    const upper=this.bones[`${side}Arm`],fore=this.bones[`${side}ForeArm`],hand=this.bones[`${side}Hand`];
    const shoulder=upper.getWorldPosition(new THREE.Vector3()),elbow=fore.getWorldPosition(new THREE.Vector3()),wrist=hand.getWorldPosition(new THREE.Vector3());
    const l1=shoulder.distanceTo(elbow),l2=elbow.distanceTo(wrist),dir=target.clone().sub(shoulder);const distance=clamp(dir.length(),.02,l1+l2-.001);dir.normalize();
    const along=(distance*distance+l1*l1-l2*l2)/(2*distance),height=Math.sqrt(Math.max(0,l1*l1-along*along));
    const pole=new THREE.Vector3(side==='Right'?-.8:.8,-.3,-.3).applyAxisAngle(UP,this.player.rotation.y);pole.addScaledVector(dir,-pole.dot(dir)).normalize();
    const desiredElbow=shoulder.clone().addScaledVector(dir,along).addScaledVector(pole,height),desiredWrist=shoulder.clone().addScaledVector(dir,distance);
    const turn=(bone,from,to)=>{const delta=new THREE.Quaternion().setFromUnitVectors(from.normalize(),to.normalize());const world=bone.getWorldQuaternion(new THREE.Quaternion()).premultiply(delta);const parent=bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert();bone.quaternion.copy(parent.multiply(world));bone.updateMatrixWorld(true);};
    turn(upper,elbow.clone().sub(shoulder),desiredElbow.clone().sub(shoulder));
    const newElbow=fore.getWorldPosition(new THREE.Vector3());turn(fore,hand.getWorldPosition(new THREE.Vector3()).sub(newElbow),desiredWrist.clone().sub(newElbow));
    return hand.getWorldPosition(new THREE.Vector3());
  }
  poseTool(grip,rotation,twoHands=true,gripSpacing=.18,leftWeight=1){
    if(!this.hand||!this.heldAxe)return;
    this.lastToolPose??={grip:new THREE.Vector3(),rotation:new THREE.Quaternion(),twoHands};this.lastToolPose.grip.copy(grip);this.lastToolPose.rotation.copy(rotation);this.lastToolPose.twoHands=twoHands;this.lastToolPose.gripSpacing=gripSpacing;this.lastToolPose.leftWeight=leftWeight;
    const axis=new THREE.Vector3(0,1,0).applyQuaternion(rotation),handRotation=rotation.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),Math.PI/2));
    const palm=new THREE.Vector3(0,.06,.01).applyQuaternion(handRotation);
    const actual=this.solveArm('Right',grip.clone().sub(palm)).add(palm);
    this.hand.quaternion.copy(this.hand.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(handRotation));this.hand.updateMatrixWorld(true);
    if(twoHands){
      const left=this.bones.LeftHand,chain=[this.bones.LeftArm,this.bones.LeftForeArm,left];this.leftBlendRest??=chain.map(()=>new THREE.Quaternion());chain.forEach((bone,i)=>this.leftBlendRest[i].copy(this.mode==='yard'&&this.swinging&&this.relaxedLeft?this.relaxedLeft[i]:bone.quaternion));
      const leftRotation=rotation.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),-Math.PI/2)),leftPalm=new THREE.Vector3(0,.06,.01).applyQuaternion(leftRotation);this.solveArm('Left',actual.clone().addScaledVector(axis,gripSpacing).sub(leftPalm));left.quaternion.copy(left.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(leftRotation));
      if(leftWeight<1)chain.forEach((bone,i)=>bone.quaternion.slerp(this.leftBlendRest[i],1-leftWeight));
    }
    this.player.updateMatrixWorld(true);
    const desired=new THREE.Matrix4().compose(actual,rotation,new THREE.Vector3(1,1,1));
    const local=new THREE.Matrix4().copy(this.hand.matrixWorld).invert().multiply(desired);
    local.decompose(this.heldAxe.position,this.heldAxe.quaternion,this.heldAxe.scale);
  }
  carryPose(){
    const yaw=this.player.rotation.y;
    const grip=new THREE.Vector3(-.34,.90,.14).applyAxisAngle(UP,yaw).add(this.player.position);
    const rotation=new THREE.Quaternion().setFromAxisAngle(UP,yaw).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),Math.PI-.15)).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),.25));
    return {grip,rotation};
  }
  readyGripOffset(){return new THREE.Vector3(-.05,1.12,this.characterId==='alex'&&this.costume==='bomber'?.18:.20);}
  poseCarry(){
    if(this.mode==='stump'){const grip=this.player.position.clone().add(this.readyGripOffset()),rotation=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),.75).multiply(new THREE.Quaternion().setFromAxisAngle(UP,Math.PI/2));this.poseTool(grip,rotation);}
    else{const {grip,rotation}=this.carryPose();this.poseTool(grip,rotation,false);}
  }
  turnWorld(bone,axis,angle){
    if(!bone||Math.abs(angle)<.00001)return;
    // Meshy joints do not share a convenient local bend axis. Correct in world
    // space, then return to the parent's frame (as the arm solver does).
    const world=bone.getWorldQuaternion(new THREE.Quaternion()).premultiply(new THREE.Quaternion().setFromAxisAngle(axis,angle));
    bone.quaternion.copy(bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(world));bone.updateMatrixWorld(true);
  }
  leanIntoCut(weight,cutHeight){
    if(weight<=0)return;
    const spine=this.bones.Spine,pivot=spine.getWorldPosition(new THREE.Vector3()),center=this.bones.RightArm.getWorldPosition(new THREE.Vector3()).add(this.bones.LeftArm.getWorldPosition(new THREE.Vector3())).multiplyScalar(.5);
    const desired=this.player.position.clone().add(new THREE.Vector3(0,clamp(cutHeight+.64,1.02,1.17),0)).addScaledVector(this.forward(),.27).sub(pivot).normalize();
    const delta=new THREE.Quaternion().setFromUnitVectors(center.sub(pivot).normalize(),desired);delta.slerp(new THREE.Quaternion(),1-weight);
    const world=spine.getWorldQuaternion(new THREE.Quaternion()).premultiply(delta);spine.quaternion.copy(spine.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(world));spine.updateMatrixWorld(true);
  }
  lookAtTarget(target,dt){
    // Small additive turns preserve the supplied expression and keep the neck
    // comfortably neutral. The gaze returns smoothly when a target is lost.
    let yaw=0,pitch=0;
    if(target){const p=target.point,dx=p.x-this.player.position.x,dz=p.z-this.player.position.z;
      yaw=clamp(Math.atan2(Math.sin(Math.atan2(dx,dz)-this.player.rotation.y),Math.cos(Math.atan2(dx,dz)-this.player.rotation.y)),-.32,.32);
      pitch=clamp(Math.atan2(1.5-p.y,Math.hypot(dx,dz))*.3,-.10,.21);
    }
    this.gazeYaw=THREE.MathUtils.damp(this.gazeYaw,yaw,9,dt);this.gazePitch=THREE.MathUtils.damp(this.gazePitch,pitch,9,dt);
    const right=new THREE.Vector3(Math.cos(this.player.rotation.y),0,-Math.sin(this.player.rotation.y));
    this.turnWorld(this.bones.Spine02,UP,this.gazeYaw*.25);this.turnWorld(this.bones.Spine02,right,this.gazePitch*.18);
    this.turnWorld(this.bones.Head,UP,this.gazeYaw);this.turnWorld(this.bones.Head,right,this.gazePitch);
  }
  poseStumpTool(simulation){
    const readyGrip=this.player.position.clone().add(this.readyGripOffset()),readyRotation=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),.75).multiply(new THREE.Quaternion().setFromAxisAngle(UP,Math.PI/2));
    if(!simulation.running){this.poseTool(readyGrip,readyRotation);return;}
    const rotation=new THREE.Quaternion(simulation.axe.quaternion.x,simulation.axe.quaternion.y,simulation.axe.quaternion.z,simulation.axe.quaternion.w);
    // The larger heads need a more upright handle at contact. The blade
    // anchor still follows the exact physical head, including recoil/hit-stop.
    const maxAngle=this.axe==='maul'?1.7:this.axe==='sergey'?1.95:2.0;
    if(simulation.poseAngle>maxAngle)rotation.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),maxAngle-simulation.poseAngle));
    rotation.multiply(new THREE.Quaternion().setFromAxisAngle(UP,Math.PI/2));
    const head=simulation.axe.pointToWorldFrame({x:0,y:.205,z:.235});
    const grip=new THREE.Vector3(head.x,head.y,head.z).sub(this.bladeAnchor.clone().applyQuaternion(rotation));
    const lift=THREE.MathUtils.smoothstep(simulation.elapsed,0,.16);grip.lerp(readyGrip,1-lift);rotation.slerp(readyRotation,1-lift);
    this.poseTool(grip,rotation);
  }
  stumpSwing(simulation){
    if(!this.mixer)return;const name=simulation.strikeTool==='wedge'||this.axe==='maul'?'Heavy_Hammer_Swing':'Charged_Axe_Chop';this.play(name,.1,true);
    // The visual clip is sampled against the physics clock, including hit-stop.
    this.stumpAction=this.currentAction;this.stumpAction.paused=true;
  }
  update(dt,atmosphere,simulation){
    if(!this.loaded)return;dt=Math.min(dt,.25);const now=performance.now();let moving=false,animationDt=dt,frameTarget=null;
    if(this.mode==='yard'){
      const start=this.moveStart.copy(this.player.position);const z=Number(this.keys.has('KeyW'))-Number(this.keys.has('KeyS')),x=Number(this.keys.has('KeyD'))-Number(this.keys.has('KeyA'));
      const run=this.keys.has('ShiftLeft')||this.keys.has('ShiftRight'),speed=run?3.6:this.player.position.length()<2.8?1.05:1.45;
      this.moveSpeed=THREE.MathUtils.damp(this.moveSpeed,x||z?speed:0,10,dt);
      if(!this.swinging&&(x||z)){const delta=this.moveDelta.set(Math.sin(this.heading)*z-Math.cos(this.heading)*x,0,Math.cos(this.heading)*z+Math.sin(this.heading)*x).normalize().multiplyScalar(this.moveSpeed*dt);const steps=Math.max(1,Math.ceil(delta.length()/.12));for(let i=0;i<steps;i++){this.player.position.addScaledVector(delta,1/steps);this.collide(this.player.position);}}
      if(this.swinging){const s=this.swinging;
        if(!s.action){
          const delta=this.moveDelta.copy(s.approach).sub(this.player.position).setY(0),distance=delta.length();
          if(distance>.045){this.player.position.addScaledVector(delta,Math.min(distance,dt*1.25)/distance);this.collide(this.player.position);}
          if(distance<=.045||this.player.position.distanceToSquared(start)<.000001){this.play(this.axe==='maul'?'Heavy_Hammer_Swing':'Charged_Axe_Chop',.16,true);s.action=this.currentAction;s.action.paused=true;this.audio.play('swing',{power:100});}
        }else{
          if(s.freeze>0){s.freeze=Math.max(0,s.freeze-dt);animationDt=0;}
          else {s.time+=dt;if(!s.result&&s.time>=s.land){s.time=s.land;this.landTreeSwing(s);}}
          s.action.time=clamp(s.time/s.duration,0,1)*s.action.getClip().duration;s.action.paused=true;
          if(s.time>=s.duration){this.swinging=null;s.resolve(s.result??{felled:false,hits:0});}
        }
      }
      const travel=this.travel.copy(this.player.position).sub(start),distance=travel.length();moving=distance>.002;
      this.stepDistance+=distance;const stride=run?1.45:.70;if(this.stepDistance>stride){this.stepDistance%=stride;this.audio.play('footstep',{surface:this.player.position.length()<3?'mulch':this.setting==='nj'?'grass':'dirt'});}
      const facing=moving?Math.atan2(travel.x,travel.z):this.heading;
      this.player.rotation.y+=Math.atan2(Math.sin(facing-this.player.rotation.y),Math.cos(facing-this.player.rotation.y))*(1-Math.exp(-dt*16));
      if(this.swinging)this.player.rotation.y=this.heading;
      if(!this.swinging||!this.swinging.action){if(moving){const actualSpeed=distance/Math.max(dt,.001),name=actualSpeed>2.1?'Run':actualSpeed<.55?'Casual_Walk':'Walk';this.play(name,.22);this.currentAction.setEffectiveTimeScale(clamp(actualSpeed/(name==='Run'?(this.costume==='tee'?4.55:4.40):name==='Walk'?(this.costume==='tee'?1.29:1.32):.68),.05,2.2));}else if(now<this.cheerUntil)this.play('Victory_Cheer',.28);else this.play('Idle',.2);}
      this.followCamera(dt);
      const target=frameTarget=this.target();this.targetRing.visible=!!target;if(target){this.targetRing.position.set(target.tree.position.x,.024,target.tree.position.z);this.targetRing.scale.setScalar((target.tree.radius+.18)/.47);}
      setText('yard-prompt',this.swinging?'Weight up. Let the blade land.':target?`${target.tree.species.toUpperCase()} · ${target.tree.hits} / ${target.tree.meta.hitsToFell} cuts · Click / Space to chop`:this.player.position.length()<2.6?'CHOPPING BLOCK · E / click to find the grain':'WASD to walk · Shift to run · Right drag to look');
      const stats=this.field.stats();setText('yard-tree-count',`${stats.standing+stats.chopping} trees standing`);
    }else{
      this.targetRing.visible=false;
      if(simulation.running){if(!this.stumpAction)this.stumpSwing(simulation);const c=this.stumpAction.getClip(),duration=.84+simulation.duration+.65;this.stumpAction.time=clamp(simulation.elapsed/duration,0,1)*c.duration;this.stumpAction.paused=true;
        // On contact, the hand-held blade aligns to the simulation's impact plane.
        if(simulation.impactHandled)this.stumpAction.time=Math.max(this.stumpAction.time,c.duration*.60);
      }else{this.stumpAction=null;if(now<this.cheerUntil)this.play('Victory_Cheer',.2);else this.play('Axe_Stance');}
    }
    // PropertyMixer can skip writing a constant track. Restore the last authored
    // pose first so additive gaze/IK never accumulates on a held or flat keyframe.
    for(const pose of this.animationPose)pose.bone.quaternion.copy(pose.rotation);
    this.blendActions(animationDt);this.mixer.update(animationDt);
    for(const pose of this.animationPose)pose.rotation.copy(pose.bone.quaternion);
    this.lookAtTarget(this.swinging?.target??frameTarget,animationDt);
    if(this.mode==='yard'&&this.swinging?.action){const s=this.swinging,lean=THREE.MathUtils.smoothstep(s.time/s.land,.50,1)*(1-THREE.MathUtils.smoothstep(s.time,s.land+.1,s.duration));this.leanIntoCut(lean,s.target.point.y);}
    this.player.updateMatrixWorld(true);
    this.playerShadow.position.set(this.player.position.x,.026,this.player.position.z);this.playerShadow.rotation.z=-this.player.rotation.y;
    if(this.mode==='stump'&&(simulation.running||now>=this.cheerUntil))this.poseStumpTool(simulation);
    else if(this.mode==='stump'&&this.heldAxe)this.poseCarry();
    else if(this.mode==='yard'&&this.swinging?.action){
      const s=this.swinging,u=clamp(s.time/s.land,0,1),recovery=THREE.MathUtils.smoothstep(s.time,s.land+.1,s.duration),endAngle=this.axe==='maul'?1.85:this.axe==='sergey'?2.4:2.3,angle=u<.60?THREE.MathUtils.lerp(.5,-1.0,u/.60):THREE.MathUtils.lerp(-1,endAngle,(u-.60)/.40);
      const rotation=new THREE.Quaternion().setFromAxisAngle(UP,this.heading).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),angle)).multiply(new THREE.Quaternion().setFromAxisAngle(UP,Math.PI/2));
      const hit=s.target.point.clone();
      const endGrip=hit.sub(this.bladeAnchor.clone().applyQuaternion(rotation));
      const rest=this.player.position.clone().add(new THREE.Vector3(0,u<.6?1.30:1.1,0)).addScaledVector(this.forward(),.32);
      const carry=this.carryPose(),grip=rest.lerp(endGrip,THREE.MathUtils.smoothstep(u,.55,1));grip.lerp(carry.grip,recovery);rotation.slerp(carry.rotation,recovery);
      const lift=THREE.MathUtils.smoothstep(s.time,0,.18);grip.lerp(carry.grip,1-lift);rotation.slerp(carry.rotation,1-lift);
      const handSlide=THREE.MathUtils.smoothstep(u,.55,1)*(1-recovery),spacing=this.axe==='maul'?THREE.MathUtils.lerp(-.10,-.07,handSlide):THREE.MathUtils.lerp(.18,this.axe==='sergey'?.05:.07,handSlide);
      this.poseTool(grip,rotation,true,spacing,THREE.MathUtils.smoothstep(s.time,0,.12)*(1-THREE.MathUtils.smoothstep(s.time,s.duration-.18,s.duration)));
    }else if(this.mode==='yard')this.poseCarry();
    this.updateRemoteActors(dt);
    updateWind(now/1000);WIND.uWindStrength.value=atmosphere.weather==='wind'?1.8:atmosphere.weather==='rain'?.8:.35;
    this.field.playerFocus.copy(this.player.position);this.field.playerFocus.y+=1.2;this.field.hasChopFocus=!!(this.swinging?.target??frameTarget);
    if(this.field.hasChopFocus)this.field.chopFocus.copy((this.swinging?.target??frameTarget).point);
    this.field.update(this.camera,dt);
    this.lightFactor=(.20+.8*THREE.MathUtils.smoothstep(Math.sin((atmosphere.hour-6)/12*Math.PI),-.15,.35))*(atmosphere.weather==='rain'?.78:atmosphere.weather==='fog'?.9:1);if(this.materialsDirty||Math.abs(this.lightFactor-(this.lastMaterialLight??0))>.015)this.efficientMaterials();
    const hour=atmosphere.hour,idx=hour<6||hour>=20?2:hour<8||hour>=18?1:0;this.yard.backdrop.material.map=this.yard.maps[idx];this.yard.backdrop.material.color.setScalar(idx===2?.52:idx===1?.8:1);
    // The skyline stays visible in clear weather; fog still closes in naturally.
    if(atmosphere.weather!=='fog'){this.scene.fog.near=atmosphere.weather==='rain'?12:32;this.scene.fog.far=atmosphere.weather==='rain'?110:185;}
    for(let i=this.chips.length-1;i>=0;i--){const c=this.chips[i];c.life-=dt;c.velocity.y-=dt*9.81;c.sprite.position.addScaledVector(c.velocity,dt);c.sprite.material.opacity=Math.min(1,c.life*3);if(c.life<=0){c.sprite.removeFromParent();c.sprite.material.dispose();c.map.dispose();this.chips.splice(i,1);}}
  }
  teleportNearTree(){
    const candidates=this.field?.trees.filter(t=>t.state==='standing'||t.state==='chopping')??[];candidates.sort((a,b)=>a.position.distanceToSquared(this.player.position)-b.position.distanceToSquared(this.player.position));const tree=candidates.find(t=>Math.abs(t.position.x)<10.5&&t.position.z>-10&&t.position.z<12)??candidates[0];if(!tree)return null;
    this.mode='yard';this.controls.enabled=false;this.onMode('yard');this.keys.clear();this.cancelSwing();
    const dir=tree.position.clone().sub(this.player.position).setY(0).normalize();this.player.position.copy(tree.position).addScaledVector(dir,-tree.meta.approachDistance*tree.scale);this.player.position.y=0;this.heading=Math.atan2(dir.x,dir.z);this.player.rotation.y=this.heading;this.camera.fov=52;this.camera.updateProjectionMatrix();this.followCamera(1,true);this.play('Idle');return tree.id;
  }
  async chopTree(){
    if(this.mode!=='yard')await this.enterYard();if(!this.target())this.teleportNearTree();const tree=this.target()?.tree;if(!tree)return {felled:false,hits:0};
    const epoch=this.swingEpoch,field=this.field;
    let result={felled:false,hits:tree.hits};for(let i=0;i<30&&!result.felled;i++){if(!['standing','chopping'].includes(tree.state)||epoch!==this.swingEpoch)break;result=await this.swingTree();if(this.coop?.inSession())for(let n=0;n<40&&tree.hits<=result.hits-1&&['standing','chopping'].includes(tree.state);n++)await wait(50);if(this.target()?.tree!==tree&&!result.felled)break;}
    // Resolve after the physical fall reaches the ground, so the stump is testable.
    for(let i=0;i<600&&tree.state==='falling'&&field===this.field&&epoch===this.swingEpoch;i++)await wait(50);
    return {felled:['falling','fallen','stump'].includes(tree.state),hits:tree.hits};
  }
  state(){
    const trees=this.field?.trees.filter(t=>t.state==='standing'||t.state==='chopping')??[];const nearest=trees.reduce((a,t)=>!a||t.position.distanceToSquared(this.player.position)<a.position.distanceToSquared(this.player.position)?t:a,null);
    const raw=this.field?.stats()??{standing:0,chopping:0,falling:0,felled:0};delete raw.gone;
    return {setting:this.setting,character:this.characterId,name:this.playerName,costume:this.costume,axe:this.axe,quality:this.quality,mode:this.mode,player:{x:this.player.position.x,y:this.player.position.y,z:this.player.position.z},anim:this.anim,characterLoaded:!!this.character,axeAttachedTo:this.heldAxe?.parent?.name??null,trees:raw,nearestTree:nearest?{id:nearest.id,x:nearest.position.x,z:nearest.position.z,radius:nearest.radius,distance:nearest.position.distanceTo(this.player.position)}:null};
  }
  async rebuildSharedWorld({seed,setting,fresh}){
    this.sharedWorld=true;
    if(fresh||this.worldSeed!==seed){
      this.cancelSwing();
      for(const field of this.fields?.values()??[]){field.group.removeFromParent();for(const pool of field.pools.values())for(const meshes of Object.values(pool.meshes??{}))for(const mesh of meshes)mesh.geometry.dispose();}
      this.fields=new Map();this.field=null;
      if(this.worldSeed!==seed){for(const yard of this.yards.values())(await yard).group.removeFromParent();this.yards.clear();this.yard=null;}
      this.worldSeed=seed;
    }
    await this.setSetting(setting);
  }
  async spawnRemoteAvatar(profile){
    const rig=Object.create(AssetBackyard.prototype);
    Object.assign(rig,{player:new THREE.Group(),characterId:profile.character,costume:profile.costume,axe:profile.axe,mode:'yard',quality:this.quality,softwareRenderer:this.softwareRenderer,characterCache:this.characterCache,loadCharacter:this.loadCharacter.bind(this),axeCache:this.axeCache,actionWeights:new Map(),remoteActors:new Set(),save(){},syncUI(){},cancelSwing(){}});
    await rig.setCostume(profile.costume);
    this.remoteActors.add(rig);this.materialsDirty=true;
    return {root:rig.player,headHeight:1.83,setAnim:name=>{rig.play(name==='Casual_Walk'?'Walk':rig.actions.has(name)?name:'Idle',.16);},dispose:()=>{this.remoteActors.delete(rig);rig.mixer.stopAllAction();rig.mixer.uncacheRoot(rig.character);rig.character.traverse(o=>{if(o.isSkinnedMesh)o.skeleton.dispose();});rig.player.removeFromParent();}};
  }
  updateRemoteActors(dt){
    for(const rig of this.remoteActors){
      for(const pose of rig.animationPose)pose.bone.quaternion.copy(pose.rotation);
      rig.blendActions(dt);rig.mixer.update(dt);
      for(const pose of rig.animationPose)pose.rotation.copy(pose.bone.quaternion);
      rig.player.updateMatrixWorld(true);
      if(!['Charged_Axe_Chop','Heavy_Hammer_Swing'].includes(rig.anim))rig.poseCarry();
    }
  }
  syncUI(){for(const [id,value]of [['yard-setting',this.setting],['sergey-costume',this.costume],['sergey-axe',this.axe]]){const e=document.getElementById(id);if(e)e.value=value;}
    setText('axe-description',{sergey:"Sergey's own hatchet. Balanced for everyday work.",double_bit:'Double-bit felling axe · +4% cutting efficiency at the block.',maul:'Splitting maul · +0.55 kg of striking mass at the block.',golden:'Golden axe · +12% cutting efficiency at the block.'}[this.axe]);
    document.getElementById('golden-axe-option').disabled=!this.goldenUnlocked&&this.axe!=='golden';
    document.getElementById('buy-golden-axe').textContent=this.goldenUnlocked?'Golden axe · owned':'Unlock golden axe · 180 coins';document.getElementById('buy-golden-axe').disabled=!!this.goldenUnlocked;
    document.getElementById('yard-name').textContent=this.setting==='nj'?'NJ backyard':'Tiraspol backyard';
    document.querySelector('.header-caption').textContent=`FIND THE GRAIN / ${this.setting==='nj'?'NEW JERSEY':'TIRASPOL'} / ${CHARACTERS[this.characterId].name.toUpperCase()}`;
    this.onProfile?.();
  }
}

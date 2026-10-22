import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mesh, cylinder, standard, randomSource } from './environment.js';
import { createAxeMesh } from './humanoid.js';
import { FIXED_DT, LOG_RADIUS, LOG_HEIGHT, BLOCK_TOP, LOG_TOP, swingPose, sweptEdge, woodImpact, advanceCracks, crackPoint, hollowSections, hollowSectorAt, grainAt, forkSections, impactResponse, rottenSections, windLoad, fragmentWind, inclusions, safeSolidAim, mineralSections, selectWedgeCrack, wedgeExtractionCost, burlSections, burlOutline, burlSectorAt, kerfSections, roundOutline } from './mechanics.js';

const GRIP_LOCAL=new CANNON.Vec3(0,-.64,0),HEAD_LOCAL=new CANNON.Vec3(0,.205,.235);
const clamp=THREE.MathUtils.clamp;
export class Simulation {
  constructor(scene,wood,onImpact){
    this.scene=scene;this.wood={...wood,end:wood.end.clone()};this.onImpact=onImpact;
    this.world=new CANNON.World({gravity:new CANNON.Vec3(0,-9.81,0),allowSleep:true});
    this.world.broadphase=new CANNON.SAPBroadphase(this.world);this.world.solver.iterations=24;
    this.world.defaultContactMaterial.friction=.62;this.world.defaultContactMaterial.restitution=.08;
    this.woodMaterial=new CANNON.Material('oak');this.metalMaterial=new CANNON.Material('steel');this.groundMaterial=new CANNON.Material('earth');
    this.world.addContactMaterial(new CANNON.ContactMaterial(this.woodMaterial,this.groundMaterial,{friction:.74,restitution:.12}));
    this.world.addContactMaterial(new CANNON.ContactMaterial(this.woodMaterial,this.woodMaterial,{friction:.55,restitution:.10}));
    this.world.addContactMaterial(new CANNON.ContactMaterial(this.metalMaterial,this.woodMaterial,{friction:.38,restitution:.03}));
    const ground=new CANNON.Body({mass:0,material:this.groundMaterial,shape:new CANNON.Plane()});ground.quaternion.setFromEuler(-Math.PI/2,0,0);this.world.addBody(ground);
    this.stumpBody=new CANNON.Body({mass:0,material:this.woodMaterial,shape:new CANNON.Cylinder(.40,.46,BLOCK_TOP,20),position:new CANNON.Vec3(0,BLOCK_TOP/2,0)});this.world.addBody(this.stumpBody);
    const stump=cylinder(scene,.40,.46,BLOCK_TOP,[wood.bark,wood.end,wood.end],0,BLOCK_TOP/2,0,24);
    // Slight root flare and a few irregular bark ridges.
    cylinder(scene,.44,.51,.13,wood.bark,0,.067,0,14);
    for(let i=0;i<14;i++){const a=i/14*Math.PI*2;const ridge=cylinder(scene,.025,.055,.48,wood.bark,Math.cos(a)*.414,.29,Math.sin(a)*.414,5);ridge.rotation.z=Math.sin(a)*.07;ridge.rotation.x=Math.cos(a)*.07;}
    this.staticBox(16,1.8,.12,0,.9,-4.05);this.staticBox(.12,1.8,15,-7.95,.9,3);this.staticBox(.12,1.8,15,7.95,.9,3);
    this.staticBox(6.9,3.7,3,-3.7,1.9,-6.25);this.staticBox(1.8,.50,.65,2.7,.25,-2.9);this.staticBox(1.7,.52,.5,-3.5,.26,-2.7);
    // Hand-driven kinematic arc before contact; fragments remain dynamic rigid bodies.
    // Kinetic energy uses measured edge velocity and the participating axe mass.
    this.grip=new CANNON.Body({mass:0,type:CANNON.Body.KINEMATIC,collisionFilterGroup:0,collisionFilterMask:0});
    this.axe=new CANNON.Body({mass:0,type:CANNON.Body.KINEMATIC,collisionFilterGroup:0,collisionFilterMask:0});
    this.axe.addShape(new CANNON.Box(new CANNON.Vec3(.025,.455,.025)),new CANNON.Vec3(0,-.195,0));
    this.axe.addShape(new CANNON.Box(new CANNON.Vec3(.043,.089,.175)),new CANNON.Vec3(0,.20,.025));
    this.world.addBody(this.axe);this.axeMesh=createAxeMesh(scene,wood);
    this.settings={log:{name:'Pine',mass:3,threshold:42,grain:0,knot:false},weather:{resistance:1,friction:.74,wind:0},sharpness:1,axeMass:2.4,aim:{x:0,z:0},yaw:0,timing:1};
    this.debugGroup=new THREE.Group();this.debugGroup.visible=false;scene.add(this.debugGroup);this.debugEntries=[];
    this.debugMaterial=new THREE.MeshBasicMaterial({color:0x2d574e,wireframe:true,transparent:true,opacity:.65,depthTest:false});
    this.chipMaterials=[wood.grain,wood.end,standard(0xe1c48e)];
    this.inclusionMaterials={stone:standard(0x777d79,{roughness:.96,flatShading:true}),steel:standard(0x9b9d98,{metalness:.9,roughness:.3})};
    this.wedgeMesh=mesh(new THREE.CylinderGeometry(.033,.006,.12,3),standard(0x687880,{metalness:.8,roughness:.32}),scene);this.wedgeMesh.visible=false;
    this.dynamic=[];this.chips=[];this.chipPoolLimit=56;this.time=0;this.accumulator=0;this.reset();
  }
  staticBox(w,h,d,x,y,z){const b=new CANNON.Body({mass:0,material:this.groundMaterial,shape:new CANNON.Box(new CANNON.Vec3(w/2,h/2,d/2)),position:new CANNON.Vec3(x,y,z)});this.world.addBody(b);}
  configure(settings){this.settings={...this.settings,...settings};for(const cm of this.world.contactmaterials){if(cm.materials.includes(this.groundMaterial)&&cm.materials.includes(this.woodMaterial))cm.friction=this.settings.weather.friction;}}
  reset(){
    this.clearMineralSeams();this.wedgeAim=null;
    for(const p of this.inclusionMeshes??[]){p.mesh.removeFromParent();p.mesh.geometry.dispose();}this.inclusionMeshes=[];
    for(const item of [...this.dynamic,...this.chips,...(this.shell??[]).filter(p=>!p.released)]){this.world.removeBody(item.body);this.scene.remove(item.mesh);item.mesh.geometry.dispose();}
    if(this.logBody)this.world.removeBody(this.logBody);if(this.logMesh){this.scene.remove(this.logMesh);this.logMesh.geometry.dispose();}
    this.clearCrackVisual();this.cracks=[];this.wedgeMesh.visible=false;this.seatedWedge=null;this.response={storedEnergy:0,recoil:0,seatDepth:0};this.wind=windLoad(0,0);this.fractureYaw=null;this.strikeTool='axe';
    this.dynamic=[];this.chips=[];this.shell=[];this.split=false;this.running=false;this.impactHandled=false;this.sectionBroken=false;this.elapsed=0;this.time=0;this.accumulator=0;this.impactEnergy=0;this.impactSpeed=0;this.peakSpeed=0;this.effort=0;this.stage='ready';this.force=1;this.preSpeed=0;this.preVelocity=new CANNON.Vec3();this.penetration=0;this.damage=0;this.contactSource=null;
    // Supported log stays seated until fracture. It cannot dodge a between-step hit.
    this.radius=this.settings.log.radius??LOG_RADIUS;
    this.logBody=new CANNON.Body({mass:0,material:this.woodMaterial,shape:new CANNON.Cylinder(this.radius,this.radius,LOG_HEIGHT,32),position:new CANNON.Vec3(0,BLOCK_TOP+LOG_HEIGHT/2+.003,0)});this.world.addBody(this.logBody);
    this.logMesh=cylinder(this.scene,this.radius,this.radius,LOG_HEIGHT,[this.wood.bark,this.wood.end,this.wood.end],0,this.logBody.position.y,0,32);
    this.wood.end.color.setHex(this.settings.log.color??0xffffff);
    if(this.settings.log.burl||this.settings.log.hollow||this.settings.log.forked||this.settings.log.rotten||this.settings.log.mineral){this.world.removeBody(this.logBody);this.scene.remove(this.logMesh);this.logMesh.geometry.dispose();this.logBody=this.logMesh=null;if(this.settings.log.forked)this.buildFork();else this.buildShell();}
    for(const p of inclusions(this.settings.log)){
      const geometry=p.kind==='stone'?new THREE.IcosahedronGeometry(p.radius,1):new THREE.TorusGeometry(.025,.007,6,12,Math.PI);
      const marker=mesh(geometry,this.inclusionMaterials[p.kind],this.scene,[p.x,LOG_TOP+.003,p.z]);
      if(p.kind==='stone'){marker.scale.y=.36;marker.rotation.y=p.x*31+p.z*19;}else marker.rotation.y=Math.PI/2;
      this.inclusionMeshes.push({...p,mesh:marker});
    }
    this.setPose(1.03,0,1.19,-.66,0);this.axe.velocity.setZero();this.axe.angularVelocity.setZero();
    this.syncMeshes();this.drawMineralSeams();this.rebuildDebug();
  }
  swing(force=100,settings={}){
    if(this.running)return false;
    if(settings.tool==='wedge'&&!this.wedgeReady)return false;
    this.configure(settings);if(this.split)this.reset();this.strikeTool=settings.tool??'axe';
    this.force=clamp(Number(force)||100,30,150)/100;this.running=true;this.impactHandled=false;this.sectionBroken=false;this.elapsed=0;this.impactEnergy=0;this.impactSpeed=0;this.peakSpeed=0;this.stage='windup';this.contactSource=null;this.swingSoundPlayed=false;
    this.setPose(1.03,0,1.19,-.66,0);this.preSpeed=0;this.duration=.39/Math.sqrt(this.force);this.strikeAim={...this.settings.aim};
    this.strikeAim.x+=Math.sin(.8+this.time*2.7)*this.settings.weather.wind;
    this.strikeYaw=this.settings.yaw;
    if(this.strikeTool==='wedge'){const c=this.wedgeCrack;this.strikeAim={x:c.x,z:c.z};this.strikeYaw=c.yaw;this.wedgeMesh.position.set(c.x,LOG_TOP+.018,c.z);this.wedgeMesh.rotation.y=c.yaw;this.wedgeMesh.visible=true;}
    else if(!this.seatedWedge)this.wedgeMesh.visible=false;
    this.strikeHeight=this.surfaceAt(this.strikeAim.x,this.strikeAim.z)?.top??LOG_TOP;
    if(this.strikeTool==='wedge')this.wedgeMesh.position.y=this.strikeHeight+.055-(this.seatedWedge?.depth??.004);
    this.response={storedEnergy:0,recoil:0,seatDepth:0};
    return true;
  }
  get bestCrack(){return this.cracks.filter(c=>!(this.settings.log.burl||this.settings.log.hollow||this.settings.log.forked||this.settings.log.rotten||this.settings.log.mineral)||!this.shell[c.sector]?.released).reduce((a,b)=>!a||b.damage>a.damage?b:a,null);}
  get wedgeCrack(){return selectWedgeCrack(this.cracks,this.materialLog,this.wedgeAim??this.settings.aim,this.seatedWedge);}
  get wedgeReady(){return !this.running&&!this.split&&!!this.wedgeCrack;}
  get extractionCost(){return wedgeExtractionCost(this.seatedWedge,this.settings.weather.friction);}
  extractWedge(){if(this.running||!this.seatedWedge)return false;this.seatedWedge=null;this.wedgeMesh.visible=false;return true;}
  setPose(angle,x,y,z,yaw){
    const q=new CANNON.Quaternion();q.setFromEuler(angle,0,0);
    const turn=new CANNON.Quaternion();turn.setFromEuler(0,yaw,0);turn.mult(q,this.axe.quaternion);
    const offset=this.axe.quaternion.vmult(GRIP_LOCAL);this.axe.position.set(x-offset.x,y-offset.y,z-offset.z);
    this.poseAngle=angle;this.axe.aabbNeedsUpdate=true;
  }
  motor(dt){
    const before=this.axe.pointToWorldFrame(HEAD_LOCAL);let angle=1.03,x=0,y=1.19,z=-.66,yaw=0;
    if(this.running){
      this.elapsed+=dt;const pose=swingPose(this.elapsed,this.force*100,this.strikeAim,this.strikeYaw,this.strikeHeight);
      ({angle,x,y,z,yaw}=pose);this.effort=pose.effort;this.stage=pose.stage;
      if(this.impactHandled){this.stage='follow-through';if(!this.split&&!this.sectionBroken){const t=this.elapsed-this.contactTime,recoil=(this.settings.recoil===false?0:this.response.recoil)*Math.exp(-t*9)*Math.sin(t*28);angle=this.poseAngle+clamp((this.stopAngle??angle)-recoil-this.poseAngle,-8*dt,8*dt);}}
      if(pose.finished){this.running=false;this.stage='settled';if(!this.impactHandled){this.impactHandled=true;this.contactSource='miss';this.onImpact?.({energy:0,speed:0,split:false,accuracy:0,alignment:0,penetration:0,damage:this.damage,hazard:false,tool:this.strikeTool,x:this.strikeAim.x,z:this.strikeAim.z,source:'miss'});}}
    }else if(this.stage==='settled'){return;}
    this.setPose(angle,x,y,z,yaw);
    const after=this.axe.pointToWorldFrame(HEAD_LOCAL);after.vsub(before,this.preVelocity);this.preVelocity.scale(1/dt,this.preVelocity);this.preSpeed=this.preVelocity.length();
    if(this.running)this.peakSpeed=Math.max(this.peakSpeed,this.preSpeed);
    if(this.running&&this.stage==='downswing'&&!this.swingSoundPlayed&&this.preSpeed>2+this.force){this.swingSoundPlayed=true;this.onSoundEvent?.('swing',{power:this.force*100,speed:this.preSpeed});}
    // Continuous edge sweep against the supported log's upper face. The width
    // expands the circular target by the blade's 3.5 cm half-width.
    if(this.running&&!this.impactHandled&&this.stage==='downswing'){
      const surfaces=this.settings.log.forked?this.shell.filter(p=>!p.released).sort((a,b)=>b.top-a.top):[{top:LOG_TOP}];
      for(const surface of surfaces){
        const contact=sweptEdge(before,after,this.settings.log.forked?this.radius*1.3:this.radius,surface.top);
        const target=contact&&this.surfaceAt(contact.x,contact.z);
        if(contact&&target&&(!this.settings.log.forked||target.index===surface.index)){this.impact({speed:this.preSpeed,velocity:this.preVelocity.clone(),...contact,top:surface.top,angle,source:'swept-edge'});break;}
      }
    }
  }
  update(delta){
    this.accumulator=Math.min(this.accumulator+Math.max(0,delta),.5);let steps=0;
    while(this.accumulator>=FIXED_DT&&steps<90){this.motor(FIXED_DT);this.applyWind();this.world.step(FIXED_DT);this.time+=FIXED_DT;this.accumulator-=FIXED_DT;steps++;}
    this.syncMeshes();if(this.debugGroup.visible)this.syncDebug();return this.snapshot();
  }
  impact(impact){
    if(this.impactHandled)return;this.impactHandled=true;this.contactSource=impact.source;
    const result=woodImpact({...this.settings,log:this.materialLog,...impact,yaw:this.strikeYaw,tool:this.strikeTool});
    const {energy,accuracy,alignment,knot,hazard,useful}=result;this.impactEnergy=energy;this.impactSpeed=impact.speed;
    const section=this.settings.log.forked?this.surfaceAt(impact.x,impact.z):null;
    const braced=section?.index===2&&this.shell.some(p=>p.index<2&&!p.released);
    if(braced){result.damage=0;result.penetration=0;}
    this.contactTime=this.elapsed;
    const cut=braced?null:advanceCracks(this.cracks,result,{x:impact.x,z:impact.z,yaw:this.strikeYaw},this.materialLog);
    this.damage=this.bestCrack?.damage??0;this.penetration=result.hazard?.002:cut?.depth??0;
    this.stopAngle=Math.acos(clamp(((impact.top??LOG_TOP)-this.penetration-(2+this.strikeHeight-LOG_TOP))/Math.hypot(.845,.235),-1,1))-Math.atan2(.235,.845);
    let panelBroken=false,coreCrumbled=false;
    if(this.settings.log.burl||this.settings.log.hollow||this.settings.log.forked||this.settings.log.rotten||this.settings.log.mineral){
      const panel=this.shell[cut?.sector];
      if(panel&&cut.damage>=1){
        const budget=Math.min(energy,energy*.20+useful*.25)*(panel.core?.12:1);
        if(panel.core){
          const core=this.shell.filter(p=>p.core&&!p.released),mass=core.reduce((sum,p)=>sum+p.massFraction,0);
          for(const p of core)this.releasePanel(p,budget*p.massFraction/mass,impact.velocity);
          coreCrumbled=true;
        }else this.releasePanel(panel,budget,impact.velocity);
        panelBroken=true;
      }
      this.damage=this.shell.reduce((sum,p)=>sum+(p.released?1:Math.max(0,...this.cracks.filter(c=>c.sector===(p.core?(this.settings.log.boss?6:4):p.index)).map(c=>c.damage))),0)/this.shell.length;
      this.split=this.shell.every(p=>p.released);this.emitChips(energy,panelBroken?10:5,!!result.core);this.drawCrack();this.drawMineralSeams();this.rebuildDebug();
    }else if(this.damage>=1){this.fractureYaw=cut?.yaw??this.settings.log.grain;this.fractureAnchor=cut?{x:cut.x,z:cut.z}:{x:0,z:0};this.fracture(Math.min(energy,energy*.20+useful*.25),impact.velocity);this.stage='follow-through';}
    else {this.emitChips(energy,result.hazard?2:8);this.drawCrack();this.rebuildDebug();}
    this.sectionBroken=panelBroken;
    this.response=impactResponse({...result,penetration:this.penetration,split:this.split||panelBroken,friction:this.settings.weather.friction});
    if(this.strikeTool==='wedge'&&!this.split&&!panelBroken){this.seatedWedge={x:impact.x,z:impact.z,yaw:this.strikeYaw,depth:this.response.seatDepth,sector:cut?.sector};this.wedgeMesh.position.set(impact.x,(impact.top??LOG_TOP)+.055-this.response.seatDepth,impact.z);this.wedgeMesh.rotation.y=this.strikeYaw;this.wedgeMesh.visible=true;}
    if(this.split||panelBroken&&(this.strikeTool==='wedge'||this.seatedWedge?.sector===cut?.sector)){this.seatedWedge=null;this.wedgeMesh.visible=false;}
    this.onImpact?.({x:impact.x,z:impact.z,yaw:this.strikeYaw,power:this.force*100,confinement:result.confinement,hazardKind:result.hazardKind,edgeWear:result.edgeWear,braced,section:cut?.sector??section?.index,storedEnergy:this.response.storedEnergy,recoil:this.response.recoil,energy,speed:impact.speed,split:this.split,accuracy,alignment,penetration:this.penetration,damage:this.damage,hazard,knot,panelBroken,coreCrumbled,remainingPanels:this.shell.filter(p=>!p.released).length,tool:this.strikeTool,source:impact.source});
  }
  clearCrackVisual(){if(this.crack){this.crack.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});this.crack.removeFromParent();this.crack=null;}}
  clearMineralSeams(){if(this.mineralSeams){this.mineralSeams.geometry.dispose();this.mineralSeams.material.dispose();this.mineralSeams.removeFromParent();this.mineralSeams=null;}}
  drawMineralSeams(){
    this.clearMineralSeams();if(!(this.settings.log.mineral||this.settings.log.burl))return;
    const points=[];
    for(const panel of this.shell.filter(p=>!p.released))for(let i=0;i<panel.polygon.length;i++){
      const a=panel.polygon[i],b=panel.polygon[(i+1)%panel.polygon.length];
      if(this.isBarkEdge(a,b))continue;
      points.push(a[0],LOG_TOP+.0015,a[1],b[0],LOG_TOP+.0015,b[1]);
    }
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(points,3));
    this.mineralSeams=new THREE.LineSegments(geometry,new THREE.LineBasicMaterial({color:0x5b422e,transparent:true,opacity:.48}));this.scene.add(this.mineralSeams);
  }
  drawCrack(){
    this.clearCrackVisual();this.crack=new THREE.Group();this.scene.add(this.crack);
    for(const c of this.cracks){const points=[],length=this.radius*(.25+.75*c.damage),width=.0015+c.damage*.007;
      for(let i=0;i<=24;i++){const t=(i/24*2-1)*length,p=crackPoint(c,t,this.settings.log);if((!this.settings.log.forked&&Math.hypot(p.x,p.z)>=this.radius-.004)||(this.settings.log.burl||this.settings.log.hollow||this.settings.log.forked||this.settings.log.rotten||this.settings.log.mineral)&&(this.cutSectorAt(p.x,p.z)!==c.sector||this.shell[c.sector]?.released))continue;const jitter=Math.sin(i*7.3)*.002;points.push([p.x+jitter,p.z]);}
      const vertices=[];for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i];for(const [p,side] of [[a,-1],[a,1],[b,1],[a,-1],[b,1],[b,-1]])vertices.push(p[0]+Math.cos(c.yaw)*width*side,(this.shell[c.sector]?.top??LOG_TOP)+.003,p[1]-Math.sin(c.yaw)*width*side);}
      const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geo.computeVertexNormals();mesh(geo,new THREE.MeshBasicMaterial({color:0x291d15,side:THREE.DoubleSide}),this.crack);
    }
  }
  goodAim(){
    if(this.settings.log.mineral||this.settings.log.burl)return safeSolidAim(this.materialLog);
    if(!(this.settings.log.burl||this.settings.log.hollow||this.settings.log.forked||this.settings.log.rotten||this.settings.log.mineral))return safeSolidAim(this.settings.log);
    const core=this.settings.log.rotten&&this.shell.find(p=>p.core&&!p.released);
    if(core)return {x:0,z:0,yaw:this.settings.log.grain};
    const panel=this.shell.find(p=>!p.released);
    const x=panel?.cx??0,z=panel?.cz??0;return {x,z,yaw:panel?.yaw??grainAt(this.settings.log,x,z)};
  }
  get materialLog(){return this.settings.log.burl||this.settings.log.hollow||this.settings.log.forked||this.settings.log.rotten||this.settings.log.mineral?{...this.settings.log,removedSections:this.shell.filter(p=>p.released).map(p=>p.index)}:this.settings.log;}
  cutSectorAt(x,z){const surface=this.surfaceAt(x,z);return surface?.core?(this.settings.log.boss?6:4):surface?.index;}
  surfaceAt(x,z){
    if(this.settings.log.forked){return this.shell.find(p=>!p.released&&p.polygon.every((a,i)=>{const b=p.polygon[(i+1)%p.polygon.length];return (b[0]-a[0])*(z-a[1])-(b[1]-a[1])*(x-a[0])>=-1e-8;}))??null;}
    if(this.settings.log.burl||this.settings.log.rotten||this.settings.log.mineral)return this.shell.find(p=>!p.released&&p.polygons.some(polygon=>polygon.every((a,i)=>{const b=polygon[(i+1)%polygon.length];return (b[0]-a[0])*(z-a[1])-(b[1]-a[1])*(x-a[0])>=-1e-8;})))??null;
    if(this.settings.log.hollow){const index=hollowSectorAt(this.settings.log,x,z);return this.shell[index]&&!this.shell[index].released?{...this.shell[index],top:LOG_TOP}:null;}
    return Math.hypot(x,z)<=this.radius+.035?{top:LOG_TOP}:null;
  }
  buildFork(){
    for(const section of forkSections(this.settings.log)){
      const {cz,polygon,bottomPolygon,top,bottom}=section,cx=section.bodyCx,n=polygon.length,cy=section.bodyCy;
      const verts=[...bottomPolygon.map(([x,z])=>new CANNON.Vec3(x-cx,bottom-cy,z-cz)),...polygon.map(([x,z])=>new CANNON.Vec3(x-cx,top-cy,z-cz))];
      const faces=[Array.from({length:n},(_,j)=>j),Array.from({length:n},(_,j)=>n*2-1-j)];
      for(let j=0;j<n;j++){const k=(j+1)%n;faces.push([j,j+n,k+n,k]);}
      const shape=new CANNON.ConvexPolyhedron({vertices:verts,faces});
      const body=new CANNON.Body({mass:0,material:this.woodMaterial,shape,position:new CANNON.Vec3(cx,cy,cz),linearDamping:.12,angularDamping:.2,sleepTimeLimit:1.6});
      const geometry=this.fragmentGeometry(verts,faces,n,polygon,cx,cz);
      const uv=geometry.attributes.uv,position=geometry.attributes.position;
      geometry.clearGroups();geometry.addGroup(0,2*(n-2)*3,0);geometry.addGroup(2*(n-2)*3,n*6,1);
      for(let i=0;i<2*(n-2)*3;i++)uv.setXY(i,(position.getX(i)+cx-section.cx)/(section.rx*2)+.5,(position.getZ(i)+cz)/(section.rz*2)+.5);
      const piece=mesh(geometry,[this.wood.end,this.wood.bark,this.wood.grain],this.scene);piece.position.copy(body.position);
      this.world.addBody(body);this.shell.push({...section,start:section.index===0?Math.PI:0,end:section.index===0?Math.PI:0,body,mesh:piece,windArea:Math.sqrt(section.volume/(top-bottom))*(top-bottom),released:false});
    }
  }
  buildShell(){
    for(const section of (this.settings.log.burl?burlSections(this.settings.log):this.settings.log.mineral?mineralSections(this.settings.log):this.settings.log.rotten?rottenSections(this.settings.log):hollowSections(this.radius,this.settings.log.boss?6:4,this.settings.log.grain))){
      const {cx,cz,polygons}=section,body=new CANNON.Body({mass:0,material:this.woodMaterial,position:new CANNON.Vec3(cx,BLOCK_TOP+LOG_HEIGHT/2+.003,cz),linearDamping:.12,angularDamping:.2,sleepTimeLimit:1.6});
      const geometries=[];
      for(const polygon of polygons){
        const n=polygon.length,verts=[];for(const y of [-LOG_HEIGHT/2,LOG_HEIGHT/2])for(const [x,z]of polygon)verts.push(new CANNON.Vec3(x-cx,y,z-cz));
        const faces=[Array.from({length:n},(_,j)=>j),Array.from({length:n},(_,j)=>n*2-1-j)];
        for(let j=0;j<n;j++){const k=(j+1)%n;faces.push([j,j+n,k+n,k]);}
        body.addShape(new CANNON.ConvexPolyhedron({vertices:verts,faces}));
        geometries.push(this.fragmentGeometry(verts,faces,n,polygon,cx,cz));
      }
      // Keep the three PBR materials to three draw calls per wall, even
      // though its physical shell contains three separate convex prisms.
      const geometry=mergeGeometries(geometries,false),groups=[];let offset=0;
      for(const g of geometries){for(const group of g.groups)groups.push({...group,start:offset+group.start});offset+=g.attributes.position.count;g.dispose();}
      const indices=[];geometry.clearGroups();
      for(let material=0;material<3;material++){
        const start=indices.length;
        for(const group of groups.filter(g=>g.materialIndex===material))for(let i=group.start;i<group.start+group.count;i++)indices.push(i);
        geometry.addGroup(start,indices.length-start,material);
      }
      geometry.setIndex(indices);
      if(section.core){geometry.clearGroups();geometry.addGroup(0,indices.length,0);}
      const piece=mesh(geometry,section.core?[this.wood.rot]:[this.wood.end,this.wood.bark,this.wood.grain],this.scene);piece.position.copy(body.position);
      this.world.addBody(body);this.shell.push({...section,body,mesh:piece,windArea:Math.sqrt(section.area)*LOG_HEIGHT,released:false});
    }
  }
  releasePanel(panel,energy,incoming){
    panel.released=true;panel.body.mass=this.settings.log.mass*panel.massFraction;panel.body.type=CANNON.Body.DYNAMIC;panel.body.updateMassProperties();panel.body.wakeUp();
    const angle=(panel.start+panel.end)/2,speed=Math.sqrt(2*energy*.10/panel.body.mass);
    panel.body.position.x+=Math.cos(angle)*.008;panel.body.position.z+=Math.sin(angle)*.008;
    panel.body.velocity.set(Math.cos(angle)*speed,.4,Math.sin(angle)*speed+incoming.z*.025);
    panel.body.angularVelocity.set(Math.sin(angle)*1.6,.3,-Math.cos(angle)*1.6);panel.body.aabbNeedsUpdate=true;this.world.broadphase.dirty=true;this.dynamic.push(panel);this.listenFragment(panel.body);this.syncMeshes();
    panel.mesh.updateMatrixWorld(true);
    for(const p of this.inclusionMeshes.filter(p=>p.mesh.parent===this.scene)){
      const owner=this.settings.log.burl?burlSectorAt({...this.settings.log,removedSections:[]},p.x,p.z):this.settings.log.mineral?inclusions({...this.settings.log,removedSections:[]}).findIndex(seed=>seed.x===p.x&&seed.z===p.z):-1;
      if(panel.index===owner)panel.mesh.attach(p.mesh);
    }
  }
  fracture(energy,incoming){
    this.split=true;this.fragmentCount=this.settings.log.boss?6:4;this.wedgeMesh.visible=false;if(this.crack){this.crack.visible=false;}const pos=this.logBody.position.clone(),q=this.logBody.quaternion.clone(),velocity=this.logBody.velocity.clone();this.world.removeBody(this.logBody);this.scene.remove(this.logMesh);this.logMesh.geometry.dispose();this.logBody=null;this.logMesh=null;
    const rand=randomSource(2143+Math.round(this.force*100));
    // The completed kerf defines the primary plane; all secondary fractures
    // also run along the grain. Render and contact use the same convex hulls.
    const radialSpeed=Math.sqrt(2*energy*.12/this.settings.log.mass);
    const sections=kerfSections(this.radius,this.fragmentCount,this.fractureYaw??this.settings.log.grain,this.fractureAnchor);
    for(const {polygon,cx,cz,massFraction,start,end} of sections){
      const n=polygon.length,verts=[];for(const y of [-LOG_HEIGHT/2,LOG_HEIGHT/2])for(const [x,z]of polygon)verts.push(new CANNON.Vec3(x-cx,y,z-cz));
      const faces=[];faces.push(Array.from({length:n},(_,j)=>j));faces.push(Array.from({length:n},(_,j)=>n*2-1-j));for(let j=0;j<n;j++){const k=(j+1)%n;faces.push([j,j+n,k+n,k]);}
      const shape=new CANNON.ConvexPolyhedron({vertices:verts,faces});
      const localOffset=new CANNON.Vec3(cx,0,cz),worldOffset=q.vmult(localOffset);
      const body=new CANNON.Body({mass:this.settings.log.mass*massFraction,material:this.woodMaterial,shape,position:pos.vadd(worldOffset),quaternion:q.clone(),linearDamping:.12,angularDamping:.2,sleepTimeLimit:1.6});
      const angle=(start+end)/2,dir=new CANNON.Vec3(Math.cos(angle),0,Math.sin(angle));q.vmult(dir,dir);
      body.position.x+=dir.x*.007;body.position.z+=dir.z*.007;
      body.velocity.set(velocity.x*.10+dir.x*radialSpeed, .36+Math.min(.42,radialSpeed*.14),velocity.z*.10+dir.z*radialSpeed+incoming.z*.035);
      body.angularVelocity.set((rand()-.5)*2.8,(rand()-.5)*1.8,-dir.x*2.4);this.world.addBody(body);this.listenFragment(body);
      const geometry=this.fragmentGeometry(verts,faces,n,polygon,cx,cz);
      const piece=mesh(geometry,[this.wood.end,this.wood.bark,this.wood.grain],this.scene);this.dynamic.push({body,mesh:piece,windArea:Math.sqrt(massFraction*Math.PI*this.radius**2)*LOG_HEIGHT});
      piece.position.copy(body.position);piece.quaternion.copy(body.quaternion);piece.updateMatrixWorld(true);
      for(const p of this.inclusionMeshes.filter(p=>p.mesh.parent===this.scene)){
        if(polygon.every((a,i)=>{const b=polygon[(i+1)%polygon.length];return (b[0]-a[0])*(p.z-a[1])-(b[1]-a[1])*(p.x-a[0])>=-1e-8;}))piece.attach(p.mesh);
      }
    }
    this.syncMeshes();this.emitChips(energy,Math.min(this.chipLimit??28,14+Math.round(energy*.15)));this.rebuildDebug();
  }
  listenFragment(body){
    let last=-Infinity;
    body.addEventListener('collide',event=>{
      if(!this.onSoundEvent||this.time-last<.16)return;
      const speed=Math.abs(event.contact.getImpactVelocityAlongNormal());
      if(speed>.35){last=this.time;this.onSoundEvent('fragmentLand',{speed});}
      if(event.body.mass===0&&Math.hypot(body.velocity.x,body.velocity.z)>.25&&body.angularVelocity.length()>.5){last=this.time;this.onSoundEvent('fragmentRoll',{speed:body.velocity.length(),delay:.07});}
    });
  }
  isBarkEdge(a,b){
    const outline=this.settings.log.burl?burlOutline(this.settings.log):roundOutline(this.radius);
    return outline.some((p,i)=>{const q=outline[(i+1)%outline.length],dx=q[0]-p[0],dz=q[1]-p[1],length=Math.hypot(dx,dz);return [a,b].every(v=>Math.abs(dx*(v[1]-p[1])-dz*(v[0]-p[0]))<length*1e-7&&(v[0]-p[0])*dx+(v[1]-p[1])*dz>=-1e-9&&(v[0]-q[0])*dx+(v[1]-q[1])*dz<=1e-9);});
  }
  fragmentGeometry(verts,faces,n,polygon,cx,cz){
    const positions=[],uvs=[];const geometry=new THREE.BufferGeometry();
    for(let f=0;f<faces.length;f++){const face=faces[f];const begin=positions.length/3;
      for(let j=1;j<face.length-1;j++)for(const idx of [face[0],face[j],face[j+1]]){const v=verts[idx];positions.push(v.x,v.y,v.z);if(f<2)uvs.push((v.x+cx)/(this.radius*2)+.5,(v.z+cz)/(this.radius*2)+.5);else uvs.push((idx%n)/n,v.y/LOG_HEIGHT+.5);}
      geometry.addGroup(begin,positions.length/3-begin,f<2?0:this.settings.log.forked?1:(this.settings.log.hollow||this.settings.log.rotten)?(f===3?1:2):this.isBarkEdge(polygon[(f-2)%n],polygon[(f-1)%n])?1:2);
    }
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));geometry.computeVertexNormals();return geometry;
  }
  trimChips(reserve=0){
    while(this.chips.length+reserve>this.chipPoolLimit){const old=this.chips.shift();if(!old)break;this.world.removeBody(old.body);old.mesh.removeFromParent();old.mesh.geometry.dispose();}
  }
  emitChips(energy,count,rotten=false){
    count=Math.min(count,this.chipPoolLimit);this.trimChips(count);
    const rand=randomSource(771+Math.round(energy*10));const source=new THREE.Vector3(this.strikeAim?.x??0,(this.strikeHeight??LOG_TOP)-.025,this.strikeAim?.z??.02);const materials=rotten?[this.wood.rot]:this.chipMaterials;
    for(let i=0;i<count;i++){const a=rand()*Math.PI*2,s=rotten?.008+rand()*.014:.012+rand()*.019;const dims=[s*(.5+rand()),s*(1+rand()*3),s*.4];const body=new CANNON.Body({mass:rotten?.0006:.0018,material:this.woodMaterial,shape:new CANNON.Box(new CANNON.Vec3(...dims)),position:new CANNON.Vec3(source.x+(rand()-.5)*.15,source.y+rand()*.07,source.z+(rand()-.5)*.1),linearDamping:.23,angularDamping:.24,sleepTimeLimit:.8});
      const speed=(.8+rand())*Math.sqrt(energy/20)*(rotten?.5:1);body.velocity.set(Math.cos(a)*speed,1+rand()*1.6,Math.sin(a)*speed);body.angularVelocity.set(rand()*15,rand()*12,rand()*15);body.quaternion.setFromEuler(rand()*3,rand()*3,rand()*3);this.world.addBody(body);
      const chip=mesh(new THREE.BoxGeometry(...dims.map(d=>d*2)),materials[i%materials.length],this.scene);chip.position.copy(body.position);chip.quaternion.copy(body.quaternion);this.chips.push({body,mesh:chip,windArea:dims[0]*dims[1]*4});
    }
  }
  applyWind(){
    const wind=windLoad(this.time,this.settings.weather.wind??0);this.wind=wind;
    if(!wind.strength)return;
    for(const p of [...this.dynamic,...this.chips]){
      const area=p.windArea??.035,force=fragmentWind(area,p.body.mass,p.body.velocity,wind);
      if(p.body.sleepState===CANNON.Body.SLEEPING){
        if(Math.hypot(force.x,force.z)>p.body.mass*9.81*this.settings.weather.friction)p.body.wakeUp();else continue;
      }
      p.body.force.x+=force.x;p.body.force.z+=force.z;
    }
  }
  syncMeshes(){
    this.axeMesh.position.copy(this.axe.position);this.axeMesh.quaternion.copy(this.axe.quaternion);
    if(this.logMesh){this.logMesh.position.copy(this.logBody.position);this.logMesh.quaternion.copy(this.logBody.quaternion);}
    for(const {body,mesh:m}of [...this.dynamic,...this.chips]){m.position.copy(body.position);m.quaternion.copy(body.quaternion);}
  }
  handPositions(){
    const a=this.axe.pointToWorldFrame(new CANNON.Vec3(0,-.59,0)),b=this.axe.pointToWorldFrame(new CANNON.Vec3(0,-.36,0));
    return [new THREE.Vector3(a.x,a.y,a.z),new THREE.Vector3(b.x,b.y,b.z)];
  }
  headPosition(){const p=this.axe.pointToWorldFrame(HEAD_LOCAL);return new THREE.Vector3(p.x,p.y,p.z);}
  snapshot(){return {ready:true,running:this.running,stage:this.stage,split:this.split,energy:this.impactEnergy,impactSpeed:this.impactSpeed,speed:this.preSpeed,peakSpeed:this.peakSpeed,pieces:this.dynamic.length,expectedPieces:this.settings.log.burl||this.settings.log.mineral?3:this.settings.log.forked?3:(this.settings.log.boss?6:4)*(this.settings.log.rotten?2:1),chips:this.chips.length,chipBudget:this.chipPoolLimit,time:this.time,force:this.force??1,penetration:this.penetration,damage:this.damage,cracks:this.cracks.map(c=>({...c})),wedgeReady:this.wedgeReady,wedgeTarget:this.wedgeCrack?{...this.wedgeCrack}:null,extractionCost:this.extractionCost,tool:this.strikeTool??'axe',radius:this.radius,contactSource:this.contactSource,forked:!!this.settings.log.forked,mineral:!!this.settings.log.mineral,burl:!!this.settings.log.burl,confinement:this.settings.log.burl&&!this.shell[1]?.released?1+.65*this.shell.filter(p=>p.index!==1&&!p.released).length:1,phase:this.settings.log.burl?(this.split?'cleared':this.shell.some(p=>p.index!==1&&!p.released)?'peel':'knot-heart'):this.settings.log.mineral?(this.split?'cleared':'stone-bound'):this.settings.log.rotten?(this.split?'cleared':this.shell.some(p=>p.core&&!p.released)?'heart':'shell'):this.settings.log.forked?(this.split?'cleared':this.shell.some(p=>p.index<2&&!p.released)?'limbs':'crotch'):null,seatedWedge:this.seatedWedge?{...this.seatedWedge}:null,response:{...this.response},hollow:!!this.settings.log.hollow,rotten:!!this.settings.log.rotten,coreRemaining:this.shell.filter(p=>p.core&&!p.released).length,wind:{...this.wind},panels:this.shell.map(p=>({index:p.index,x:p.cx,z:p.cz,core:!!p.core,released:p.released,top:p.top??LOG_TOP})),remainingPanels:this.shell.filter(p=>!p.released).length,logVisible:!!this.logMesh?.parent||this.shell.some(p=>!p.released),fragmentMeshes:this.dynamic.filter(p=>p.mesh.parent===this.scene).length};}
  rebuildDebug(){
    for(const entry of this.debugEntries){this.debugGroup.remove(entry.mesh);entry.mesh.geometry.dispose();}this.debugEntries=[];
    for(const body of this.world.bodies){if(body===this.grip)continue;for(let s=0;s<body.shapes.length;s++){const shape=body.shapes[s];let geometry;
      if(shape instanceof CANNON.Plane)geometry=new THREE.PlaneGeometry(16,16,16,16);
      else if(shape instanceof CANNON.Box)geometry=new THREE.BoxGeometry(shape.halfExtents.x*2,shape.halfExtents.y*2,shape.halfExtents.z*2);
      else if(shape.vertices){const p=[];for(const f of shape.faces)for(let j=1;j<f.length-1;j++)for(const k of[f[0],f[j],f[j+1]])p.push(shape.vertices[k].x,shape.vertices[k].y,shape.vertices[k].z);geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(p,3));}
      if(!geometry)continue;const m=new THREE.Mesh(geometry,this.debugMaterial);m.renderOrder=10;this.debugGroup.add(m);this.debugEntries.push({body,index:s,mesh:m});
    }}this.syncDebug();
  }
  syncDebug(){for(const e of this.debugEntries){const offset=e.body.quaternion.vmult(e.body.shapeOffsets[e.index]);e.mesh.position.copy(e.body.position.vadd(offset));const q=e.body.quaternion.mult(e.body.shapeOrientations[e.index]);e.mesh.quaternion.copy(q);}}
  setDebug(show){this.debugGroup.visible=show;if(show)this.rebuildDebug();}
}

import * as THREE from 'three';
import { OBB } from 'three/addons/math/OBB.js';
import { TreeField } from './assets/trees_v2/runtime/trees.js';

// Game-specific integration stays outside the supplied asset runtime.
const UP=new THREE.Vector3(0,1,0);
const clamp=THREE.MathUtils.clamp;

function crownShader(material,fade,instanced){
  const compile=material.onBeforeCompile,key=material.customProgramCacheKey();
  material.onBeforeCompile=(shader,renderer)=>{
    compile.call(material,shader,renderer);
    shader.vertexShader=`${instanced?'attribute float yardCrownFade;':'uniform float yardCrownFade;'}\nvarying float vYardCrownFade;\n${shader.vertexShader}`;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvYardCrownFade=yardCrownFade;\nif(yardCrownFade<0.01) transformed=vec3(0.0);');
    shader.fragmentShader=`varying float vYardCrownFade;\n${shader.fragmentShader}`;
    // Opaque screen-door fading keeps depth writes and avoids transparent leaf sorting.
    shader.fragmentShader=shader.fragmentShader.replace('#include <alphatest_fragment>','#include <alphatest_fragment>\nif(vYardCrownFade<0.999 && fract(dot(floor(gl_FragCoord.xy),vec2(0.75487766,0.56984029)))>vYardCrownFade) discard;');
    if(!instanced)shader.uniforms.yardCrownFade=fade;
  };
  material.customProgramCacheKey=()=>`${key}_yard_crown_${instanced?'instance':'uniform'}`;
  material.needsUpdate=true;
}

// Segment/ellipsoid intersection; no raycasters, triangle tests or frame allocations.
function obscures(box,camera,focus){
  const cx=(box.min.x+box.max.x)*.5,cy=(box.min.y+box.max.y)*.5,cz=(box.min.z+box.max.z)*.5;
  const rx=(box.max.x-box.min.x)*.5+.28,ry=(box.max.y-box.min.y)*.5+.20,rz=(box.max.z-box.min.z)*.5+.28;
  const ax=(camera.x-cx)/rx,ay=(camera.y-cy)/ry,az=(camera.z-cz)/rz;
  const dx=(focus.x-camera.x)/rx,dy=(focus.y-camera.y)/ry,dz=(focus.z-camera.z)/rz;
  const u=clamp(-(ax*dx+ay*dy+az*dz)/(dx*dx+dy*dy+dz*dz||1),0,1);
  return (ax+dx*u)**2+(ay+dy*u)**2+(az+dz*u)**2<1;
}

function fallSections(variant){
  if(variant.yardFallSections)return variant.yardFallSections;
  const sections=[],point=new THREE.Vector3();
  for(const part of ['log','branches','leaves']){
    const g=variant.lod0[part];if(!g.boundingBox)g.computeBoundingBox();
    const minY=g.boundingBox.min.y,height=g.boundingBox.max.y-minY,step=Math.max(.15,height/24),bins=Array.from({length:Math.ceil(height/step)+1},()=>new THREE.Box3());
    const p=g.attributes.position,index=g.index;
    for(let i=0;i<index.count;i+=3){
      const vertices=[index.getX(i),index.getX(i+1),index.getX(i+2)].map(j=>[p.getX(j),p.getY(j),p.getZ(j)]);
      const lo=Math.max(0,Math.floor((Math.min(...vertices.map(v=>v[1]))-minY)/step)),hi=Math.min(bins.length-1,Math.floor((Math.max(...vertices.map(v=>v[1]))-minY)/step));
      for(let bin=lo;bin<=hi;bin++){
        const bottom=minY+bin*step,top=bottom+step,box=bins[bin];
        for(let j=0;j<3;j++){
          const a=vertices[j],b=vertices[(j+1)%3];if(a[1]>=bottom&&a[1]<=top)box.expandByPoint(point.fromArray(a));
          for(const plane of [bottom,top])if((a[1]<plane&&b[1]>plane)||(b[1]<plane&&a[1]>plane)){const t=(plane-a[1])/(b[1]-a[1]);box.expandByPoint(point.set(a[0]+(b[0]-a[0])*t,plane,a[2]+(b[2]-a[2])*t));}
        }
      }
    }
    sections.push(...bins.filter(box=>!box.isEmpty()));
  }
  variant.yardFallSections=sections;return sections;
}

export class YardTreeField extends TreeField {
  constructor(scene,library,options){
    super(scene,library,options);
    this.playerFocus=new THREE.Vector3();this.chopFocus=new THREE.Vector3();this.hasChopFocus=false;
    this.obstacles=[];
  }
  place(...args){
    const tree=super.place(...args);
    // The game promises exactly six landed cuts with every species and tool.
    tree.meta={...tree.meta,hitsToFell:6};tree.crownFade=1;
    const geometry=tree.V.lod0.leaves;if(!geometry.boundingBox)geometry.computeBoundingBox();
    tree.crownLocal=geometry.boundingBox.clone();
    tree.crownStanding=tree.crownLocal.clone().translate(new THREE.Vector3(0,tree.meta.chopHeight,0)).applyMatrix4(tree.matrix);
    tree.crownBox=new THREE.Box3();tree.crownUniform={value:1};
    return tree;
  }
  _buildPool(pool){
    super._buildPool(pool);
    pool.yardCounts={lod0:0,lod1:0,lod2:0};
    for(const [lod,meshes]of Object.entries(pool.meshes)){
      for(let i=0;i<meshes.length;i++){
        const mesh=meshes[i];mesh.frustumCulled=true;
        if(lod!=='lod2'&&i!==1)continue;
        // Clone only the material, preserving the original wind uniforms/hook.
        const source=mesh.material,material=source.clone();material.onBeforeCompile=source.onBeforeCompile;material.customProgramCacheKey=source.customProgramCacheKey;
        mesh.material=material;mesh.geometry.setAttribute('yardCrownFade',new THREE.InstancedBufferAttribute(new Float32Array(pool.trees.length).fill(1),1));
        crownShader(material,null,true);
      }
    }
  }
  activate(tree){
    const existed=!!tree.obj,object=super.activate(tree);
    if(!existed)for(const mesh of [object.leaves,object.branches])crownShader(mesh.material,tree.crownUniform,false);
    return object;
  }
  update(camera,dt){
    // The asset fall integrator caps each slice at 1/30 s. Preserve elapsed time.
    const rebucket=this._dirty||camera.position.distanceToSquared(this._lastCam)>=1;
    for(let remaining=Math.max(dt,.000001);remaining>0;remaining-=1/60)super.update(camera,Math.min(remaining,1/60));
    for(const tree of this.trees){
      if(tree.state==='gone')continue;
      let box=tree.crownStanding;
      if(tree.obj){tree.obj.leaves.updateWorldMatrix(true,false);box=tree.crownBox.copy(tree.crownLocal).applyMatrix4(tree.obj.leaves.matrixWorld);}
      const hidden=obscures(box,camera.position,this.playerFocus)||(this.hasChopFocus&&obscures(box,camera.position,this.chopFocus));
      const target=hidden?0:1,rate=hidden?22:6;
      tree.crownFade=THREE.MathUtils.damp(tree.crownFade,target,rate,dt);
      if(Math.abs(tree.crownFade-target)<.005)tree.crownFade=target;
      tree.crownUniform.value=tree.crownFade;
    }
    const d1=this.lod1D**2,d2=this.lod2D**2;
    for(const pool of this.pools.values()){
      const counts=pool.yardCounts;counts.lod0=counts.lod1=counts.lod2=0;
      for(const tree of pool.trees){
        if(tree.state!=='standing')continue;
        const d=tree.position.distanceToSquared(this._lastCam),lod=d<d1?'lod0':d<d2||!pool.meshes.lod2.length?'lod1':'lod2';
        const mesh=pool.meshes[lod][lod==='lod2'?0:1],attribute=mesh.geometry.getAttribute('yardCrownFade');
        const index=counts[lod]++;if(attribute.getX(index)!==tree.crownFade){attribute.setX(index,tree.crownFade);attribute.needsUpdate=true;}
      }
      if(rebucket)for(const meshes of Object.values(pool.meshes))for(const mesh of meshes)if(mesh.count)mesh.computeBoundingSphere();
    }
  }
  fell(tree,preferred){
    const plan=this.planFall(tree,preferred);
    super.fell(tree,plan.direction);
    tree.fallDirection=plan.direction;tree.fallClearance=plan.angle;
    tree.anim.rest=Math.min(tree.anim.rest,plan.angle);tree.anim.twist=0;
    return tree;
  }
  stats(){
    const counts={standing:0,chopping:0,falling:0,felled:0};
    for(const tree of this.trees){const state=tree.state==='fallen'||tree.state==='stump'?'felled':tree.state;if(state in counts)counts[state]++;}
    return counts;
  }
  planFall(tree,preferred){
    const meta=tree.meta,root=tree.matrix,boxes=fallSections(tree.V);
    const rest=Math.PI/2-Math.min(.25,Math.atan2(meta.crownRadius*.25,meta.height*.6));
    const local=new THREE.Vector3(),axis=new THREE.Vector3(),rotation=new THREE.Quaternion(),matrix=new THREE.Matrix4(),rotationMatrix=new THREE.Matrix4(),hinge=new THREE.Matrix4(),offset=new THREE.Matrix4(),worldBox=new THREE.Box3(),center=new THREE.Vector3(),oriented=new OBB();
    const obstacles=this.obstacles.filter(b=>this.sharedWorld||!b.object||b.object.visible).map(b=>new THREE.Box3(new THREE.Vector3(b.minX-.12,b.minY,b.minZ-.12),new THREE.Vector3(b.maxX+.12,b.maxY+.12,b.maxZ+.12))),direction=new THREE.Vector3();
    const clear=angle=>{
      rotation.setFromAxisAngle(axis,angle);
      matrix.copy(root).multiply(hinge).multiply(rotationMatrix.makeRotationFromQuaternion(rotation)).multiply(offset);
      for(const box of boxes){worldBox.copy(box).applyMatrix4(matrix);let ready=false;for(const obstacle of obstacles)if(worldBox.intersectsBox(obstacle)){if(!ready){box.getCenter(center).applyMatrix4(matrix);oriented.fromBox3(box).applyMatrix4(matrix);oriented.center.copy(center);ready=true;}if(oriented.intersectsBox3(obstacle))return false;}}
      return true;
    };
    let best={direction:preferred.clone(),angle:.08,score:-Infinity};
    const inward=Math.atan2(-tree.position.x,-tree.position.z),preferredAngle=Math.atan2(preferred.x,preferred.z);
    for(let i=0;i<48;i++){
      const yaw=i===0?preferredAngle:i===1?inward:inward+(i-2)*Math.PI*2/46;
      direction.set(Math.sin(yaw),0,Math.cos(yaw));local.copy(direction).applyAxisAngle(UP,-tree.rotY);axis.crossVectors(UP,local).normalize();
      hinge.makeTranslation(local.x*meta.trunkRadius,meta.chopHeight,local.z*meta.trunkRadius);offset.makeTranslation(-local.x*meta.trunkRadius,0,-local.z*meta.trunkRadius);
      let angle=rest,previous=.02;
      for(let step=1;step<=24;step++){
        const sample=rest*step/24;
        if(!clear(sample)){let lo=previous,hi=sample;for(let j=0;j<8;j++){const mid=(lo+hi)*.5;if(clear(mid))lo=mid;else hi=mid;}angle=Math.max(.04,lo-.025);break;}
        previous=sample;
      }
      // Full falls win; steer toward a clear interior lane, away from the player.
      const score=angle*20+direction.dot(preferred)*.35+Math.cos(yaw-inward)*.15;
      if(score>best.score)best={direction:direction.clone(),angle,score};
    }
    return best;
  }
}

import * as THREE from 'three';
import { box, cylinder, mesh, standard, randomSource } from './environment.js';
import { WEATHER } from './game.js';
import { windLoad } from './mechanics.js';
export class Atmosphere {
  constructor(scene,sun,ambient,wood){
    this.scene=scene;this.sun=sun;this.ambient=ambient;this.wood=wood;this.weather='sun';this.hour=16.5;this.cycle=true;this.count=400;this.rand=randomSource(4391);
    this.positions=new Float32Array(650*3);for(let i=0;i<650;i++){this.positions[i*3]=(this.rand()-.5)*16;this.positions[i*3+1]=this.rand()*8;this.positions[i*3+2]=(this.rand()-.5)*14;}
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.BufferAttribute(this.positions,3));
    this.precipitation=new THREE.Points(geo,new THREE.PointsMaterial({color:0xd5e6ef,size:.032,transparent:true,opacity:.7,depthWrite:false}));this.precipitation.frustumCulled=false;scene.add(this.precipitation);
    this.puddles=new THREE.Group();scene.add(this.puddles);
    for(const [x,z,s]of [[1.5,1.4,.7],[-1.7,-.3,.55],[2.6,-1.4,.9]]){const p=mesh(new THREE.CircleGeometry(s,40),standard(0x788b82,{roughness:.08,metalness:.42,transparent:true,opacity:.65}),this.puddles,[x,.021,z]);p.rotation.x=-Math.PI/2;p.scale.y=.5;p.castShadow=false;}
    this.snow=mesh(new THREE.PlaneGeometry(50,50),standard(0xe6eee4,{transparent:true,opacity:.8,roughness:.96}),scene,[0,.009,0]);this.snow.rotation.x=-Math.PI/2;this.snow.castShadow=false;
    this.lamps=[];this.lampGroups=[];const iron=standard(0x3c453b,{metalness:.65,roughness:.4});
    for(const [x,z]of [[-2.2,-2.45],[2.5,-2.65]]){
      const lamp=new THREE.Group();lamp.position.set(x,0,z);scene.add(lamp);this.lampGroups.push(lamp);cylinder(lamp,.022,.04,1.3,iron,0,.65,0,8);box(lamp,.19,.035,.19,iron,0,1.27,0);box(lamp,.19,.035,.19,iron,0,1.52,0);
      const glow=standard(0xffc378,{emissive:0xff9d38,emissiveIntensity:2,roughness:.3});box(lamp,.11,.2,.11,glow,0,1.4,0);
      for(const dx of [-.08,.08])for(const dz of [-.08,.08])box(lamp,.015,.25,.015,iron,dx,1.4,dz);
      const light=new THREE.PointLight(0xffb561,0,6,2);light.position.set(x,1.45,z);scene.add(light);this.lamps.push({light,glow});
    }
    this.rays=new THREE.Group();scene.add(this.rays);
    const rayMat=new THREE.MeshBasicMaterial({color:0xffe3a2,transparent:true,opacity:.024,depthWrite:false,side:THREE.DoubleSide,blending:THREE.AdditiveBlending});
    for(let i=0;i<5;i++){const ray=mesh(new THREE.ConeGeometry(.6+i*.08,7,16,1,true),rayMat,this.rays,[-3+i*1.7,3,-2.5]);ray.rotation.z=-.5;ray.castShadow=false;ray.receiveShadow=false;}
    this.sparksGeometry=new THREE.BufferGeometry();this.sparkPositions=new Float32Array(40*3);this.sparksGeometry.setAttribute('position',new THREE.BufferAttribute(this.sparkPositions,3));this.sparks=new THREE.Points(this.sparksGeometry,new THREE.PointsMaterial({color:0xffad35,size:.04,depthWrite:false,transparent:true,blending:THREE.AdditiveBlending}));this.sparks.visible=false;scene.add(this.sparks);this.sparkLife=0;this.sparkVel=[];
    // A small cloth ribbon makes the same force used on fragments readable.
    const ribbonPole=standard(0x625744,{roughness:.75});
    cylinder(scene,.012,.018,1.25,ribbonPole,.92,.625,-.42,6);
    this.ribbon=mesh(new THREE.PlaneGeometry(.46,.075,12,1),standard(0xb8673e,{side:THREE.DoubleSide,roughness:.95}),scene,[1.15,1.23,-.42]);
    this.ribbon.castShadow=false;this.ribbonRest=this.ribbon.geometry.attributes.position.array.slice();
    this.setWeather('sun');
  }
  setWeather(value){if(!WEATHER[value])return;this.weather=value;this.precipitation.visible=value==='rain'||value==='snow';this.precipitation.material.size=value==='snow'?.045:.023;this.puddles.visible=value==='rain';this.snow.visible=value==='snow';}
  spark(x,z){this.sparkLife=.65;this.sparks.visible=true;this.sparkVel=[];for(let i=0;i<40;i++){this.sparkPositions.set([x,1.35,z],i*3);this.sparkVel.push(new THREE.Vector3((this.rand()-.5)*3,1+this.rand()*2,(this.rand()-.5)*3));}}
  update(dt,quality,windTime=0,focus){
    if(focus)this.precipitation.position.set(focus.x,0,focus.z);
    const wind=windLoad(windTime,WEATHER[this.weather].wind);
    const vertices=this.ribbon.geometry.attributes.position;
    for(let i=0;i<vertices.count;i++){
      const x=this.ribbonRest[i*3],u=(x+.23)/.46;
      vertices.setXYZ(i,-.23+u*(.07+.39*wind.strength),this.ribbonRest[i*3+1]-(1-wind.strength)*u*.28,Math.sin(windTime*8-u*8)*u*.035*wind.strength);
    }
    vertices.needsUpdate=true;this.ribbon.geometry.computeVertexNormals();
    if(this.cycle)this.hour=(this.hour+dt*.018)%24;
    const elevation=Math.sin((this.hour-6)/12*Math.PI),day=THREE.MathUtils.smoothstep(elevation,-.15,.35),gold=Math.max(0,1-Math.abs(elevation-.18)*4)*day;
    const sky=new THREE.Color(0x16212e).lerp(new THREE.Color(this.weather==='fog'?0xa8b9b0:0xcddfdc),day);if(gold>0)sky.lerp(new THREE.Color(0xebc5a0),gold*.45);
    this.scene.environmentIntensity=.09+day*.3;this.scene.background.copy(sky);this.scene.fog.color.copy(sky);this.scene.fog.near=this.weather==='fog'?3:this.weather==='rain'?8:18;this.scene.fog.far=this.weather==='fog'?18:this.weather==='snow'?30:48;
    this.sun.position.set(Math.cos((this.hour-6)/12*Math.PI)*8,Math.max(.15,elevation*10),4);this.sun.intensity=(.08+day*3.1)*(this.weather==='rain'?.5:1);this.sun.color.setHex(gold>.25?0xffbf7c:0xffe6bd);this.ambient.intensity=.35+day*1.7;
    for(const group of this.lampGroups)group.visible=quality!=='low'||day<.5;
    for(const {light,glow}of this.lamps){light.intensity=(1-day)*12;glow.emissiveIntensity=.3+(1-day)*3;}
    this.rays.visible=quality!=='low'&&this.weather!=='fog'&&this.weather!=='rain'&&day>.7;this.rays.children[0].material.opacity=.012+gold*.022;
    if(this.precipitation.visible){this.precipitation.geometry.setDrawRange(0,this.count);for(let i=0;i<this.count;i++){const k=i*3;this.positions[k]+=(this.weather==='rain'?.7:.25)*dt;this.positions[k+1]-=dt*(this.weather==='rain'?7:.7);this.positions[k+2]+=Math.sin(i+this.hour)*dt*.2;if(this.positions[k+1]<.02){this.positions[k+1]=8;this.positions[k]=(this.rand()-.5)*16;}}this.precipitation.geometry.attributes.position.needsUpdate=true;}
    if(this.sparkLife>0){this.sparkLife-=dt;for(let i=0;i<40;i++){this.sparkVel[i].y-=dt*9.81;for(let a=0;a<3;a++)this.sparkPositions[i*3+a]+=this.sparkVel[i].getComponent(a)*dt;}this.sparks.geometry.attributes.position.needsUpdate=true;this.sparks.material.opacity=this.sparkLife/.65;}else this.sparks.visible=false;
  }
}

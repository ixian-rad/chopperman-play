import * as THREE from 'three';
import { standard, box, cylinder, mesh } from './environment.js';
const Y=new THREE.Vector3(0,1,0);
function plaidMaterial(){
  const canvas=document.createElement('canvas');canvas.width=canvas.height=256;const c=canvas.getContext('2d');c.fillStyle='#a56140';c.fillRect(0,0,256,256);
  for(let p=0;p<256;p+=64){c.fillStyle='#323c3555';c.fillRect(p,0,24,256);c.fillRect(0,p,256,24);c.fillStyle='#dfac7655';c.fillRect(p+35,0,3,256);c.fillRect(0,p+35,256,3);c.fillStyle='#2a373944';c.fillRect(p+11,0,3,256);c.fillRect(0,p+11,256,3);}
  const t=new THREE.CanvasTexture(canvas);t.colorSpace=THREE.SRGBColorSpace;t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(1,1.5);t.anisotropy=4;return standard(0xffffff,{map:t});
}
function segment(parent,r1,r2,length,mat){const g=new THREE.Group();parent.add(g);cylinder(g,r1,r2,length,mat,0,-length/2,0,10);return g;}
function aim(segment,start,end){segment.position.copy(start);segment.quaternion.setFromUnitVectors(new THREE.Vector3(0,-1,0),end.clone().sub(start).normalize());}
// Analytic two-bone IK keeps both hands on the simulated handle and feet planted.
function joint(start,end,l1,l2,pole){
  const dir=end.clone().sub(start);const d=THREE.MathUtils.clamp(dir.length(),.01,l1+l2-.002);dir.normalize();
  const along=(d*d+l1*l1-l2*l2)/(2*d);const height=Math.sqrt(Math.max(0,l1*l1-along*along));
  const bend=pole.clone().addScaledVector(dir,-pole.dot(dir)).normalize();return start.clone().addScaledVector(dir,along).addScaledVector(bend,height);
}
export function createHumanoid(scene){
  const group=new THREE.Group();scene.add(group);
  const shirt=plaidMaterial(),denim=standard(0x405968),seam=standard(0x647883),skin=standard(0xc59d79),glove=standard(0x5d604b),boot=standard(0x4d4233),sole=standard(0x343b30),hat=standard(0xbd793d),hatRib=standard(0xa66535),belt=standard(0x514335);
  const hips=new THREE.Group();group.add(hips);hips.position.set(0,.96,-1.17);
  box(hips,.37,.2,.25,denim);box(hips,.39,.045,.27,belt,0,.08,0);box(hips,.065,.055,.015,standard(0xb9ae89,{metalness:.5}),0,.075,.142);
  const torso=new THREE.Group();hips.add(torso);torso.position.y=.07;
  const body=cylinder(torso,.265,.195,.53,shirt,0,.29,0,12);body.scale.z=.61;
  // Folded collar, pockets, placket, cuffs and small buttons.
  for(const side of [-1,1]){const collar=box(torso,.105,.1,.035,shirt,side*.06,.54,.105);collar.rotation.z=side*.35;box(torso,.105,.12,.025,shirt,side*.137,.36,.159);box(torso,.11,.025,.031,shirt,side*.137,.415,.17);}
  box(torso,.025,.46,.015,standard(0x79533c),0,.28,.165);for(let y=.12;y<.52;y+=.085)cylinder(torso,.009,.009,.014,standard(0xc0aa83),0,y,.18,6).rotation.x=Math.PI/2;
  cylinder(torso,.07,.075,.13,skin,0,.61,0);
  const head=new THREE.Group();torso.add(head);head.position.set(0,.785,.005);
  const headMesh=mesh(new THREE.IcosahedronGeometry(.155,2),skin,head);headMesh.scale.set(.87,1.18,.89);
  // Anonymous face: no identifying facial features.
  for(const side of [-1,1])mesh(new THREE.SphereGeometry(.035,8,6),skin,head,[side*.13,0,0]);
  const cap=mesh(new THREE.SphereGeometry(.158,16,10,0,Math.PI*2,0,Math.PI*.57),hat,head,[0,.07,-.012]);cap.scale.set(.97,1.03,.97);
  cylinder(head,.151,.15,.065,hatRib,0,.058,-.012,18);
  for(let i=0;i<24;i++){const a=i/24*Math.PI*2;const rib=box(head,.006,.055,.006,hat,Math.cos(a)*.149,.056,Math.sin(a)*.149-.012);rib.rotation.y=-a;}
  const arms=[];const legs=[];
  for(const side of [-1,1]){
    const upper=segment(group,.092,.073,.34,shirt),fore=segment(group,.067,.053,.34,shirt);
    const cuff=cylinder(fore,.065,.06,.055,shirt,0,-.31,0);const hand=mesh(new THREE.SphereGeometry(.065,10,8),glove,group);hand.scale.set(.85,1.15,1);
    const elbow=mesh(new THREE.SphereGeometry(.073,10,8),shirt,group);
    arms.push({side,upper,fore,hand,elbow});
    const thigh=segment(group,.106,.085,.46,denim),shin=segment(group,.082,.069,.43,denim);
    box(thigh,.014,.38,.012,seam,side*.093,-.23,.01);box(shin,.011,.37,.012,seam,side*.074,-.21,.01);
    const foot=new THREE.Group();group.add(foot);const footPos=new THREE.Vector3(side*.265,.10,-1.16+(side>0?.08:-.10));foot.position.copy(footPos);
    box(foot,.175,.14,.31,boot,0,0,.06);box(foot,.182,.035,.325,sole,0,-.067,.06);box(foot,.15,.12,.14,boot,0,.07,-.015);
    for(let i=0;i<4;i++)box(foot,.1,.008,.012,standard(0xa79876),0,.075,.08+i*.032);
    legs.push({side,thigh,shin,foot,footPos});
  }
  const shoulder=new THREE.Vector3();
  return { group, update(time,effort,grip,upperGrip){
    const breath=Math.sin(time*1.8)*.004;
    hips.position.y=.96-effort*.055;torso.rotation.x=.055+effort*.2+breath;torso.rotation.z=Math.sin(effort*Math.PI)*.035;
    head.rotation.x=.1+effort*.16;group.updateMatrixWorld(true);
    for(const arm of arms){
      shoulder.set(arm.side*.255,.49,0);torso.localToWorld(shoulder);
      const handPos=(arm.side<0?grip:upperGrip).clone();handPos.x+=arm.side*.037;
      const elbowPos=joint(shoulder,handPos,.34,.34,new THREE.Vector3(arm.side*.7,-.6,-.25));
      aim(arm.upper,shoulder,elbowPos);aim(arm.fore,elbowPos,handPos);arm.hand.position.copy(handPos);arm.hand.quaternion.copy(arm.fore.quaternion);arm.elbow.position.copy(elbowPos);
    }
    for(const leg of legs){const hip=new THREE.Vector3(leg.side*.145,-.045,0);hips.localToWorld(hip);const ankle=leg.footPos.clone().add(new THREE.Vector3(0,.065,-.02));const knee=joint(hip,ankle,.46,.43,new THREE.Vector3(leg.side*.3,0,1));aim(leg.thigh,hip,knee);aim(leg.shin,knee,ankle);}
  }};
}

export function createAxeMesh(scene,wood){
  const axe=new THREE.Group();scene.add(axe);const handle=standard(0xc5a16b,{map:wood.barkTexture,roughness:.65});
  const shaft=cylinder(axe,.023,.031,.91,handle,0,-.195,0,10);shaft.rotation.z=-.012;
  cylinder(axe,.035,.033,.035,standard(0x63442e),0,-.64,0,10);
  // A tapered steel wedge, with a lighter sharpened bevel.
  const outline=new THREE.Shape();outline.moveTo(-.13,.12);outline.lineTo(.17,.11);outline.lineTo(.235,.26);outline.quadraticCurveTo(.1,.31,-.13,.265);outline.closePath();
  const geo=new THREE.ExtrudeGeometry(outline,{depth:.068,bevelEnabled:true,bevelSize:.009,bevelThickness:.006,bevelSegments:1,steps:1});geo.rotateY(-Math.PI/2);geo.translate(.034,0,0);
  mesh(geo,standard(0x697976,{roughness:.32,metalness:.8}),axe);
  const bevel=box(axe,.073,.135,.025,standard(0xc4cbc2,{roughness:.2,metalness:.9}),0,.205,.222);bevel.rotation.x=-.28;
  box(axe,.075,.115,.09,standard(0x52615f,{roughness:.35,metalness:.8}),0,.19,-.117);
  return axe;
}

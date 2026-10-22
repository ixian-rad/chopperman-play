import * as THREE from 'three';

// Every surface and prop is generated here. No geographic or photographic data.
export function randomSource(seed = 1287) {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
}
const rand = randomSource();
export const palette = { grass:0x7a8654, bark:0x514033, timber:0xb99a6a, rust:0xb75031, leaf:0x9d9a50 };
export function standard(color, options={}) { return new THREE.MeshStandardMaterial({color,roughness:.86,...options}); }
export function mesh(geometry, material, parent, position=[0,0,0]) {
  const m = new THREE.Mesh(geometry,material); m.position.set(...position); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
}
export function box(parent,w,h,d,material,x=0,y=0,z=0) {return mesh(new THREE.BoxGeometry(w,h,d),material,parent,[x,y,z]);}
export function cylinder(parent,rt,rb,h,material,x=0,y=0,z=0,n=12) {return mesh(new THREE.CylinderGeometry(rt,rb,h,n),material,parent,[x,y,z]);}
export function beam(parent,a,b,r,material,n=8) {
  const start=new THREE.Vector3(...a), end=new THREE.Vector3(...b), delta=end.clone().sub(start);
  const result=cylinder(parent,r,r,delta.length(),material,...start.clone().add(end).multiplyScalar(.5).toArray(),n);
  result.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize());return result;
}
function texture(draw,size=512) {
  const canvas=document.createElement('canvas');canvas.width=canvas.height=size;const ctx=canvas.getContext('2d');draw(ctx,size);
  const t=new THREE.CanvasTexture(canvas);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=4;return t;
}
export function createWoodMaterials() {
  const bark=texture((ctx,s)=>{
    ctx.fillStyle='#65503a';ctx.fillRect(0,0,s,s);
    for(let i=0;i<550;i++) {let x=rand()*s,y=rand()*s;ctx.strokeStyle=['#3e352a','#8c7350','#a28b64','#51412e'][i%4];ctx.lineWidth=1+rand()*5;ctx.beginPath();ctx.moveTo(x,y);for(let j=0;j<6;j++){x+=rand()*9-4;ctx.lineTo(x,y+j*13);}ctx.stroke();}
  });
  const end=texture((ctx,s)=>{
    ctx.fillStyle='#cfb17d';ctx.fillRect(0,0,s,s);const cx=s*.49,cy=s*.51;
    for(let r=7;r<s*.73;r+=5+rand()*8){ctx.strokeStyle=`rgba(105,72,38,${.12+rand()*.2})`;ctx.lineWidth=.6+rand()*1.4;ctx.beginPath();for(let j=0;j<=150;j++){const a=j/150*Math.PI*2,rr=r*(1+.025*Math.sin(a*7)+.015*Math.cos(a*11));let x=cx+Math.cos(a)*rr,y=cy+Math.sin(a)*rr*.94;j?ctx.lineTo(x,y):ctx.moveTo(x,y);}ctx.stroke();}
    for(let i=0;i<9;i++){const a=rand()*6.28;ctx.strokeStyle='#8d70476a';ctx.lineWidth=1.3;ctx.beginPath();ctx.moveTo(cx+Math.cos(a)*s*.45,cy+Math.sin(a)*s*.45);ctx.lineTo(cx+Math.cos(a+.05)*s*.22,cy+Math.sin(a+.05)*s*.22);ctx.stroke();}
    for(let i=0;i<1800;i++){ctx.fillStyle='#71512914';ctx.fillRect(rand()*s,rand()*s,1,1);}
  });
  const grain=texture((ctx,s)=>{
    ctx.fillStyle='#d6b783';ctx.fillRect(0,0,s,s);
    for(let i=0;i<200;i++){const x=rand()*s;ctx.strokeStyle=i%3?'#96724742':'#f5d7a14d';ctx.lineWidth=rand()*2;ctx.beginPath();ctx.moveTo(x,0);ctx.bezierCurveTo(x-10,s*.33,x+13,s*.7,x+rand()*6,s);ctx.stroke();}
  });
  const rot=texture((ctx,s)=>{
    ctx.fillStyle='#665039';ctx.fillRect(0,0,s,s);
    for(let r=12;r<s*.72;r+=8){ctx.strokeStyle='#372b2580';ctx.lineWidth=2;ctx.beginPath();ctx.ellipse(s*.5,s*.5,r,r*.94,.12,0,Math.PI*2);ctx.stroke();}
    for(let i=0;i<1100;i++){const x=rand()*s,y=rand()*s;ctx.fillStyle=i%5?'#241d1877':'#c5b58e99';ctx.beginPath();ctx.ellipse(x,y,1+rand()*6,1+rand()*3,rand()*3,0,Math.PI*2);ctx.fill();}
    for(let i=0;i<32;i++){const a=rand()*Math.PI*2;ctx.strokeStyle='#28211c99';ctx.lineWidth=1+rand()*3;ctx.beginPath();ctx.moveTo(s/2,s/2);ctx.lineTo(s/2+Math.cos(a)*s*.48,s/2+Math.sin(a)*s*.48);ctx.stroke();}
  });
  return {rot:standard(0xffffff,{map:rot,bumpMap:rot,bumpScale:.012,roughness:1}),bark:standard(0xffffff,{map:bark,bumpMap:bark,bumpScale:.018,roughness:.91}),end:standard(0xffffff,{map:end,bumpMap:end,bumpScale:.003}),grain:standard(0xffffff,{map:grain,bumpMap:grain,bumpScale:.006}),barkTexture:bark};
}

export function buildEnvironment(scene,wood) {
  const yard=new THREE.Group();scene.add(yard);
  const grassMap=texture((ctx,s)=>{ctx.fillStyle='#7b8954';ctx.fillRect(0,0,s,s);for(let i=0;i<22000;i++){const v=rand();ctx.fillStyle=v<.3?'#9b9d60':v<.6?'#647849':'#899452';ctx.fillRect(rand()*s,rand()*s,1+rand()*2,1+rand()*5);}});
  grassMap.wrapS=grassMap.wrapT=THREE.RepeatWrapping;grassMap.repeat.set(9,9);
  const ground=mesh(new THREE.PlaneGeometry(90,90),standard(0xffffff,{map:grassMap}),yard);ground.rotation.x=-Math.PI/2;ground.castShadow=false;
  // Slightly worn clearing, with a soft, noisy edge baked into its texture.
  const dirtMap=texture((ctx,s)=>{const g=ctx.createRadialGradient(s/2,s/2,s*.12,s/2,s/2,s*.5);g.addColorStop(0,'#968666e0');g.addColorStop(.65,'#968666b0');g.addColorStop(1,'#96866600');ctx.fillStyle=g;ctx.fillRect(0,0,s,s);for(let i=0;i<2200;i++){const x=rand()*s,y=rand()*s;if(Math.hypot(x-s/2,y-s/2)<s*.42){ctx.fillStyle='#5a4e2b12';ctx.fillRect(x,y,2,1);}}});
  const dirt=mesh(new THREE.PlaneGeometry(3.7,3.7),standard(0xffffff,{map:dirtMap,transparent:true,depthWrite:false}),yard,[0,.007,-.1]);dirt.rotation.x=-Math.PI/2;dirt.castShadow=false;
  const fenceMats=[0x9c8760,0xaa946c,0xb39e76,0x98815b,0xb4a07c].map(c=>standard(c));
  const rail=standard(0x7b6b4d),post=standard(0x8f7b58);
  function fenceRun(length,cx,cz,rotation=0){const group=new THREE.Group();group.position.set(cx,0,cz);group.rotation.y=rotation;yard.add(group);for(let x=-length/2;x<length/2;x+=.177){const h=1.65+rand()*.07;box(group,.163,h,.065,fenceMats[Math.floor(rand()*5)],x,h/2,0);const cap=mesh(new THREE.ConeGeometry(.115,.08,4),fenceMats[0],group,[x,h+.035,0]);cap.rotation.y=Math.PI/4;cap.scale.z=.45;}for(let x=-length/2;x<=length/2;x+=2.4){box(group,.13,1.9,.14,post,x,.95,.03);box(group,.18,.055,.19,post,x,1.91,.03);}for(const y of [.45,1.25])box(group,length,.09,.1,rail,0,y,-.065);}
  fenceRun(19,0,-4.1);fenceRun(15,-8,3,Math.PI/2);fenceRun(15,8,3,Math.PI/2);

  // A deliberately generic clapboard house: repeated siding, shutters, a porch.
  const house=new THREE.Group();house.position.set(-3.7,0,-6.25);yard.add(house);
  const siding=standard(0xc5c9b5),trim=standard(0xf0ead7),shutter=standard(0x586c68),glass=standard(0x6d8582,{roughness:.22,metalness:.12}),roof=standard(0x545c53),brick=standard(0x8a7057);
  box(house,6.9,3.65,3,siding,0,2.04,0);box(house,7,.35,3.05,brick,0,.2,0);
  for(let y=.47;y<3.85;y+=.16)box(house,6.94,.014,3.025,standard(y%2?0xb1baa7:0xb9c1ae),0,y,0);
  const roofShape=new THREE.Shape();roofShape.moveTo(-3.6,0);roofShape.lineTo(0,1.8);roofShape.lineTo(3.6,0);roofShape.closePath();const roofG=new THREE.ExtrudeGeometry(roofShape,{depth:3.5,bevelEnabled:false});mesh(roofG,roof,house,[0,3.87,-1.75]);
  beam(house,[-3.65,3.87,1.8],[0,5.7,1.8],.045,trim,4);beam(house,[0,5.7,1.8],[3.65,3.87,1.8],.045,trim,4);box(house,7.4,.12,.18,trim,0,3.87,1.68);
  for(const x of [-2.25,.15,2.25]){box(house,1.08,1.38,.08,trim,x,2.55,1.55);box(house,.89,1.2,.08,glass,x,2.55,1.61);box(house,.04,1.2,.025,trim,x,2.55,1.67);box(house,.9,.04,.025,trim,x,2.53,1.67);box(house,1.2,.07,.2,trim,x,1.85,1.65);for(const d of [-.76,.76]){box(house,.32,1.4,.1,shutter,x+d,2.55,1.6);for(let y=1.92;y<3.2;y+=.1)box(house,.26,.025,.035,standard(0x74847a),x+d,y,1.66);}}
  box(house,.8,1.65,.12,shutter,1.1,1.03,1.57);box(house,.09,1.8,.2,trim,.65,1.07,1.59);box(house,.09,1.8,.2,trim,1.56,1.07,1.59);box(house,1,.09,.2,trim,1.1,1.96,1.59);
  box(house,1.6,.2,1.2,standard(0xb1a68e),1.1,.12,2.15);
  box(house,.55,1.5,.55,brick,-2.3,4.8,-.4);box(house,.65,.1,.65,roof,-2.3,5.59,-.4);

  const trunks=standard(0x66503c);const leafMats=[0x8e984e,0xa8a35b,0xc0aa59,0xc3934a,0x788748,0xad863f].map(c=>standard(c,{flatShading:true}));
  function tree(x,z,height,radius,index=0){const group=new THREE.Group();group.position.set(x,0,z);yard.add(group);cylinder(group,.1,.23,height*.6,trunks,0,height*.3,0,9);for(let i=0;i<7;i++){const a=i*2.4+index,reach=radius*(.45+rand()*.3);const end=[Math.cos(a)*reach,height*(.58+rand()*.22),Math.sin(a)*reach];beam(group,[0,height*.4,0],end,.055,trunks);const geo=new THREE.IcosahedronGeometry(radius*(.55+rand()*.18),1);const leaf=mesh(geo,leafMats[(i+index)%6],group,end);leaf.scale.set(1,1.05+rand()*.45,1);leaf.rotation.set(rand(),rand(),rand());}mesh(new THREE.IcosahedronGeometry(radius*.75,1),leafMats[index%6],group,[0,height*.9,0]);}
  tree(4.4,-2.55,5.6,1.7,2);tree(-5.6,-.8,4.6,1.65,0);tree(7,-5,6.5,2.2,4);tree(-7,-6,6.8,2.1,3);tree(1.3,-7.6,6.2,1.7,0);tree(6.9,4.5,5.4,1.7,1);
  // Bushes soften the fence line.
  const bushMats=[0x5f7347,0x6a7d4a,0x829057].map(c=>standard(c,{flatShading:true}));
  for(let i=0;i<22;i++){const x=-7.3+i*.66;const b=mesh(new THREE.IcosahedronGeometry(.4+rand()*.22,1),bushMats[i%3],yard,[x,.35,-3.7+rand()*.18]);b.scale.set(1.2,.8,1);}
  // A timber rack with visible end grain and unevenly stacked firewood.
  const rack=new THREE.Group();rack.position.set(2.7,0,-2.9);yard.add(rack);const iron=standard(0x454c42,{metalness:.65});
  for(const x of [-.85,.85]){box(rack,.045,.9,.05,iron,x,.5,-.32);box(rack,.045,.9,.05,iron,x,.5,.32);box(rack,.045,.045,.7,iron,x,.08,0);}box(rack,1.8,.05,.06,iron,0,.12,-.32);box(rack,1.8,.05,.06,iron,0,.12,.32);
  for(let row=0;row<3;row++)for(let i=0;i<6-row;i++){const r=.13+rand()*.025;const log=cylinder(rack,r,r,.63,[wood.bark,wood.end,wood.end],-.72+i*.29+row*.13,.27+row*.24,rand()*.04,10);log.rotation.x=Math.PI/2;log.rotation.z=rand()*.1;}
  // Garden bench and simple planter pots.
  const bench=new THREE.Group();bench.position.set(-3.5,0,-2.7);bench.rotation.y=-.1;yard.add(bench);const benchWood=standard(0xa58c61);
  for(let i=0;i<4;i++){box(bench,1.7,.065,.105,benchWood,0,.52,i*.115-.17);box(bench,1.7,.095,.065,benchWood,0,.79+i*.105,-.27);}for(const x of [-.64,.64]){box(bench,.08,.51,.08,iron,x,.26,.15);box(bench,.08,1.1,.08,iron,x,.55,-.23);box(bench,.09,.06,.55,iron,x,.46,0);}
  const terracotta=standard(0xa66d4c);for(const [x,z] of [[-2.3,-3.4],[5.5,-3.3],[-4.5,-2.6]]){cylinder(yard,.24,.17,.34,terracotta,x,.17,z);cylinder(yard,.25,.25,.05,terracotta,x,.34,z);cylinder(yard,.205,.205,.01,standard(0x574b34),x,.371,z);for(let i=0;i<7;i++){const a=i*2.4;beam(yard,[x,.36,z],[x+Math.cos(a)*.2,.6+rand()*.3,z+Math.sin(a)*.2],.012,bushMats[0],5);const flower=mesh(new THREE.IcosahedronGeometry(.08,0),leafMats[2],yard,[x+Math.cos(a)*.2,.64+rand()*.2,z+Math.sin(a)*.2]);flower.scale.y=.5;}}
  // Curving stepping stones.
  const stoneMats=[0xb3b2a0,0xaaa995,0xbebba7].map(c=>standard(c));for(let i=0;i<9;i++){const p=mesh(new THREE.CylinderGeometry(.31,.33,.065,6),stoneMats[i%3],yard,[-2.25-i*.12,.035,-1.2+i*.57]);p.rotation.y=rand()*2;p.scale.z=.8;}
  // Scattered already-cut logs around the block.
  for(const [x,z,r,ry] of [[1.1,.35,.16,.8],[1.4,.03,.14,1.2],[-.9,-.3,.14,.2],[1.3,.65,.12,.9]]){const l=cylinder(yard,r,r,.52,[wood.bark,wood.end,wood.end],x,r+.015,z,11);l.rotation.set(Math.PI/2,0,ry);}
  // Small grass tufts and fallen leaves use instancing to keep draw calls low.
  const tufts=new THREE.InstancedMesh(new THREE.ConeGeometry(.018,.14,3),standard(0x71814b),1800);tufts.castShadow=false;const dummy=new THREE.Object3D();
  for(let i=0;i<1800;i++){let x=(rand()-.5)*16,z=(rand()-.5)*14;if(Math.hypot(x,z+.3)<1.65){x+=3;}dummy.position.set(x,.05,z);dummy.rotation.set(rand()*.25,rand()*6.28,rand()*.3);dummy.scale.setScalar(.5+rand()*.8);dummy.updateMatrix();tufts.setMatrixAt(i,dummy.matrix);}yard.add(tufts);
  const leafMesh=new THREE.InstancedMesh(new THREE.CircleGeometry(.045,5),standard(0xffffff,{side:THREE.DoubleSide}),550);leafMesh.castShadow=false;leafMesh.receiveShadow=true;
  const leafColors=[new THREE.Color(0xb79249),new THREE.Color(0x8b793f),new THREE.Color(0xc1a15d),new THREE.Color(0xa66638)];
  for(let i=0;i<550;i++){let x=(rand()-.5)*14,z=(rand()-.5)*10;if(Math.hypot(x,z)<.7){x+=1.2;}dummy.position.set(x,.013+rand()*.006,z);dummy.rotation.set(-Math.PI/2,rand()*.1,rand()*6.28);dummy.scale.set(.7+rand(),.5+rand()*.5,1);dummy.updateMatrix();leafMesh.setMatrixAt(i,dummy.matrix);leafMesh.setColorAt(i,leafColors[i%4]);}yard.add(leafMesh);
  return yard;
}

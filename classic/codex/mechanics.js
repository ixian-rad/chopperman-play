// Shared deterministic mechanics. Meters, kilograms, seconds; no WebGL needed.
export const FIXED_DT=1/180, LOG_RADIUS=.225, LOG_HEIGHT=.59, BLOCK_TOP=.74;
export const LOG_TOP=BLOCK_TOP+LOG_HEIGHT+.003;
export const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const lerp=(a,b,t)=>a+(b-a)*t;
const smooth=t=>{t=clamp(t,0,1);return t*t*(3-2*t);};
export function swingPose(time,power=100,aim={x:0,z:0},yaw=0,top=LOG_TOP){
  const duration=.39/Math.sqrt(clamp(power,30,150)/100);
  const pivotX=aim.x-Math.sin(yaw)*.571,pivotZ=aim.z-Math.cos(yaw)*.571;
  const dy=top-LOG_TOP;
  if(time<.72){const u=smooth(time/.72);return {angle:lerp(1.03,-.65,u),x:pivotX*u,y:lerp(1.19,2+dy,u),z:lerp(-.66,pivotZ,u),yaw:yaw*u,effort:-u*.25,stage:'windup'};}
  if(time<.84)return {angle:-.65,x:pivotX,y:2+dy,z:pivotZ,yaw,effort:-.25,stage:'poised'};
  const u=smooth((time-.84)/duration);
  return {angle:lerp(-.65,2.85,u),x:pivotX,y:2+dy,z:pivotZ,yaw,effort:u,stage:'downswing',finished:time>.84+duration+.65};
}
export function edgePoint(pose){
  const y=.845*Math.cos(pose.angle)-.235*Math.sin(pose.angle),z=.845*Math.sin(pose.angle)+.235*Math.cos(pose.angle);
  return {x:pose.x+Math.sin(pose.yaw)*z,y:pose.y+y,z:pose.z+Math.cos(pose.yaw)*z};
}
export function sweptEdge(from,to,radius=LOG_RADIUS,top=LOG_TOP){
  if(from.y<top||to.y>top||from.y<=to.y)return null;
  const fraction=(from.y-top)/(from.y-to.y),x=lerp(from.x,to.x,fraction),z=lerp(from.z,to.z,fraction);
  return Math.hypot(x,z)<=radius+.035?{x,z,fraction}:null;
}
export function grainAt(log,x=0,z=0){
  if(log.forked)return forkSectionAt(log,x,z)?.yaw??log.grain;
  const sector=log.rotten?rottenSectorAt(log,x,z):-1;
  if(log.hollow||log.rotten&&sector>=0&&sector<(log.boss?6:4))return Math.atan2(x,z);
  return log.grain+(log.twist??0)*x/(log.radius??LOG_RADIUS);
}
export function knotAt(log){return log.burl?{x:(log.radius??LOG_RADIUS)*.12,z:-(log.radius??LOG_RADIUS)*.10}:{x:.075,z:-.025};}
// A blade-width capsule on the end face: turning the edge can clip a nearby
// inclusion even when its center misses. These same coordinates drive visuals.
export function inclusions(log){
  if(log.inclusions)return log.inclusions;
  const items=log.hazard?[{kind:'steel',x:-.13,z:.07,radius:.037}]:[];
  if(log.stony)items.push(...(log.boss?[
    {kind:'stone',x:0,z:0,radius:.054},
    {kind:'stone',x:.16,z:-.13,radius:.043},
    {kind:'stone',x:-.17,z:-.15,radius:.039}
  ]:[{kind:'stone',x:.09,z:-.055,radius:.039}]));
  return log.mineral?items.filter((_,i)=>!log.removedSections?.includes(i)):log.burl?items.filter(p=>!log.removedSections?.includes(burlSectorAt({...log,removedSections:[]},p.x,p.z))):items;
}
export function inclusionAt(log,x,z,yaw=0){
  return inclusions(log).find(p=>{
    const dx=p.x-x,dz=p.z-z,along=clamp(dx*Math.sin(yaw)+dz*Math.cos(yaw),-.035,.035);
    return Math.hypot(dx-Math.sin(yaw)*along,dz-Math.cos(yaw)*along)<=p.radius+.009;
  })??null;
}
export function safeSolidAim(log){
  if(log.precisionTarget)return {...log.precisionTarget,yaw:grainAt(log,log.precisionTarget.x,log.precisionTarget.z)};
  if(log.mineral)return mineralAim(log);
  if(log.burl)return burlAim(log);
  const radius=log.radius??LOG_RADIUS;
  for(const offset of [0,.34,-.34,.46,-.46,.6,-.6]){
    const x=Math.cos(log.grain)*radius*offset,z=-Math.sin(log.grain)*radius*offset,yaw=grainAt(log,x,z);
    if(!inclusionAt(log,x,z,yaw))return {x,z,yaw};
  }
  return {x:0,z:radius*.65,yaw:grainAt(log,0,radius*.65)};
}
export function precisionGrade(result,target){
  if(!target)return null;
  const contact=result.source!=='miss'&&!result.braced&&!result.hazard&&Number.isFinite(result.x)&&Number.isFinite(result.z)&&Number.isFinite(result.power)&&Number.isFinite(result.alignment);
  const distance=contact?Math.hypot(result.x-target.x,result.z-target.z):Infinity;
  const aim=clamp(1-distance/.09,0,1),grain=contact?clamp((result.alignment-.18)/.82,0,1):0;
  const power=contact?clamp(1-Math.abs(result.power-target.power)/50,0,1):0;
  const quality=contact?Math.round(100*(aim*.55+grain*.3+power*.15)):0;
  return {quality,distance:Number.isFinite(distance)?distance:null,aim,grain,power,bullseye:contact&&distance<=.025&&grain>=.956&&Math.abs(result.power-target.power)<=15};
}
export function woodImpact({speed,x,z,yaw,log,weather,axeMass,sharpness,tool='axe'}){
  const energy=.5*(axeMass*.78)*speed**2;
  const radius=log.radius??LOG_RADIUS, radial=Math.hypot(x,z);
  const fork=log.forked?forkSectionAt(log,x,z):null;
  const rotSector=log.rotten?rottenSectorAt(log,x,z):-1,core=log.rotten&&rotSector>=(log.boss?6:4);
  const mineral=log.mineral?mineralSections(log).find(p=>p.index===mineralSectorAt(log,x,z)):null;
  const burl=log.burl?burlSections(log).find(p=>p.index===burlSectorAt(log,x,z)):null;
  const rim=log.hollow||log.rotten&&!core;
  const accuracy=log.burl?(burl?clamp(1-Math.hypot(x-burl.cx,z-burl.cz)/(radius*.85),0,1):0):log.forked?(fork?clamp(1-Math.hypot((x-fork.cx)/fork.rx,(z-fork.cz)/fork.rz),0,1):0):rim?clamp(1-Math.abs(radial-radius*.73)/(radius*.35),0,1):clamp(1-radial/radius,0,1);
  const alignment=.18+.82*Math.cos(yaw-grainAt(log,x,z))**2;
  const center=knotAt(log),knot=log.knot&&!log.forked?Math.exp(-((x-center.x)**2+(z-center.z)**2)/.0035):0;
  const confinement=log.burl&&burl?.index===1?1+.65*[0,2].filter(i=>!log.removedSections?.includes(i)).length:1;
  const inclusion=tool!=='wedge'?inclusionAt(log,x,z,yaw):null,hazard=!!inclusion;
  const brittle=weather.brittle&&accuracy>.8?.88:1;
  // Interlocked fibers absorb energy even with a well aligned edge. A wedge
  // propagates an existing fracture instead of cutting a fresh kerf.
  const threshold=log.threshold*(log.burl?(burl?.massFraction??1)*(burl?.index===1?1.25:.85)*confinement:log.mineral?(mineral?.massFraction??1)*1.12:log.forked?(fork?.index===2?.5:.24):core?.12:rim?(log.boss?.24:.42):1)*weather.resistance*brittle*(1+knot*(tool==='wedge'?.2:.65))*(tool==='wedge'?.55:1+(log.twist??0)*.35);
  const empty=log.burl?!burl:log.mineral?!mineral:log.rotten?rotSector<0:log.forked?!fork:log.hollow&&hollowSectorAt(log,x,z)<0;
  const braced=fork?.index===2&&[0,1].some(i=>!log.removedSections?.includes(i));
  const useful=empty||braced?0:tool==='wedge'?energy*.9/(1+weather.friction*.3):energy*sharpness*(.28+.72*accuracy)*alignment*(hazard?.05:1);
  return {energy,accuracy,alignment,knot,confinement,hazard,hazardKind:inclusion?.kind??null,edgeWear:hazard?(inclusion.kind==='stone'?.12:.18):0,empty,braced,core,tool,threshold,useful,damage:useful/threshold,penetration:hazard?.002:Math.min(.19,useful/threshold*.14)};
}

// Each kerf remembers its own work. Moving across the grain starts another cut;
// moving along the same grain line extends it. Steel never seeds a usable kerf.
export function advanceCracks(cracks,result,{x,z,yaw},log){
  if(result.hazard||result.empty||result.braced)return null;
  const rawSector=log.rotten?rottenSectorAt(log,x,z):null;
  const sector=log.burl?burlSectorAt(log,x,z):log.mineral?mineralSectorAt(log,x,z):log.rotten?Math.min(rawSector,log.boss?6:4):log.forked?forkSectionAt(log,x,z)?.index:log.hollow?hollowSectorAt(log,x,z):null;
  let crack=cracks.find(c=>c.sector===sector&&(result.core||Math.abs((x-c.x)*Math.cos(c.yaw)-(z-c.z)*Math.sin(c.yaw))<.055&&Math.abs(Math.sin(yaw-c.yaw))<.38));
  if(!crack){if(cracks.length>=6)cracks.splice(cracks.indexOf(cracks.reduce((a,b)=>a.damage<b.damage?a:b)),1);crack={x,z,sector,yaw:grainAt(log,x,z),damage:0,depth:0};cracks.push(crack);}
  crack.damage=clamp(crack.damage+result.damage,0,1);crack.depth=Math.min(.24,crack.damage*.19);return crack;
}
export function crackPoint(crack,t,log){
  const bend=(log.twist??0)*t*t*1.4;
  let x=crack.x+Math.sin(crack.yaw)*t+Math.cos(crack.yaw)*bend,z=crack.z+Math.cos(crack.yaw)*t-Math.sin(crack.yaw)*bend;
  if(log.knot&&!log.forked){const center=knotAt(log),d=Math.hypot(x-center.x,z-center.z);if(d<.08){const push=(.08-d)*.65;x+=(x<center.x?-1:1)*push;}}
  return {x,z};
}

// Half-plane clipping keeps render faces and convex contact hulls identical.
export function clipPolygon(polygon,nx,nz,limit){
  const clipped=[];
  for(let i=0;i<polygon.length;i++){
    const a=polygon[i],b=polygon[(i+1)%polygon.length],da=a[0]*nx+a[1]*nz-limit,db=b[0]*nx+b[1]*nz-limit;
    if(da<=1e-12)clipped.push(a);
    if((da<0)!==(db<0)){const t=da/(da-db);clipped.push([lerp(a[0],b[0],t),lerp(a[1],b[1],t)]);}
  }
  return clipped.filter((p,i)=>Math.hypot(p[0]-clipped[(i+clipped.length-1)%clipped.length][0],p[1]-clipped[(i+clipped.length-1)%clipped.length][1])>1e-9);
}
function polygonSection(polygon,index=0){
  let area2=0,cx=0,cz=0;
  for(let i=0;i<polygon.length;i++){const a=polygon[i],b=polygon[(i+1)%polygon.length],cross=a[0]*b[1]-b[0]*a[1];area2+=cross;cx+=(a[0]+b[0])*cross;cz+=(a[1]+b[1])*cross;}
  cx/=3*area2;cz/=3*area2;const angle=Math.atan2(cz,cx);
  return {index,polygon,polygons:[polygon],cx,cz,area:area2/2,top:LOG_TOP,start:angle,end:angle};
}
export function containsPoint(polygon,x,z){return polygon.every((a,i)=>{const b=polygon[(i+1)%polygon.length];return (b[0]-a[0])*(z-a[1])-(b[1]-a[1])*(x-a[0])>=-1e-9;});}
export function roundOutline(radius){return Array.from({length:32},(_,i)=>[Math.cos(i*Math.PI/16)*radius,Math.sin(i*Math.PI/16)*radius]);}

// The primary fracture passes through the actual kerf, in the blade/grain
// direction. Secondary parallel splits make bounded long-grain billets.
export function kerfSections(radius,count,yaw,anchor={x:0,z:0}){
  const outline=roundOutline(radius),nx=Math.cos(yaw),nz=-Math.sin(yaw),offset=clamp(anchor.x*nx+anchor.z*nz,-radius*.72,radius*.72);
  const projections=outline.map(([x,z])=>x*nx+z*nz),low=Math.min(...projections),high=Math.max(...projections),sections=[];
  for(const [a,b]of [[low,offset],[offset,high]])for(let i=0;i<count/2;i++){
    const left=lerp(a,b,i/(count/2)),right=lerp(a,b,(i+1)/(count/2));
    const polygon=clipPolygon(clipPolygon(outline,nx,nz,right),-nx,-nz,-left);
    sections.push(polygonSection(polygon,sections.length));
  }
  const area=sections.reduce((sum,p)=>sum+p.area,0);
  return sections.map(p=>({...p,massFraction:p.area/area}));
}

// An asymmetric convex butt has a thick knot-bound heart between two flanks.
// Peeling a flank removes confinement from the heart instead of pooling work.
export function burlOutline(log){
  const radius=log.radius??LOG_RADIUS;
  return roundOutline(radius).map(([x,z])=>[x*.94+radius*.025,z*.81+radius*.055+Math.sin(Math.atan2(z,x)*2)*radius*.035]);
}
export function burlSections(log){
  const radius=log.radius??LOG_RADIUS,outline=burlOutline(log),nx=Math.cos(log.grain),nz=-Math.sin(log.grain),knot=knotAt(log),center=knot.x*nx+knot.z*nz;
  const limits=[-radius*2,center-radius*.31,center+radius*.31,radius*2],sections=[];
  for(let i=0;i<3;i++)sections.push(polygonSection(clipPolygon(clipPolygon(outline,nx,nz,limits[i+1]),-nx,-nz,-limits[i]),i));
  const area=sections.reduce((sum,p)=>sum+p.area,0);
  return sections.map(p=>({...p,massFraction:p.area/area}));
}
export function burlSectorAt(log,x,z){return burlSections(log).find(p=>!log.removedSections?.includes(p.index)&&containsPoint(p.polygon,x,z))?.index??-1;}
export function burlAim(log,section){
  const panels=burlSections(log),target=section??[0,2,1].find(i=>!log.removedSections?.includes(i));
  const panel=panels[target];if(!panel)return {x:0,z:0,yaw:log.grain};
  const safe={...log,inclusions:inclusions(log).map(p=>({...p,radius:p.radius+.024}))};let best=null;
  for(let ix=-9;ix<=9;ix++)for(let iz=-9;iz<=9;iz++){
    const x=ix*(log.radius??LOG_RADIUS)/10,z=iz*(log.radius??LOG_RADIUS)/10,yaw=grainAt(log,x,z);
    if(inclusionAt(safe,x,z,yaw)||[-.022,.022].some(dx=>!containsPoint(panel.polygon,x+dx,z)))continue;
    const distance=Math.hypot(x-panel.cx,z-panel.cz);
    if(!best||distance<best.distance)best={x,z,yaw,distance};
  }
  return best?{x:best.x,z:best.z,yaw:best.yaw}:{x:panel.cx,z:panel.cz,yaw:log.grain};
}

// Convex sectors share an off-center fracture origin. Area determines each
// piece's share of the log mass; a glancing cut releases unequal billets.
export function fractureSections(radius,count,grain,anchor={x:0,z:0}){
  const distance=Math.hypot(anchor.x,anchor.z),scale=distance>radius*.55?radius*.55/distance:1;
  const origin=[anchor.x*scale,anchor.z*scale],sections=[];
  for(let i=0;i<count;i++){
    const start=i*Math.PI*2/count+grain,end=(i+1)*Math.PI*2/count+grain,polygon=[origin];
    for(let j=0;j<=8;j++){const a=start+(end-start)*j/8;polygon.push([Math.cos(a)*radius,Math.sin(a)*radius]);}
    let area2=0,cx=0,cz=0;
    for(let j=0;j<polygon.length;j++){const a=polygon[j],b=polygon[(j+1)%polygon.length],cross=a[0]*b[1]-b[0]*a[1];area2+=cross;cx+=(a[0]+b[0])*cross;cz+=(a[1]+b[1])*cross;}
    sections.push({polygon,cx:cx/(3*area2),cz:cz/(3*area2),area:area2/2,start,end});
  }
  const area=sections.reduce((sum,s)=>sum+s.area,0);
  return sections.map(s=>({...s,massFraction:s.area/area}));
}

// Ring panels are compounds of convex trapezoids. Both rendering and contact
// geometry use these exact polygons; the cavity contains no hidden collider.
export function hollowSections(radius,count=6,grain=0){
  const inner=radius*.46, sections=[];
  for(let i=0;i<count;i++){
    const start=grain+i*Math.PI*2/count,end=grain+(i+1)*Math.PI*2/count,polygons=[];
    for(let j=0;j<3;j++){
      const a=start+(end-start)*j/3,b=start+(end-start)*(j+1)/3;
      polygons.push([[inner*Math.cos(a),inner*Math.sin(a)],[radius*Math.cos(a),radius*Math.sin(a)],[radius*Math.cos(b),radius*Math.sin(b)],[inner*Math.cos(b),inner*Math.sin(b)]]);
    }
    let area2=0,cx=0,cz=0;
    for(const polygon of polygons)for(let j=0;j<polygon.length;j++){
      const a=polygon[j],b=polygon[(j+1)%polygon.length],cross=a[0]*b[1]-b[0]*a[1];
      area2+=cross;cx+=(a[0]+b[0])*cross;cz+=(a[1]+b[1])*cross;
    }
    sections.push({index:i,start,end,polygons,cx:cx/(3*area2),cz:cz/(3*area2),area:area2/2,massFraction:1/count});
  }return sections;
}
export function hollowSectorAt(log,x,z){
  const radius=log.radius??LOG_RADIUS,count=log.boss?6:4;
  for(const s of hollowSections(radius,count,log.grain))for(const polygon of s.polygons){
    if(polygon.every((a,i)=>{const b=polygon[(i+1)%polygon.length];return (b[0]-a[0])*(z-a[1])-(b[1]-a[1])*(x-a[0])>=-1e-8;}))return s.index;
  }return -1;
}

// A bounded Voronoi partition keeps each hard pocket wholly inside its own
// convex billet. Shared half-planes create matching exposed fracture faces.
export function mineralSections(log){
  const radius=log.radius??LOG_RADIUS,seeds=inclusions({...log,removedSections:[]});
  const outline=Array.from({length:32},(_,i)=>[Math.cos(i*Math.PI/16)*radius,Math.sin(i*Math.PI/16)*radius]);
  const sections=seeds.map((seed,index)=>{
    let polygon=outline;
    for(const other of seeds){
      if(other===seed)continue;
      const nx=other.x-seed.x,nz=other.z-seed.z,limit=(other.x**2+other.z**2-seed.x**2-seed.z**2)/2;
      const clipped=[];
      for(let i=0;i<polygon.length;i++){
        const a=polygon[i],b=polygon[(i+1)%polygon.length],da=a[0]*nx+a[1]*nz-limit,db=b[0]*nx+b[1]*nz-limit;
        if(da<=1e-12)clipped.push(a);
        if((da<0)!==(db<0)){const t=da/(da-db);clipped.push([lerp(a[0],b[0],t),lerp(a[1],b[1],t)]);}
      }polygon=clipped;
    }
    let area2=0,cx=0,cz=0;
    for(let i=0;i<polygon.length;i++){const a=polygon[i],b=polygon[(i+1)%polygon.length],cross=a[0]*b[1]-b[0]*a[1];area2+=cross;cx+=(a[0]+b[0])*cross;cz+=(a[1]+b[1])*cross;}
    cx/=3*area2;cz/=3*area2;const angle=Math.atan2(cz,cx);
    return {index,polygon,polygons:[polygon],cx,cz,area:area2/2,top:LOG_TOP,start:angle,end:angle};
  });
  const area=sections.reduce((sum,p)=>sum+p.area,0);
  return sections.map(p=>({...p,massFraction:p.area/area}));
}
export function mineralSectorAt(log,x,z){
  return mineralSections(log).find(p=>!log.removedSections?.includes(p.index)&&p.polygon.every((a,i)=>{const b=p.polygon[(i+1)%p.polygon.length];return (b[0]-a[0])*(z-a[1])-(b[1]-a[1])*(x-a[0])>=-1e-9;}))?.index??-1;
}
export function mineralAim(log,section){
  const panels=mineralSections(log),target=section??panels.find(p=>!log.removedSections?.includes(p.index))?.index;
  const windSafe={...log,inclusions:inclusions(log).map(p=>({...p,radius:p.radius+.024}))};
  // Search interior points with a margin for the entire edge and sweep drift.
  let best=null;
  for(let ix=-8;ix<=8;ix++)for(let iz=-8;iz<=8;iz++){
    const x=ix*(log.radius??LOG_RADIUS)/10,z=iz*(log.radius??LOG_RADIUS)/10,yaw=grainAt(log,x,z);
    if(inclusionAt(windSafe,x,z,yaw)||[-.022,.022].some(drift=>mineralSectorAt(log,x+drift,z)!==target))continue;
    const panel=panels[target],margin=Math.min(...panel.polygon.map((a,i)=>{const b=panel.polygon[(i+1)%panel.polygon.length];return ((b[0]-a[0])*(z-a[1])-(b[1]-a[1])*(x-a[0]))/Math.hypot(b[0]-a[0],b[1]-a[1]);}));
    if(margin<.012)continue;
    const quality=1-Math.hypot(x,z)/(log.radius??LOG_RADIUS)+Math.min(.05,margin);
    if(!best||quality>best.quality)best={x,z,yaw,quality};
  }
  return best?{x:best.x,z:best.z,yaw:best.yaw}:{x:0,z:0,yaw:log.grain};
}

export function selectWedgeCrack(cracks,log,aim,seated){
  const eligible=cracks.filter(c=>c.depth>=.018&&!log.removedSections?.includes(c.sector));
  if(seated)return eligible.find(c=>c.sector===seated.sector&&Math.hypot(c.x-seated.x,c.z-seated.z)<.012)??null;
  return eligible.filter(c=>Math.hypot(c.x-aim.x,c.z-aim.z)<=.10).sort((a,b)=>Math.hypot(a.x-aim.x,a.z-aim.z)-Math.hypot(b.x-aim.x,b.z-aim.z))[0]??null;
}
export function wedgeExtractionCost(wedge,friction){return wedge?Math.ceil(2+wedge.depth*80*friction):0;}


// Heart rot fills the shell's exact inner boundary with low-density convex
// wedges. Area times relative density conserves the round's total mass.
export function rottenSections(log){
  const radius=log.radius??LOG_RADIUS,count=log.boss?6:4;
  const ring=hollowSections(radius,count,log.grain).map(s=>({...s,core:false,top:LOG_TOP}));
  const core=ring.map((s,i)=>{
    const polygon=[[0,0],s.polygons[0][0],...s.polygons.map(p=>p[3])];
    let twice=0,cx=0,cz=0;
    for(let j=0;j<polygon.length;j++){const a=polygon[j],b=polygon[(j+1)%polygon.length],cross=a[0]*b[1]-b[0]*a[1];twice+=cross;cx+=(a[0]+b[0])*cross;cz+=(a[1]+b[1])*cross;}
    return {index:count+i,core:true,polygons:[polygon],cx:cx/(3*twice),cz:cz/(3*twice),area:twice/2,start:s.start,end:s.end,top:LOG_TOP};
  });
  const weightedArea=[...ring,...core].reduce((sum,p)=>sum+p.area*(p.core?.22:1),0);
  return [...ring,...core].map(p=>({...p,massFraction:p.area*(p.core?.22:1)/weightedArea}));
}
export function rottenSectorAt(log,x,z){
  for(const p of rottenSections(log))if(!log.removedSections?.includes(p.index))for(const polygon of p.polygons){
    if(polygon.every((a,i)=>{const b=polygon[(i+1)%polygon.length];return (b[0]-a[0])*(z-a[1])-(b[1]-a[1])*(x-a[0])>=-1e-8;}))return p.index;
  }return -1;
}

// Wind is a force on exposed fragments, not a velocity teleport. Small,
// low-density chips accelerate most; linear drag limits their terminal speed.
export function windLoad(time,wind){
  const strength=clamp(wind/.02,0,1),gust=.72+.22*Math.sin(time*.83)+.06*Math.sin(time*2.17);
  return {x:strength*gust*1.8,z:strength*(.22+.12*Math.sin(time*.57)),strength:strength*gust};
}
export function fragmentWind(area,mass,velocity,wind){
  if(!wind.strength||mass<=0)return {x:0,z:0};
  const drag=Math.min(area*.55,mass*2.5);
  return {x:wind.x*area-drag*velocity.x,z:wind.z*area-drag*velocity.z};
}
export function pullGesture(dx,dy,seconds){
  const distance=Math.hypot(dx,dy),speed=distance/Math.max(.08,seconds);
  return {distance,power:clamp(45+distance*.23+Math.min(25,speed*.035),30,150),yawDelta:clamp(dx/250,-.6,.6)};
}

// A real fork: two leaning limbs sit on a lower, interlocked crotch.
// The top and bottom polygons define both the mesh and convex collision hull.
export function forkSections(log){
  const s=(log.radius??LOG_RADIUS)/LOG_RADIUS,base=BLOCK_TOP+.003,join=base+.28;
  const ellipse=(cx,rx,rz)=>Array.from({length:16},(_,i)=>{const a=i*Math.PI/8;return [cx+Math.cos(a)*rx,Math.sin(a)*rz];});
  const sections=[-1,1].map((side,index)=>({index,cx:side*.17*s,cz:0,rx:.105*s,rz:.135*s,bottom:join,top:LOG_TOP+.07,yaw:log.grain+side*.48,
    polygon:ellipse(side*.17*s,.105*s,.135*s),bottomPolygon:ellipse(side*.065*s,.062*s,.135/.105*.062*s)}));
  sections.push({index:2,cx:0,cz:0,rx:.13*s,rz:.15*s,bottom:base,top:join,yaw:log.grain,polygon:ellipse(0,.13*s,.15*s),bottomPolygon:ellipse(0,.155*s,.15/.13*.155*s)});
  const volume=p=>{const area=poly=>Math.abs(poly.reduce((sum,a,i)=>{const b=poly[(i+1)%poly.length];return sum+a[0]*b[1]-b[0]*a[1];},0))/2;
    const a=area(p.polygon),b=area(p.bottomPolygon);return (p.top-p.bottom)*(a+b+Math.sqrt(a*b))/3;};
  const total=sections.reduce((sum,p)=>sum+volume(p),0);
  return sections.map(p=>{
    const bottomCx=p.bottomPolygon.reduce((sum,v)=>sum+v[0],0)/16;
    const ratio=(p.polygon[0][0]-p.cx)/(p.bottomPolygon[0][0]-bottomCx),mid=(1+ratio)**2/4;
    const t=(2*mid+ratio**2)/(1+4*mid+ratio**2);
    return {...p,bodyCx:bottomCx+(p.cx-bottomCx)*t,bodyCy:p.bottom+(p.top-p.bottom)*t,volume:volume(p),massFraction:volume(p)/total};
  });
}
export function forkSectionAt(log,x,z){
  return forkSections(log).find(s=>!log.removedSections?.includes(s.index)&&s.polygon.every((a,i)=>{const b=s.polygon[(i+1)%s.polygon.length];return (b[0]-a[0])*(z-a[1])-(b[1]-a[1])*(x-a[0])>=-1e-8;}))??null;
}

// Recoverable elastic energy stays below the unused impact budget. Recoil is
// visual compliance of the driven tool, not a second rigid-body collision.
export function impactResponse({energy,useful,penetration,hazard,split,friction}){
  const stored=split?0:Math.max(0,energy-Math.min(energy,useful*.65))*(hazard?.32:.11)/(1+friction);
  return {storedEnergy:stored,recoil:Math.min(.24,Math.sqrt(stored/140)),seatDepth:split||hazard?0:clamp(penetration*.4,.004,.075)};
}
export function evolveCondition(state,weather,dt){
  dt=clamp(dt,0,3600);
  const target=weather==='rain'?1:weather==='fog'?.55:.08;
  const moisture=target+(state.moisture-target)*Math.exp(-dt/(weather==='rain'?24:65));
  const frostTarget=weather==='snow'?1:0;
  const frost=frostTarget+(state.frost-frostTarget)*Math.exp(-dt/(weather==='snow'?22:15));
  return {moisture:clamp(moisture,0,1),frost:clamp(frost,0,1)};
}
export function conditionPhysics(state,weather){
  return {resistance:1+.30*state.moisture+.18*state.frost,friction:clamp(.76-.43*state.moisture-.28*state.frost,.16,.76),brittle:state.frost>.25,wind:weather.wind??0};
}

// Shared topology for the convex wood prisms. Polygon order is CCW in X/Z,
// so the lower cap faces down, the upper cap up, and the sides face out.
export function prismFaces(count){
  const faces=[Array.from({length:count},(_,i)=>i),Array.from({length:count},(_,i)=>count*2-1-i)];
  for(let i=0;i<count;i++){const next=(i+1)%count;faces.push([i,i+count,next+count,next]);}
  return faces;
}

// cannon-es checks face normals against the shape's local origin, which must
// be inside each convex hull, not merely inside its compound rigid body.
// The vertex mean is inside a nondegenerate convex polyhedron. Add `offset`
// back via Body.addShape to preserve every original body-local vertex.
export function centerHull(vertices){
  const offset={x:0,y:0,z:0};
  for(const v of vertices){offset.x+=v.x;offset.y+=v.y;offset.z+=v.z;}
  offset.x/=vertices.length;offset.y/=vertices.length;offset.z/=vertices.length;
  return {offset,vertices:vertices.map(v=>({x:v.x-offset.x,y:v.y-offset.y,z:v.z-offset.z}))};
}

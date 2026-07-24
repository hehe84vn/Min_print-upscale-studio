'use strict';

function distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function angle(a, b, c) {
  const u = { x: a.x - b.x, y: a.y - b.y };
  const v = { x: c.x - b.x, y: c.y - b.y };
  const lu = Math.hypot(u.x, u.y); const lv = Math.hypot(v.x, v.y);
  if (lu < 1e-9 || lv < 1e-9) return 180;
  const cos = Math.max(-1, Math.min(1, (u.x * v.x + u.y * v.y) / (lu * lv)));
  return Math.acos(cos) * 180 / Math.PI;
}
function pointLineDistance(p, a, b) {
  const dx = b.x - a.x; const dy = b.y - a.y;
  const denom = dx * dx + dy * dy;
  if (denom < 1e-9) return distance(p, a);
  const t = Math.max(0, Math.min(1, ((p.x-a.x)*dx + (p.y-a.y)*dy)/denom));
  return distance(p, { x: a.x + t*dx, y: a.y + t*dy });
}
function simplify(points, tolerance) {
  if (points.length <= 2) return points;
  let max = -1; let index = -1;
  for (let i=1;i<points.length-1;i+=1) {
    const d = pointLineDistance(points[i], points[0], points.at(-1));
    if (d > max) { max=d; index=i; }
  }
  if (max <= tolerance) return [points[0], points.at(-1)];
  const left = simplify(points.slice(0,index+1), tolerance);
  const right = simplify(points.slice(index), tolerance);
  return [...left.slice(0,-1), ...right];
}
function cubicFromPolyline(points) {
  const start = points[0]; const end = points.at(-1);
  const p1 = points[Math.min(points.length-1, 1)];
  const p2 = points[Math.max(0, points.length-2)];
  const chord = distance(start,end);
  const handle = chord / 3;
  const d1 = Math.max(1e-9, distance(start,p1));
  const d2 = Math.max(1e-9, distance(p2,end));
  return {
    type:'C', start,
    c1:{x:start.x+(p1.x-start.x)/d1*handle,y:start.y+(p1.y-start.y)/d1*handle},
    c2:{x:end.x+(p2.x-end.x)/d2*handle,y:end.y+(p2.y-end.y)/d2*handle},
    end
  };
}
function evaluateCubic(s,t) {
  const u=1-t;
  return {x:u*u*u*s.start.x+3*u*u*t*s.c1.x+3*u*t*t*s.c2.x+t*t*t*s.end.x,
    y:u*u*u*s.start.y+3*u*u*t*s.c1.y+3*u*t*t*s.c2.y+t*t*t*s.end.y};
}
function maxDeviation(points, cubic) {
  let maximum=0;
  for (let i=0;i<points.length;i+=1) {
    const t=i/Math.max(1,points.length-1);
    maximum=Math.max(maximum,distance(points[i],evaluateCubic(cubic,t)));
  }
  return maximum;
}
function refitLongLineRuns(segments, options={}) {
  const minimumRun=Math.max(8, Number(options.minimumRun||12));
  const tolerance=Math.max(0.05, Number(options.errorTolerance||1));
  const cornerAngle=Math.max(12, Math.min(80, Number(options.cornerAngleDegrees||38)));
  const out=[]; let runsRefit=0; let linesReplaced=0; let maximumDeviation=0;
  let i=0;
  while(i<segments.length){
    if(segments[i].type!=='L'){out.push(segments[i]);i+=1;continue;}
    const run=[]; const startIndex=i;
    while(i<segments.length&&segments[i].type==='L'){run.push(segments[i]);i+=1;}
    if(run.length<minimumRun){out.push(...run);continue;}
    const points=[run[0].start,...run.map(s=>s.end)];
    const splits=[0];
    for(let p=1;p<points.length-1;p+=1){if(angle(points[p-1],points[p],points[p+1])<180-cornerAngle)splits.push(p);}
    splits.push(points.length-1);
    const replacement=[]; let safe=true;
    for(let s=0;s<splits.length-1;s+=1){
      const chunk=points.slice(splits[s],splits[s+1]+1);
      if(chunk.length<4){for(let k=1;k<chunk.length;k+=1)replacement.push({type:'L',start:chunk[k-1],end:chunk[k]});continue;}
      const simplified=simplify(chunk,tolerance*0.35);
      const cubic=cubicFromPolyline(simplified);
      const deviation=maxDeviation(chunk,cubic);
      if(deviation>tolerance){safe=false;break;}
      maximumDeviation=Math.max(maximumDeviation,deviation); replacement.push(cubic);
    }
    if(!safe||replacement.length>=run.length){out.push(...run);continue;}
    out.push(...replacement); runsRefit+=1; linesReplaced+=run.length-replacement.length;
  }
  return {segments:out,stats:{runsRefit,linesReplaced,maximumDeviation:Number(maximumDeviation.toFixed(4))}};
}
module.exports={refitLongLineRuns};

import assert from 'node:assert/strict';
import refitModule from '../src/main/services/vectorLongContourRefitService.js';
import geometryModule from '../src/main/services/vectorGeometryLock.js';

const { refitLongLineRuns } = refitModule;
const { parsePathData } = geometryModule;
const points=[];
for(let i=0;i<=48;i+=1){const t=i/48;points.push({x:10+t*180,y:100-70*Math.sin(Math.PI*t)});}
let d=`M${points[0].x} ${points[0].y}`;
for(const point of points.slice(1)) d+=`L${point.x.toFixed(3)} ${point.y.toFixed(3)}`;
const segments=parsePathData(d);
const result=refitLongLineRuns(segments,{minimumRun:12,errorTolerance:2.2,cornerAngleDegrees:38});
assert.ok(result.stats.runsRefit>=1,'Long polygon arc must be refitted.');
assert.ok(result.stats.linesReplaced>=20,'Refit must remove a meaningful number of line nodes.');
assert.ok(result.segments.some(segment=>segment.type==='C'),'Refit must generate cubic Bezier geometry.');
assert.ok(result.stats.maximumDeviation<=2.2,'Refit must remain inside bounded error.');
console.log(`Long contour refit OK: ${result.stats.linesReplaced} lines removed, max deviation ${result.stats.maximumDeviation}.`);

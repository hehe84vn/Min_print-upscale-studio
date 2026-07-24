import assert from 'node:assert/strict';
import sharp from 'sharp';
import textAwareModule from '../src/main/services/textAwareUpscaleService.js';

const { buildTextMask, enhanceTextAware } = textAwareModule;
const width = 160; const height = 80; const channels = 4;
const raw = Buffer.alloc(width * height * channels, 245);
for (let i=0;i<width*height;i+=1) raw[i*channels+3]=255;
function fillRect(left,top,w,h,r,g=r,b=r){for(let y=top;y<top+h;y+=1)for(let x=left;x<left+w;x+=1){const o=(y*width+x)*channels;raw[o]=r;raw[o+1]=g;raw[o+2]=b;}}
fillRect(20,22,8,38,42,48,68); fillRect(28,22,22,7,42,48,68); fillRect(28,38,17,7,42,48,68);
fillRect(55,22,8,38,42,48,68); fillRect(72,22,8,38,42,48,68); fillRect(80,22,22,7,42,48,68); fillRect(94,22,8,38,42,48,68); fillRect(84,12,7,5,42,48,68);
const mask=buildTextMask(raw,{width,height,channels},{edgeThreshold:25,maskRadius:1});
assert.ok(mask.coverage>0.01); assert.ok(mask.coverage<0.35);
const source=await sharp(raw,{raw:{width,height,channels}}).blur(0.65).png().toBuffer();
const enhanced=await enhanceTextAware(source,{textStrength:0.72,haloLimit:9,chromaProtection:0.8,edgeThreshold:20});
assert.equal(enhanced.stats.applied,true); assert.ok(enhanced.stats.textCoverage>0); assert.ok(enhanced.stats.chromaClamped>0);
const before=await sharp(source).ensureAlpha().raw().toBuffer({resolveWithObject:true});
const after=await sharp(enhanced.buffer).ensureAlpha().raw().toBuffer({resolveWithObject:true});
let maximumLumaDelta=0; let chromaBefore=0; let chromaAfter=0; let samples=0;
for(let i=0;i<before.data.length;i+=4){const br=before.data[i],bg=before.data[i+1],bb=before.data[i+2];const ar=after.data[i],ag=after.data[i+1],ab=after.data[i+2];const by=br*.2126+bg*.7152+bb*.0722;const ay=ar*.2126+ag*.7152+ab*.0722;maximumLumaDelta=Math.max(maximumLumaDelta,Math.abs(ay-by));if(by<150){chromaBefore+=Math.max(br,bg,bb)-Math.min(br,bg,bb);chromaAfter+=Math.max(ar,ag,ab)-Math.min(ar,ag,ab);samples+=1;}}
assert.ok(maximumLumaDelta<=11,`Luminance halo bound exceeded: ${maximumLumaDelta}`);
assert.ok(chromaAfter/Math.max(1,samples)<chromaBefore/Math.max(1,samples),'Dark text chroma contamination must be reduced.');
console.log(`Text-aware Upscale V12 OK: ${enhanced.stats.textCoverage}% coverage, ${enhanced.stats.haloClamped} halo clamps, ${enhanced.stats.chromaClamped} chroma clamps.`);

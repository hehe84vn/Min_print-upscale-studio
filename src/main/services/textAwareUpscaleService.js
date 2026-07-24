'use strict';

const sharp = require('sharp');

function clamp(value, minimum, maximum) { return Math.max(minimum, Math.min(maximum, value)); }
function luminance(r, g, b) { return r * 0.2126 + g * 0.7152 + b * 0.0722; }
function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * ratio)))];
}

function buildTextMask(data, info, options = {}) {
  const { width, height, channels } = info;
  const pixels = width * height;
  const gray = new Float32Array(pixels);
  for (let i = 0; i < pixels; i += 1) {
    const o = i * channels;
    gray[i] = luminance(data[o], data[o + 1] ?? data[o], data[o + 2] ?? data[o]);
  }
  const gradients = new Float32Array(pixels);
  const samples = [];
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x;
      const gx = -gray[i-width-1] + gray[i-width+1] - 2*gray[i-1] + 2*gray[i+1] - gray[i+width-1] + gray[i+width+1];
      const gy = -gray[i-width-1] - 2*gray[i-width] - gray[i-width+1] + gray[i+width-1] + 2*gray[i+width] + gray[i+width+1];
      gradients[i] = Math.hypot(gx, gy);
      if ((x + y) % 11 === 0) samples.push(gradients[i]);
    }
  }
  const automaticThreshold = clamp(percentile(samples, 0.72), 22, 150);
  const threshold = clamp(Number(options.edgeThreshold ?? automaticThreshold), 8, 220);
  const mask = new Uint8Array(pixels);
  let selected = 0;
  for (let y = 2; y < height - 2; y += 1) {
    for (let x = 2; x < width - 2; x += 1) {
      const i = y * width + x;
      if (gradients[i] < threshold) continue;
      let horizontal = 0; let vertical = 0; let clustered = 0;
      for (let s = -2; s <= 2; s += 1) {
        if (gradients[i+s] >= threshold * 0.62) horizontal += 1;
        if (gradients[i+s*width] >= threshold * 0.62) vertical += 1;
      }
      for (let yy=-2; yy<=2; yy+=1) for (let xx=-2; xx<=2; xx+=1) if (gradients[i+yy*width+xx] >= threshold*0.55) clustered += 1;
      if ((horizontal >= 2 || vertical >= 2) && clustered >= 5) { mask[i] = 255; selected += 1; }
    }
  }
  const dilated = new Uint8Array(mask);
  const radius = Math.max(1, Math.min(3, Math.round(Number(options.maskRadius ?? 1))));
  for (let y=radius; y<height-radius; y+=1) for (let x=radius; x<width-radius; x+=1) {
    const i=y*width+x; if(!mask[i]) continue;
    for(let yy=-radius;yy<=radius;yy+=1) for(let xx=-radius;xx<=radius;xx+=1){
      const weight=clamp(1-Math.hypot(xx,yy)/(radius+1),0,1);
      const target=i+yy*width+xx; dilated[target]=Math.max(dilated[target],Math.round(255*weight));
    }
  }
  return { mask: dilated, coverage: selected / Math.max(1, pixels), threshold, gray };
}

function localLuminanceRange(gray, width, height, x, y) {
  let minimum=255; let maximum=0; let sum=0; let count=0;
  for(let yy=Math.max(0,y-1);yy<=Math.min(height-1,y+1);yy+=1) for(let xx=Math.max(0,x-1);xx<=Math.min(width-1,x+1);xx+=1){
    const value=gray[yy*width+xx]; minimum=Math.min(minimum,value); maximum=Math.max(maximum,value); sum+=value; count+=1;
  }
  return {minimum,maximum,mean:sum/Math.max(1,count)};
}

async function enhanceTextAware(input, options = {}) {
  const strength = clamp(Number(options.textStrength ?? 0.64), 0, 1.25);
  const haloLimit = clamp(Number(options.haloLimit ?? 10), 3, 32);
  const chromaProtection = clamp(Number(options.chromaProtection ?? 0.72), 0, 1);
  const maximumPixels = Math.max(1_000_000, Number(options.maximumPixels ?? 48_000_000));
  const baseImage = sharp(input, { failOn: 'none', limitInputPixels: false }).rotate().ensureAlpha();
  const metadata = await baseImage.metadata();
  const pixelCount = Number(metadata.width || 0) * Number(metadata.height || 0);
  if (!metadata.width || !metadata.height || pixelCount > maximumPixels || strength <= 0.001) {
    return { buffer: await baseImage.png({ compressionLevel: 6 }).toBuffer(), stats: { applied:false, reason:pixelCount>maximumPixels?'pixel-limit':'disabled', pixelCount } };
  }
  const [{data:base,info}, blurredGray] = await Promise.all([
    baseImage.clone().raw().toBuffer({resolveWithObject:true}),
    baseImage.clone().greyscale().blur(0.78).raw().toBuffer()
  ]);
  const detection=buildTextMask(base,info,options);
  const output=Buffer.from(base);
  const {width,height,channels}=info;
  let changed=0; let haloClamped=0; let chromaClamped=0;
  for(let y=0;y<height;y+=1) for(let x=0;x<width;x+=1){
    const pixel=y*width+x; const weight=detection.mask[pixel]/255; if(weight<=0.01) continue;
    const offset=pixel*channels;
    const r=base[offset]; const g=base[offset+1]??r; const b=base[offset+2]??r;
    const originalY=detection.gray[pixel];
    const highPass=originalY-blurredGray[pixel];
    const proposed=highPass*strength*weight;
    const limited=clamp(proposed,-haloLimit,haloLimit);
    const range=localLuminanceRange(detection.gray,width,height,x,y);
    const targetY=clamp(originalY+limited,range.minimum-1.5,range.maximum+1.5);
    if(Math.abs(proposed-limited)>0.5 || targetY!==originalY+limited) haloClamped+=1;

    const scale=originalY>2 ? targetY/originalY : 1;
    let nr=r*scale; let ng=g*scale; let nb=b*scale;
    const chroma=Math.max(r,g,b)-Math.min(r,g,b);
    const darkText=originalY<150 && range.mean-originalY>10;
    if(darkText && chroma>5){
      const neutral=(nr+ng+nb)/3;
      const neutralize=chromaProtection*weight*clamp((150-originalY)/110,0,1);
      nr=nr*(1-neutralize)+neutral*neutralize;
      ng=ng*(1-neutralize)+neutral*neutralize;
      nb=nb*(1-neutralize)+neutral*neutralize;
      chromaClamped+=1;
    }
    const values=[nr,ng,nb];
    for(let c=0;c<Math.min(3,channels);c+=1){
      const value=clamp(Math.round(values[c]),0,255);
      if(value!==base[offset+c]) changed+=1;
      output[offset+c]=value;
    }
  }
  const buffer=await sharp(output,{raw:info}).png({compressionLevel:6}).toBuffer();
  return {buffer,stats:{applied:changed>0,pixelCount,changedChannels:changed,haloClamped,chromaClamped,textCoverage:Number((detection.coverage*100).toFixed(2)),edgeThreshold:Number(detection.threshold.toFixed(2)),strength,haloLimit,chromaProtection}};
}

module.exports={buildTextMask,enhanceTextAware};

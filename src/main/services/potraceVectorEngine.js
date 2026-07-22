'use strict';

const PRESETS = {
  detail: {
    id: 'potrace-detail',
    label: 'Potrace · Giữ chi tiết',
    turdSize: 1,
    alphaMax: 0.72,
    optCurve: true,
    optTolerance: 0.12,
    turnPolicy: 'minority'
  },
  balanced: {
    id: 'potrace-balanced',
    label: 'Potrace · Cân bằng',
    turdSize: 2,
    alphaMax: 0.95,
    optCurve: true,
    optTolerance: 0.20,
    turnPolicy: 'minority'
  },
  smooth: {
    id: 'potrace-smooth',
    label: 'Potrace · Mượt',
    turdSize: 2,
    alphaMax: 1.18,
    optCurve: true,
    optTolerance: 0.28,
    turnPolicy: 'minority'
  }
};

function normalizeSvgCanvas(svg, source) {
  return String(svg).replace(/<svg\b([^>]*)>/i, (_match, attributes) => {
    const next = attributes
      .replace(/\swidth=["'][^"']*["']/i, '')
      .replace(/\sheight=["'][^"']*["']/i, '')
      .replace(/\sviewBox=["'][^"']*["']/i, '');
    return `<svg${next} width="${source.width}" height="${source.height}" viewBox="0 0 ${source.traceWidth} ${source.traceHeight}">`;
  });
}

function traceWithPotrace(inputPath, params) {
  return new Promise((resolve, reject) => {
    let potrace;
    try {
      potrace = require('potrace');
    } catch (error) {
      const wrapped = new Error('Potrace runtime chưa được cài. Chạy npm install để cài dependency potrace.');
      wrapped.code = 'POTRACE_RUNTIME_MISSING';
      wrapped.cause = error;
      reject(wrapped);
      return;
    }

    const turnPolicyMap = {
      black: potrace.Potrace?.TURNPOLICY_BLACK ?? potrace.TURNPOLICY_BLACK,
      white: potrace.Potrace?.TURNPOLICY_WHITE ?? potrace.TURNPOLICY_WHITE,
      left: potrace.Potrace?.TURNPOLICY_LEFT ?? potrace.TURNPOLICY_LEFT,
      right: potrace.Potrace?.TURNPOLICY_RIGHT ?? potrace.TURNPOLICY_RIGHT,
      majority: potrace.Potrace?.TURNPOLICY_MAJORITY ?? potrace.TURNPOLICY_MAJORITY,
      minority: potrace.Potrace?.TURNPOLICY_MINORITY ?? potrace.TURNPOLICY_MINORITY
    };

    potrace.trace(inputPath, {
      threshold: 128,
      blackOnWhite: true,
      color: '#000000',
      background: 'transparent',
      turdSize: params.turdSize,
      alphaMax: params.alphaMax,
      optCurve: params.optCurve,
      optTolerance: params.optTolerance,
      turnPolicy: turnPolicyMap[params.turnPolicy] ?? turnPolicyMap.minority
    }, (error, svg) => {
      if (error) reject(error);
      else resolve(String(svg));
    });
  });
}

function selectedPotracePresets(strategy = 'smart') {
  if (strategy === 'detail') return [PRESETS.detail, PRESETS.balanced];
  if (strategy === 'compact') return [PRESETS.balanced];
  if (strategy === 'balanced') return [PRESETS.balanced, PRESETS.detail];
  return [PRESETS.balanced, PRESETS.detail, PRESETS.smooth];
}

async function buildPotraceCandidate({ inputPath, preset, source, optimize, assessSvg }) {
  const traced = await traceWithPotrace(inputPath, preset);
  const restored = normalizeSvgCanvas(traced, source);
  const optimized = String(await optimize(restored, {
    plugins: ['preset-default', { name: 'removeTitle' }],
    multipass: true,
    multipassIterations: 2
  }));

  return {
    id: preset.id,
    label: preset.label,
    preprocessing: {
      source: 'binary-mask-original-resolution',
      threshold: 128,
      paletteColors: 2
    },
    trace: {
      engine: 'potrace-js',
      algorithm: 'potrace',
      turdSize: preset.turdSize,
      alphaMax: preset.alphaMax,
      optCurve: preset.optCurve,
      optTolerance: preset.optTolerance,
      turnPolicy: preset.turnPolicy
    },
    reconstruction: null,
    geometryLock: null,
    metrics: await assessSvg(optimized),
    svg: optimized
  };
}

module.exports = {
  PRESETS,
  buildPotraceCandidate,
  normalizeSvgCanvas,
  selectedPotracePresets,
  traceWithPotrace
};

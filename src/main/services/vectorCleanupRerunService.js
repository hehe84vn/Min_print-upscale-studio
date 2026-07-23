'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { cleanupVectorSvg } = require('./vectorCleanupService');
const { inspectSvgComplexity } = require('./vectorLogoEngine');
const { validateSvgVisual } = require('./vectorVisualValidationService');

const CLEANUP_PROFILES = new Set(['auto', 'precise', 'balanced', 'smooth']);
const PROFILE_ORDER = ['precise', 'balanced', 'smooth'];

function masterPathForOutput(outputPath) {
  const parsed = path.parse(outputPath);
  return path.join(parsed.dir, `${parsed.name}.master.svg`);
}

function normalizeProfile(value) {
  return CLEANUP_PROFILES.has(value) ? value : 'balanced';
}

async function saveVectorMaster(outputPath, svg) {
  const masterPath = masterPathForOutput(outputPath);
  await fs.writeFile(masterPath, String(svg || ''), 'utf8');
  return masterPath;
}

function evaluateCandidate(profile, before, cleaned, after) {
  const stats = cleaned.stats;
  const pathLoss = Math.max(0, before.pathCount - after.pathCount);
  const pathLossRatio = before.pathCount > 0 ? pathLoss / before.pathCount : 0;
  const deviationRatio = stats.bezierErrorTolerance > 0
    ? stats.maximumBezierDeviation / stats.bezierErrorTolerance
    : 0;
  const nodeReduction = before.nodeEstimate > 0
    ? ((before.nodeEstimate - after.nodeEstimate) / before.nodeEstimate) * 100
    : 0;

  const rejectionReasons = [];
  if (stats.parseErrors > 0) rejectionReasons.push(`${stats.parseErrors} path parse lỗi`);
  if (stats.openSubpathsRemaining > 0) rejectionReasons.push(`${stats.openSubpathsRemaining} subpath hở`);
  if (pathLoss > Math.max(2, Math.ceil(before.pathCount * 0.08))) rejectionReasons.push(`mất ${pathLoss} path`);
  if (deviationRatio > 0.92) rejectionReasons.push('sai lệch Bézier sát tolerance');
  if (after.nodeEstimate <= 0 || after.pathCount <= 0) rejectionReasons.push('kết quả rỗng');

  const safetyScore = Math.max(0, 100
    - Math.min(38, deviationRatio * 32)
    - Math.min(32, pathLossRatio * 220)
    - Math.min(25, stats.openSubpathsRemaining * 5)
    - Math.min(35, stats.parseErrors * 12));
  const cleanupScore = Math.max(0, Math.min(100, 42 + nodeReduction * 1.45
    + Math.min(12, stats.collinearNodesRemoved * 0.15)
    + Math.min(8, stats.cubicPairsMerged * 0.35)));
  const profileBias = profile === 'balanced' ? 2.5 : profile === 'precise' ? 1 : 0;
  const score = Number((safetyScore * 0.74 + cleanupScore * 0.26 + profileBias).toFixed(2));

  return {
    profile,
    accepted: rejectionReasons.length === 0,
    rejectionReasons,
    score,
    safetyScore: Number(safetyScore.toFixed(2)),
    cleanupScore: Number(cleanupScore.toFixed(2)),
    nodeReduction: Number(nodeReduction.toFixed(2)),
    nodesAfter: after.nodeEstimate,
    pathCountAfter: after.pathCount,
    pathLoss,
    deviationRatio: Number(deviationRatio.toFixed(4)),
    maximumBezierDeviation: stats.maximumBezierDeviation,
    stats,
    svg: cleaned.svg
  };
}

function chooseAutomaticCandidate(candidates) {
  const accepted = candidates.filter((candidate) => candidate.accepted);
  if (accepted.length) return [...accepted].sort((left, right) => right.score - left.score)[0];
  return candidates.find((candidate) => candidate.profile === 'precise') || candidates[0];
}

function cleanupReport(profile, before, after, cleaned, extra = {}) {
  return {
    profile,
    nodesBefore: before.nodeEstimate,
    nodesAfter: after.nodeEstimate,
    nodeReduction: before.nodeEstimate > 0
      ? Number((((before.nodeEstimate - after.nodeEstimate) / before.nodeEstimate) * 100).toFixed(2))
      : 0,
    pathCountBefore: before.pathCount,
    pathCountAfter: after.pathCount,
    svgBytesBefore: before.svgBytes,
    svgBytesAfter: after.svgBytes,
    ...cleaned.stats,
    ...extra
  };
}

function masterStats(before) {
  return {
    profile: 'master',
    pathCountBefore: before.pathCount,
    pathCountAfter: before.pathCount,
    duplicatePathsRemoved: 0,
    tinyPathsRemoved: 0,
    microSegmentsRemoved: 0,
    curvesConvertedToLines: 0,
    axisSnaps: 0,
    collinearNodesRemoved: 0,
    tangentJunctionsSmoothed: 0,
    cubicPairsMerged: 0,
    maximumBezierDeviation: 0,
    autoClosedSubpaths: 0,
    openSubpathsRemaining: 0,
    parseErrors: 0
  };
}

async function enforceVisualValidation(masterSvg, selectedProfile, cleaned, before, pathPrecision, options, onProgress) {
  if (options.visualValidation === false) {
    return { selectedProfile, cleaned, after: inspectSvgComplexity(cleaned.svg), visualValidation: { skipped: true } };
  }

  onProgress?.(72, 'Đang so sánh pixel Master SVG và Clean SVG');
  const initial = await validateSvgVisual(masterSvg, cleaned.svg, options.visualValidationOptions || {});
  if (initial.accepted) {
    return {
      selectedProfile,
      cleaned,
      after: inspectSvgComplexity(cleaned.svg),
      visualValidation: { ...initial, initialProfile: selectedProfile, finalProfile: selectedProfile, fallbackApplied: false }
    };
  }

  if (selectedProfile !== 'precise') {
    onProgress?.(82, 'Clean SVG lệch hình; đang fallback về Precise');
    const precise = cleanupVectorSvg(masterSvg, { profile: 'precise', pathPrecision });
    const preciseValidation = await validateSvgVisual(masterSvg, precise.svg, options.visualValidationOptions || {});
    if (preciseValidation.accepted) {
      return {
        selectedProfile: 'precise',
        cleaned: precise,
        after: inspectSvgComplexity(precise.svg),
        visualValidation: {
          ...preciseValidation,
          initialProfile: selectedProfile,
          finalProfile: 'precise',
          fallbackApplied: true,
          initialFailure: initial
        }
      };
    }
    initial.preciseFailure = preciseValidation;
  }

  return {
    selectedProfile: 'master',
    cleaned: { svg: masterSvg, stats: masterStats(before) },
    after: before,
    visualValidation: {
      accepted: true,
      initialProfile: selectedProfile,
      finalProfile: 'master',
      fallbackApplied: true,
      preservedMaster: true,
      initialFailure: initial,
      reasons: ['Cleanup không vượt Visual Validation; giữ nguyên Master SVG.']
    }
  };
}

async function rerunVectorCleanup({ inputPath, outputPath, options = {}, onProgress }) {
  if (!inputPath || !outputPath) throw new Error('Thiếu Master SVG hoặc đường dẫn file đầu ra.');
  const requestedProfile = normalizeProfile(options.profile);
  onProgress?.(12, `Đang đọc Master SVG · ${requestedProfile}`);
  const masterSvg = await fs.readFile(inputPath, 'utf8');
  const before = inspectSvgComplexity(masterSvg);
  const pathPrecision = Number(options.pathPrecision) || 3;

  let selectedProfile = requestedProfile;
  let cleaned;
  let after;
  let autoSelection = null;

  if (requestedProfile === 'auto') {
    onProgress?.(34, 'Đang thử Precise, Balanced và Smooth trên cùng Master SVG');
    const candidates = PROFILE_ORDER.map((profile) => {
      const candidateCleaned = cleanupVectorSvg(masterSvg, { profile, pathPrecision });
      const candidateAfter = inspectSvgComplexity(candidateCleaned.svg);
      return evaluateCandidate(profile, before, candidateCleaned, candidateAfter);
    });
    const selected = chooseAutomaticCandidate(candidates);
    selectedProfile = selected.profile;
    cleaned = { svg: selected.svg, stats: selected.stats };
    after = inspectSvgComplexity(cleaned.svg);
    autoSelection = {
      requestedProfile: 'auto',
      initialSelectedProfile: selectedProfile,
      selectedProfile,
      fallbackToPrecise: !selected.accepted,
      candidates: candidates.map(({ svg, stats, ...candidate }) => candidate)
    };
  } else {
    onProgress?.(48, 'Đang tối ưu path và Bézier mà không trace lại');
    cleaned = cleanupVectorSvg(masterSvg, { profile: selectedProfile, pathPrecision });
    after = inspectSvgComplexity(cleaned.svg);
  }

  const validated = await enforceVisualValidation(masterSvg, selectedProfile, cleaned, before, pathPrecision, options, onProgress);
  selectedProfile = validated.selectedProfile;
  cleaned = validated.cleaned;
  after = validated.after;
  if (autoSelection) autoSelection.selectedProfile = selectedProfile;

  await fs.writeFile(outputPath, cleaned.svg, 'utf8');
  const report = cleanupReport(selectedProfile, before, after, cleaned, {
    ...(autoSelection ? { autoSelection } : {}),
    visualValidation: validated.visualValidation
  });

  onProgress?.(100, `Cleanup ${selectedProfile} hoàn tất · ${before.nodeEstimate} → ${after.nodeEstimate} node`);
  return {
    outputPath,
    masterPath: inputPath,
    requestedProfile,
    selectedProfile,
    vectorCleanup: report
  };
}

module.exports = {
  CLEANUP_PROFILES,
  PROFILE_ORDER,
  chooseAutomaticCandidate,
  enforceVisualValidation,
  evaluateCandidate,
  masterPathForOutput,
  normalizeProfile,
  rerunVectorCleanup,
  saveVectorMaster
};

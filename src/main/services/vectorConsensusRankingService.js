'use strict';

const { validateSvgVisual } = require('./vectorVisualValidationService');

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function pairAgreement(validation) {
  const metrics = validation?.metrics || {};
  const shape = finite(metrics.shapeIoU, 0) * 100;
  const changedPenalty = Math.min(45, finite(metrics.changedForegroundRatio, 1) * 120);
  const colorPenalty = Math.min(20, finite(metrics.meanChannelDelta, 255) * 1.5);
  return Math.max(0, Math.min(100, shape - changedPenalty - colorPenalty));
}

async function rankCandidatesByConsensus(candidates, options = {}) {
  const usable = (candidates || []).filter((candidate) => candidate?.svg);
  if (usable.length < 2) {
    return usable.map((candidate) => ({
      ...candidate,
      consensus: { available: false, agreementScore: null, peerCount: 0 },
      consensusScore: finite(candidate.score)
    }));
  }

  const agreements = new Map(usable.map((candidate) => [candidate.id, []]));
  for (let leftIndex = 0; leftIndex < usable.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < usable.length; rightIndex += 1) {
      const left = usable[leftIndex];
      const right = usable[rightIndex];
      let validation;
      try {
        validation = await validateSvgVisual(left.svg, right.svg, {
          renderSize: Number(options.renderSize) || 640,
          minimumShapeIoU: 0,
          maximumChangedPixelRatio: 1,
          maximumChangedForegroundRatio: 1,
          maximumMeanChannelDelta: 255
        });
      } catch (error) {
        validation = { metrics: null, error: error.message || String(error) };
      }
      const agreement = validation.metrics ? pairAgreement(validation) : 0;
      agreements.get(left.id).push({ peerId: right.id, peerEngine: right.engine, agreement, metrics: validation.metrics, error: validation.error || null });
      agreements.get(right.id).push({ peerId: left.id, peerEngine: left.engine, agreement, metrics: validation.metrics, error: validation.error || null });
    }
  }

  return usable.map((candidate) => {
    const peers = agreements.get(candidate.id) || [];
    const agreementScore = peers.length
      ? peers.reduce((total, peer) => total + peer.agreement, 0) / peers.length
      : 0;
    const baseScore = finite(candidate.score);
    const consensusBoost = (agreementScore - 50) * 0.16;
    const consensusScore = Number((baseScore + consensusBoost).toFixed(2));
    return {
      ...candidate,
      consensusScore,
      consensus: {
        available: true,
        agreementScore: Number(agreementScore.toFixed(2)),
        consensusBoost: Number(consensusBoost.toFixed(2)),
        peerCount: peers.length,
        peers
      }
    };
  }).sort((left, right) => {
    if (Boolean(left.rejected) !== Boolean(right.rejected)) return left.rejected ? 1 : -1;
    return finite(right.consensusScore) - finite(left.consensusScore);
  });
}

module.exports = {
  pairAgreement,
  rankCandidatesByConsensus
};

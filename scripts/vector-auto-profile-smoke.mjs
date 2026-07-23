import assert from 'node:assert/strict';
import serviceModule from '../src/main/services/vectorCleanupRerunService.js';

const { chooseAutomaticCandidate, evaluateCandidate, normalizeProfile } = serviceModule;

assert.equal(normalizeProfile('auto'), 'auto');
assert.equal(normalizeProfile('unknown'), 'balanced');

const before = { nodeEstimate: 100, pathCount: 10, svgBytes: 1000 };
const candidate = (profile, nodesAfter, overrides = {}) => evaluateCandidate(
  profile,
  before,
  {
    svg: '<svg/>',
    stats: {
      bezierErrorTolerance: 1,
      maximumBezierDeviation: 0.2,
      openSubpathsRemaining: 0,
      parseErrors: 0,
      collinearNodesRemoved: 10,
      cubicPairsMerged: 3,
      ...overrides
    }
  },
  { nodeEstimate: nodesAfter, pathCount: 10, svgBytes: 800 }
);

const precise = candidate('precise', 88);
const balanced = candidate('balanced', 70);
const smoothUnsafe = candidate('smooth', 52, { maximumBezierDeviation: 0.98 });
const selected = chooseAutomaticCandidate([precise, balanced, smoothUnsafe]);

assert.equal(smoothUnsafe.accepted, false, 'Smooth must be rejected when Bézier deviation approaches tolerance.');
assert.equal(selected.profile, 'balanced', 'Balanced should win when it removes more nodes without crossing the Safety Gate.');

const allRejected = [
  candidate('precise', 90, { parseErrors: 1 }),
  candidate('balanced', 70, { parseErrors: 1 }),
  candidate('smooth', 50, { parseErrors: 1 })
];
assert.equal(chooseAutomaticCandidate(allRejected).profile, 'precise', 'Auto must fall back to Precise when every candidate fails.');

console.log(`Vector auto profile OK: selected ${selected.profile} score ${selected.score}; unsafe Smooth rejected.`);
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { pairAgreement, rankCandidatesByConsensus } = require('../src/main/services/vectorConsensusRankingService');

const reference = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 120"><path fill="#126b43" d="M20 20H180V100H20Z"/></svg>';
const near = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 120"><path fill="#126b43" d="M21 20H180V100H21Z"/></svg>';
const outlier = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 120"><circle fill="#e23232" cx="100" cy="60" r="28"/></svg>';

assert.ok(pairAgreement({ metrics: { shapeIoU: 1, changedForegroundRatio: 0, meanChannelDelta: 0 } }) > 99);

const ranked = await rankCandidatesByConsensus([
  { id: 'vtracer', engine: 'vtracer', label: 'VTracer', score: 80, rejected: false, svg: reference },
  { id: 'autotrace', engine: 'autotrace', label: 'AutoTrace', score: 79, rejected: false, svg: near },
  { id: 'outlier', engine: 'test', label: 'Outlier', score: 82, rejected: false, svg: outlier }
], { renderSize: 512 });

const winner = ranked[0];
const outlierRank = ranked.find((candidate) => candidate.id === 'outlier');
assert.notEqual(winner.id, 'outlier', 'A visually isolated candidate must not win only from its base score.');
assert.ok(winner.consensus.available);
assert.ok(winner.consensus.agreementScore > outlierRank.consensus.agreementScore);
assert.ok(ranked.every((candidate) => !Object.hasOwn(candidate.consensus, 'svg')));

const single = await rankCandidatesByConsensus([{ id: 'solo', engine: 'vtracer', score: 55, svg: reference }]);
assert.equal(single[0].consensus.available, false);
assert.equal(single[0].consensusScore, 55);

console.log(`Vector consensus ranking OK: ${winner.id} wins, outlier agreement ${outlierRank.consensus.agreementScore}.`);

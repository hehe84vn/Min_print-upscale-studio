import assert from 'node:assert/strict';
import adaptiveModule from '../src/main/services/vectorAdaptiveFittingService.js';
import cleanupModule from '../src/main/services/vectorCleanupService.js';
import geometryModule from '../src/main/services/vectorGeometryLock.js';

const { adaptiveFittingOptions, analyzeAdaptivePath, fitEllipseIfEligible } = adaptiveModule;
const { cleanupVectorSvg } = cleanupModule;
const { parsePathData } = geometryModule;

const textSegments = parsePathData('M10 90L10 10L35 10L35 42L65 42L65 10L90 10L90 90L65 90L65 58L35 58L35 90Z');
const textAnalysis = analyzeAdaptivePath(textSegments, { width: 500, height: 500 });
const textOptions = adaptiveFittingOptions(textAnalysis, { errorTolerance: 1, smoothAngleDegrees: 12, mergeAngleDegrees: 5 });
assert.equal(textAnalysis.textLike, true, 'Small angular paths must be treated as typography-like geometry.');
assert.equal(textOptions.skipBezierMerge, true, 'Typography corners must not be merged into soft curves.');
assert.ok(textOptions.errorTolerance < 1, 'Typography must use tighter fitting tolerance.');

const ellipseSegments = parsePathData('M100 50C100 77.614 77.614 100 50 100C22.386 100 0 77.614 0 50C0 22.386 22.386 0 50 0C77.614 0 100 22.386 100 50Z');
const ellipseAnalysis = analyzeAdaptivePath(ellipseSegments, { width: 500, height: 500 });
const ellipse = fitEllipseIfEligible(ellipseSegments, ellipseAnalysis, { minimumEllipseSegments: 4, maximumEllipseResidual: 0.07 });
assert.equal(ellipse.fitted, true, 'Clean ellipse-like contours must be normalized to four cubic segments.');
assert.equal(ellipse.segments.filter((segment) => segment.type === 'C').length, 4);

const svg = '<svg viewBox="0 0 500 500"><path fill="#111" d="M10 90L10 10L35 10L35 42L65 42L65 10L90 10L90 90L65 90L65 58L35 58L35 90Z"/><path fill="#0a0" d="M300 150C300 205.228 255.228 250 200 250C144.772 250 100 205.228 100 150C100 94.772 144.772 50 200 50C255.228 50 300 94.772 300 150Z"/></svg>';
const cleaned = cleanupVectorSvg(svg, { profile: 'balanced', minimumEllipseSegments: 4, maximumEllipseResidual: 0.07 });
assert.equal(cleaned.stats.parseErrors, 0);
assert.ok(cleaned.stats.adaptiveTextPaths >= 1, 'Cleanup must report typography-aware paths.');
assert.ok(cleaned.stats.cornerProtectedPaths >= 1, 'Cleanup must protect sharp text corners.');
assert.ok(cleaned.stats.ellipsesRecognized >= 1, 'Cleanup must report recognized ellipses.');
assert.match(cleaned.svg, /<path/);

console.log(`Adaptive fitting V11 OK: ${cleaned.stats.adaptiveTextPaths} text path, ${cleaned.stats.cornerProtectedPaths} corner-protected, ${cleaned.stats.ellipsesRecognized} ellipse.`);

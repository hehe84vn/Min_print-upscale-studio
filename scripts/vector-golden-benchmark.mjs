import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { runGoldenBenchmark } = require('../src/main/services/vectorGoldenBenchmarkService');

const rootDirectory = path.resolve(process.argv[2] || 'benchmarks/vector-golden');
const outputDirectory = path.resolve(process.argv[3] || 'benchmark-results/vector-golden');
const summary = await runGoldenBenchmark({
  rootDirectory,
  outputDirectory,
  version: process.env.GITHUB_SHA || process.env.npm_package_version || 'dev'
});
console.log(`Golden benchmark: ${summary.passed}/${summary.total} passed`);
console.log(`Report: ${path.join(outputDirectory, 'report.html')}`);
if (!summary.pass) process.exitCode = 1;

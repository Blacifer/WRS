/**
 * Unified E2E Test Runner for Indian Railways WRS Raipur
 * Spring Classification & Inspection System (RDSO G-95 Rev-II), Phase 2 Wagon QC, and Phase 3 Advanced Systems
 *
 * Runs test suites across Tiers 1-5 with formatted summary reports,
 * execution timing, TAP v13 metric parsing, and strict exit code signals.
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

export const SUITES = {
  tier1: [
    // Phase 1 Spring System
    'tests/e2e/tier1-features/r1_classification.test.ts',
    'tests/e2e/tier1-features/r2_measurement_ocr.test.ts',
    'tests/e2e/tier1-features/r3_audit_logging.test.ts',
    'tests/e2e/tier1-features/r4_rbac_security.test.ts',
    'tests/e2e/tier1-features/r5_bilingual_i18n.test.ts',
    'tests/e2e/tier1-features/r6_mobile_offline.test.ts',
    // Phase 2 Wagon QC & Lifecycle
    'tests/e2e/tier1-features/phase2_r1_lifecycle.test.ts',
    'tests/e2e/tier1-features/phase2_r2_checklist.test.ts',
    'tests/e2e/tier1-features/phase2_r3_exit_gate.test.ts',
    'tests/e2e/tier1-features/phase2_r4_analytics.test.ts',
    'tests/e2e/tier1-features/phase2_r5_phase1_integration.test.ts',
    'tests/e2e/tier1-features/phase2_r6_photo_offline.test.ts',
    // Phase 3 Features (R1 to R5)
    'tests/e2e/tier1-features/phase3_voice_ui.test.ts',
    'tests/e2e/tier1-features/phase3_cv_ar_vision.test.ts',
    'tests/e2e/tier1-features/phase3_acoustic_diagnostics.test.ts',
    'tests/e2e/tier1-features/phase3_component_passports.test.ts'
  ],
  tier2: [
    // Phase 1
    'tests/e2e/tier2-boundary/rdso_tables_28_33.test.ts',
    'tests/e2e/tier2-boundary/boundary_resolution.test.ts',
    'tests/e2e/tier2-boundary/condemnation_limits.test.ts',
    'tests/e2e/tier2-boundary/corner_adversarial.test.ts',
    'tests/e2e/tier2-boundary/rdso_adversarial_stress.test.ts',
    // Phase 2
    'tests/e2e/tier2-boundary/phase2_boundary_corner.test.ts'
  ],
  tier3: [
    // Phase 1
    'tests/e2e/tier3-cross-feature/ocr_classify_audit_flow.test.ts',
    'tests/e2e/tier3-cross-feature/supervisor_override_flow.test.ts',
    'tests/e2e/tier3-cross-feature/filter_analytics_flow.test.ts',
    'tests/e2e/tier3-cross-feature/bilingual_audit_flow.test.ts',
    // Phase 2
    'tests/e2e/tier3-cross-feature/phase2_cross_feature.test.ts'
  ],
  tier4: [
    // Phase 1
    'tests/e2e/tier4-scenarios/workshop_batch_simulation.test.ts',
    'tests/e2e/tier4-scenarios/offline_sync_batch.test.ts',
    'tests/e2e/tier4-scenarios/audit_export_otp.test.ts',
    'tests/e2e/tier4-scenarios/security_violations.test.ts',
    // Phase 2
    'tests/e2e/tier4-scenarios/phase2_workshop_simulation.test.ts'
  ],
  tier5: [
    'tests/e2e/tier5-adversarial/offline_sync_stress.test.ts',
    'tests/e2e/tier5-adversarial/highload_multishift_simulation.test.ts',
    'tests/e2e/tier5-adversarial/rdso_dynamic_boundary_sweeps.test.ts',
    'tests/e2e/tier5-adversarial/phase2_challenger2_empirical.test.ts',
    'tests/e2e/tier5-adversarial/phase2_adversarial_stress.test.ts',
    'tests/e2e/tier5-adversarial/phase3_component_passports_adversarial.test.ts'
  ],
  phase2: [
    'tests/e2e/tier1-features/phase2_r1_lifecycle.test.ts',
    'tests/e2e/tier1-features/phase2_r2_checklist.test.ts',
    'tests/e2e/tier1-features/phase2_r3_exit_gate.test.ts',
    'tests/e2e/tier1-features/phase2_r4_analytics.test.ts',
    'tests/e2e/tier1-features/phase2_r5_phase1_integration.test.ts',
    'tests/e2e/tier1-features/phase2_r6_photo_offline.test.ts',
    'tests/e2e/tier2-boundary/phase2_boundary_corner.test.ts',
    'tests/e2e/tier3-cross-feature/phase2_cross_feature.test.ts',
    'tests/e2e/tier4-scenarios/phase2_workshop_simulation.test.ts',
    'tests/e2e/tier5-adversarial/phase2_challenger2_empirical.test.ts',
    'tests/e2e/tier5-adversarial/phase2_adversarial_stress.test.ts'
  ],
  phase3: [
    'tests/e2e/tier1-features/phase3_voice_ui.test.ts',
    'tests/e2e/tier1-features/phase3_cv_ar_vision.test.ts',
    'tests/e2e/tier1-features/phase3_acoustic_diagnostics.test.ts',
    'tests/e2e/tier1-features/phase3_component_passports.test.ts',
    'tests/e2e/tier5-adversarial/phase3_component_passports_adversarial.test.ts'
  ]
};

export interface TestFileResult {
  file: string;
  passed: boolean;
  output: string;
  durationMs: number;
  testsCount: number;
  passCount: number;
  failCount: number;
  skipCount: number;
}

function parseTapMetrics(output: string): { testsCount: number; passCount: number; failCount: number; skipCount: number } {
  const testsMatch = output.match(/# tests\s+(\d+)/);
  const passMatch = output.match(/# pass\s+(\d+)/);
  const failMatch = output.match(/# fail\s+(\d+)/);
  const skipMatch = output.match(/# (?:skipped|cancelled|todo)\s+(\d+)/);

  const testsCount = testsMatch ? parseInt(testsMatch[1], 10) : 0;
  const passCount = passMatch ? parseInt(passMatch[1], 10) : 0;
  const failCount = failMatch ? parseInt(failMatch[1], 10) : 0;
  const skipCount = skipMatch ? parseInt(skipMatch[1], 10) : 0;

  return {
    testsCount: Math.max(testsCount, passCount + failCount + skipCount),
    passCount,
    failCount,
    skipCount
  };
}

async function runTestFile(filePath: string): Promise<TestFileResult> {
  const start = performance.now();
  return new Promise((resolve) => {
    const child = spawn('node', ['--test', filePath], {
      cwd: PROJECT_ROOT,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    child.on('close', (code) => {
      const durationMs = Math.round(performance.now() - start);
      const combined = stdout + stderr;
      const metrics = parseTapMetrics(combined);

      resolve({
        file: filePath,
        passed: code === 0,
        output: combined,
        durationMs,
        ...metrics
      });
    });
  });
}

function parseCliArgs(args: string[]): { target: string; json: boolean; verbose: boolean; filter?: string } {
  let target = 'all';
  let json = false;
  let verbose = false;
  let filter: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--json') {
      json = true;
    } else if (arg === '--verbose' || arg === '-v') {
      verbose = true;
    } else if (arg === '--filter' && i + 1 < args.length) {
      filter = args[++i];
    } else if (arg.startsWith('--filter=')) {
      filter = arg.substring('--filter='.length);
    } else if (arg === '--phase2' || arg === '-p2') {
      target = 'phase2';
    } else if (arg === '--phase3' || arg === '-p3') {
      target = 'phase3';
    } else if (arg === '--all' || arg === '-a') {
      target = 'all';
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else if (arg.startsWith('--tier=')) {
      const num = arg.split('=')[1];
      target = `tier${num}`;
    } else if (arg.startsWith('-t=')) {
      const num = arg.split('=')[1];
      target = `tier${num}`;
    } else if (arg === '--tier' || arg === '-t') {
      const nextArg = args[i + 1];
      if (nextArg && /^[1-5]$/.test(nextArg)) {
        target = `tier${nextArg}`;
        i++;
      }
    } else if (/^--tier[1-5]$/.test(arg)) {
      target = arg.replace('--', '');
    } else if (/^[1-5]$/.test(arg)) {
      target = `tier${arg}`;
    }
  }

  return { target, json, verbose, filter };
}

function printHelp() {
  console.log(`
Indian Railways WRS Raipur — E2E Test Suite Runner
Usage:
  bash tests/run_e2e.sh [options]
  node tests/runner.ts [options]

Options:
  --tier <1-5>       Run tests for specified tier (Tier 1 to Tier 5)
  --tier1 to --tier5 Run specific tier
  --phase2           Run all Phase 2 Wagon QC test suites
  --phase3           Run all Phase 3 AI/Voice/CV/Acoustic/Passports/OMRS test suites
  --all              Run complete test suite across all tiers (default)
  --filter <pattern> Run test suites matching regex/substring pattern
  --json             Output summary in machine-readable JSON format
  --verbose, -v      Show full subtest logs
  --help, -h         Show this help message
`);
}

async function main() {
  const args = process.argv.slice(2);
  const { target, json, verbose, filter } = parseCliArgs(args);

  if (!json) {
    console.log('\n========================================================================');
    console.log('  INDIAN RAILWAYS — WAGON REPAIR SHOP (WRS) RAIPUR');
    console.log('  E2E Test Harness — Spring System, Wagon QC & Phase 3 AI Systems');
    console.log('========================================================================\n');
  }

  let filesToRun: string[] = [];
  if (target === 'all' || target === '--all') {
    filesToRun = [
      ...SUITES.tier1,
      ...SUITES.tier2,
      ...SUITES.tier3,
      ...SUITES.tier4,
      ...SUITES.tier5
    ];
  } else if (SUITES[target as keyof typeof SUITES]) {
    filesToRun = [...SUITES[target as keyof typeof SUITES]];
  } else {
    console.error(`Unknown target: ${target}. Use --tier 1-5, --tier1-5, --phase2, --phase3, or --all`);
    process.exit(1);
  }

  // Apply regex/substring filter if provided
  if (filter) {
    const reg = new RegExp(filter, 'i');
    filesToRun = filesToRun.filter(f => reg.test(f));
    if (filesToRun.length === 0) {
      console.error(`No test files matched filter: "${filter}"`);
      process.exit(1);
    }
  }

  if (!json) {
    console.log(`Target: ${target.toUpperCase()} | Executing ${filesToRun.length} test suite(s)...\n`);
  }

  let totalSuitesPassed = 0;
  let totalSuitesFailed = 0;
  let totalTestCases = 0;
  let totalTestPassed = 0;
  let totalTestFailed = 0;
  let totalTestSkipped = 0;
  const results: TestFileResult[] = [];

  const overallStartTime = performance.now();

  for (const file of filesToRun) {
    const res = await runTestFile(file);
    results.push(res);

    totalTestCases += res.testsCount;
    totalTestPassed += res.passCount;
    totalTestFailed += res.failCount;
    totalTestSkipped += res.skipCount;

    if (res.passed) {
      totalSuitesPassed++;
    } else {
      totalSuitesFailed++;
    }

    if (!json) {
      const symbol = res.passed ? '✅ PASS' : '❌ FAIL';
      const countLabel = res.testsCount > 0 ? `(${res.passCount}/${res.testsCount} tests passed)` : '';
      console.log(`  ${symbol}  ${res.file.padEnd(65)} ${countLabel.padEnd(25)} (${res.durationMs}ms)`);
      if (!res.passed || verbose) {
        console.log('\n--- Output Details ---');
        console.log(res.output);
        console.log('----------------------\n');
      }
    }
  }

  const totalDurationMs = Math.round(performance.now() - overallStartTime);

  if (json) {
    const summary = {
      target,
      totalSuites: filesToRun.length,
      suitesPassed: totalSuitesPassed,
      suitesFailed: totalSuitesFailed,
      totalTests: totalTestCases,
      testsPassed: totalTestPassed,
      testsFailed: totalTestFailed,
      testsSkipped: totalTestSkipped,
      totalDurationMs,
      allPassed: totalSuitesFailed === 0 && totalTestFailed === 0,
      suites: results.map(r => ({
        file: r.file,
        passed: r.passed,
        durationMs: r.durationMs,
        testsCount: r.testsCount,
        passCount: r.passCount,
        failCount: r.failCount,
        skipCount: r.skipCount
      }))
    };
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log('\n========================================================================');
    console.log('  TEST EXECUTION SUMMARY');
    console.log('========================================================================');
    console.log(`  Target Mode           : ${target.toUpperCase()}`);
    console.log(`  Total Suites Executed : ${filesToRun.length}`);
    console.log(`  Suites Passed         : ${totalSuitesPassed}`);
    console.log(`  Suites Failed         : ${totalSuitesFailed}`);
    console.log(`  Total Test Cases      : ${totalTestCases}`);
    console.log(`  Tests Passed          : ${totalTestPassed}`);
    console.log(`  Tests Failed          : ${totalTestFailed}`);
    console.log(`  Tests Skipped         : ${totalTestSkipped}`);
    console.log(`  Pass Rate             : ${totalTestCases > 0 ? ((totalTestPassed / totalTestCases) * 100).toFixed(1) : (totalSuitesFailed === 0 ? '100.0' : '0.0')}%`);
    console.log(`  Total Execution Time  : ${totalDurationMs}ms`);
    console.log(`  Overall Status        : ${totalSuitesFailed === 0 && totalTestFailed === 0 ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED'}`);
    console.log('========================================================================\n');
  }

  if (totalSuitesFailed > 0 || totalTestFailed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Test runner encountered unexpected error:', err);
  process.exit(1);
});

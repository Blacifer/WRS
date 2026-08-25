/**
 * Client test configuration
 * Indian Railways WRS Raipur
 *
 * The interface was 20,000 lines with no automated tests at all, and every
 * defect in it had to be found by driving a browser by hand. These tests cover
 * the two things that discipline missed most often: pure logic that decides
 * something (thresholds, parsing, classification), and whether a feature the
 * server offers can actually be reached from the interface at all.
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'tests/**/*.test.ts'],
    passWithNoTests: false
  }
});

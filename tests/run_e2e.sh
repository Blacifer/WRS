#!/usr/bin/env bash
# ==============================================================================
# Indian Railways WRS Raipur — Spring Classification & Inspection System
# E2E Test Suite Runner Script (RDSO G-95 Rev-II)
# ==============================================================================

set -e

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
PROJECT_ROOT="$( dirname "$DIR" )"

cd "$PROJECT_ROOT"

# Ensure test fixtures exist
if [ ! -f "tests/fixtures/caliper_260_00.svg" ]; then
  echo "Generating test fixtures..."
  node tests/fixtures/generate_fixtures.js
fi

# Run test runner with arguments
node tests/runner.ts "$@"

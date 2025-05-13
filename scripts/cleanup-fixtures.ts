#!/usr/bin/env node

/**
 * This script is used to reset the test fixtures directory to its original state
 * after integration tests run, ensuring clean state for the next test run.
 */

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// Define the fixtures directory
const fixturesDir = join(process.cwd(), 'test/fixtures');

if (!existsSync(fixturesDir)) {
  console.error('Fixtures directory not found at', fixturesDir);
  process.exit(1);
}

try {
  console.log('Resetting test fixtures to match git repository...');

  // Check if there are any changes in fixtures to avoid unnecessary git operations
  const changes: string = execSync('git status --porcelain=v1 test/fixtures', { encoding: 'utf8' });

  if (!changes.trim()) {
    console.log('No changes detected in fixtures directory, nothing to reset.');
    process.exit(0);
  }

  // Discard all changes in the fixtures directory
  execSync('git checkout -- test/fixtures', { stdio: 'inherit' });

  // Clean any untracked files in fixtures directory
  execSync('git clean -fd test/fixtures', { stdio: 'inherit' });

  console.log('✅ Successfully reset test fixtures to original state.');
} catch (error) {
  console.error(
    '❌ Error resetting test fixtures:',
    error instanceof Error ? error.message : String(error),
  );
  process.exit(1);
}

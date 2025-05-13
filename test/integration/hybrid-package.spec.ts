import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as TOML from 'smol-toml';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { updatePackageVersion } from '../../src/package/packageManagement.js';
import { restoreFixtureState, saveFixtureState } from '../utils/file-utils.js';

/**
 * Fixture paths
 */
const FIXTURES_DIR = join(process.cwd(), 'test/fixtures');
const HYBRID_PACKAGE_FIXTURE = join(FIXTURES_DIR, 'hybrid-package');

/**
 * Helper to get version from Cargo.toml
 */
function getCargoVersion(dir: string): string {
  const cargoPath = join(dir, 'Cargo.toml');
  const content = readFileSync(cargoPath, 'utf8');
  const cargo = TOML.parse(content) as { package: { version: string } };
  return cargo.package.version;
}

/**
 * Helper to get version from package.json
 */
function getPackageJsonVersion(dir: string): string {
  const pkgPath = join(dir, 'package.json');
  const content = readFileSync(pkgPath, 'utf8');
  const pkg = JSON.parse(content);
  return pkg.version;
}

/**
 * Directly update both package files with a version
 */
function updateBothManifests(dir: string, version: string): void {
  const packageJsonPath = join(dir, 'package.json');
  const cargoTomlPath = join(dir, 'Cargo.toml');

  if (existsSync(packageJsonPath)) {
    updatePackageVersion(packageJsonPath, version);
  }

  if (existsSync(cargoTomlPath)) {
    updatePackageVersion(cargoTomlPath, version);
  }
}

describe('Hybrid Package Tests', () => {
  // Save original fixture state
  beforeAll(() => {
    saveFixtureState(FIXTURES_DIR);
  });

  // Clean up after tests
  afterAll(() => {
    restoreFixtureState(FIXTURES_DIR);
  });

  describe('Version Updates', () => {
    beforeEach(() => {
      // No need for Git operations
    });

    afterEach(() => {
      // No special cleanup needed
    });

    it('should update both package.json and Cargo.toml with the same version', () => {
      // Check initial versions
      const initialPkgVersion = getPackageJsonVersion(HYBRID_PACKAGE_FIXTURE);
      const initialCargoVersion = getCargoVersion(HYBRID_PACKAGE_FIXTURE);

      expect(initialPkgVersion).toBe('0.1.0');
      expect(initialCargoVersion).toBe('0.1.0');

      // Directly update both files with new version
      const newVersion = '0.1.1';
      updateBothManifests(HYBRID_PACKAGE_FIXTURE, newVersion);

      // Check package.json version
      const pkgVersion = getPackageJsonVersion(HYBRID_PACKAGE_FIXTURE);
      expect(pkgVersion).toBe('0.1.1');

      // Check Cargo.toml version - this is where we expect to see the bug fixed
      const cargoVersion = getCargoVersion(HYBRID_PACKAGE_FIXTURE);
      expect(cargoVersion).toBe('0.1.1');

      // Both versions should match
      expect(pkgVersion).toBe(cargoVersion);
    });
  });
});

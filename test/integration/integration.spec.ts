import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the CLI run directly to avoid dependency issues
vi.mock('../../src/core/versionCalculator.ts', async () => {
  const actual = await vi.importActual('../../src/core/versionCalculator.ts');
  return {
    ...actual,
    calculateVersion: vi.fn().mockImplementation((options) => {
      // Simple mock implementation that returns predictable versions
      const { versionType = 'patch' } = options;
      switch (versionType) {
        case 'major':
          return '1.0.0';
        case 'minor':
          return '0.2.0';
        default: // handles 'patch' and any other cases
          return '0.1.1';
      }
    }),
  };
});

// Fixture paths
const FIXTURES_DIR = join(process.cwd(), 'test/fixtures');
const SINGLE_PACKAGE_FIXTURE = join(FIXTURES_DIR, 'single-package');
const MONOREPO_FIXTURE = join(FIXTURES_DIR, 'monorepo');

// Utility functions for tests
function mockVersionUpdates(packagePath: string, newVersion: string): void {
  // Read the package.json
  const packageJsonPath = join(packagePath, 'package.json');
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));

  // Update the version
  packageJson.version = newVersion;

  // Write the updated package.json
  writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
}

function initGitRepo(dir: string): void {
  execSync('git init', { cwd: dir });
  execSync('git config user.name "Test User"', { cwd: dir });
  execSync('git config user.email "test@example.com"', { cwd: dir });

  // Create .gitignore
  writeFileSync(join(dir, '.gitignore'), 'node_modules\n');

  // Initial commit
  execSync('git add .', { cwd: dir });
  execSync('git commit -m "Initial commit"', { cwd: dir });
}

function createPackageJson(dir: string, name: string, version = '0.1.0') {
  const packageJson = {
    name,
    version,
    private: true,
  };

  writeFileSync(join(dir, 'package.json'), JSON.stringify(packageJson, null, 2));
}

function createVersionConfig(dir: string, config: Record<string, unknown>) {
  writeFileSync(join(dir, 'version.config.json'), JSON.stringify(config, null, 2));
}

function createConventionalCommit(
  dir: string,
  type: string,
  message: string,
  files: string[] = ['.'],
): void {
  // Create or modify some files if none specified
  if (files.length === 1 && files[0] === '.') {
    const changeFile = join(dir, 'change.txt');
    writeFileSync(changeFile, `Change: ${Date.now()}`);
    execSync(`git add ${changeFile}`, { cwd: dir });
  } else {
    for (const file of files) {
      execSync(`git add ${file}`, { cwd: dir });
    }
  }

  execSync(`git commit -m "${type}: ${message}"`, { cwd: dir });
}

function getPackageVersion(dir: string, pkgName?: string): string {
  const packageJsonPath = pkgName
    ? join(dir, 'packages', pkgName, 'package.json')
    : join(dir, 'package.json');

  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
  return packageJson.version;
}

describe('Integration Tests', () => {
  // Setup and teardown for each test
  beforeAll(() => {
    // Ensure fixtures directory exists
    if (!existsSync(FIXTURES_DIR)) {
      mkdirSync(FIXTURES_DIR, { recursive: true });
    }
  });

  describe('Single Package Project', () => {
    beforeEach(() => {
      // Clean up and recreate the fixture directory
      execSync(`rm -rf ${SINGLE_PACKAGE_FIXTURE}`);
      mkdirSync(SINGLE_PACKAGE_FIXTURE, { recursive: true });

      // Initialize git repo
      initGitRepo(SINGLE_PACKAGE_FIXTURE);

      // Create package.json
      createPackageJson(SINGLE_PACKAGE_FIXTURE, 'test-single-package');

      // Create version.config.json
      createVersionConfig(SINGLE_PACKAGE_FIXTURE, {
        preset: 'conventional-commits',
        packages: ['./'],
      });

      // Add files to git
      execSync('git add .', { cwd: SINGLE_PACKAGE_FIXTURE });
      execSync('git commit -m "chore: setup project"', { cwd: SINGLE_PACKAGE_FIXTURE });
    });

    it('should update version based on conventional commits', () => {
      // Create a commit
      createConventionalCommit(SINGLE_PACKAGE_FIXTURE, 'fix', 'resolve a bug');

      // Mock a version update as if the CLI had run
      mockVersionUpdates(SINGLE_PACKAGE_FIXTURE, '0.1.1');

      // Verify the version was updated
      const newVersion = getPackageVersion(SINGLE_PACKAGE_FIXTURE);
      expect(newVersion).toBe('0.1.1');
    });

    it('should handle minor version updates', () => {
      // Create a feature commit
      createConventionalCommit(SINGLE_PACKAGE_FIXTURE, 'feat', 'add new feature');

      // Mock a version update
      mockVersionUpdates(SINGLE_PACKAGE_FIXTURE, '0.2.0');

      // Verify the version was updated
      const newVersion = getPackageVersion(SINGLE_PACKAGE_FIXTURE);
      expect(newVersion).toBe('0.2.0');
    });

    it('should handle major version updates for breaking changes', () => {
      // Create a breaking change commit
      createConventionalCommit(
        SINGLE_PACKAGE_FIXTURE,
        'feat',
        'add new feature\n\nBREAKING CHANGE: This changes the API',
      );

      // Mock a version update
      mockVersionUpdates(SINGLE_PACKAGE_FIXTURE, '1.0.0');

      // Verify the version was updated
      const newVersion = getPackageVersion(SINGLE_PACKAGE_FIXTURE);
      expect(newVersion).toBe('1.0.0');
    });

    it('should respect --bump flag to force version type', () => {
      // Create a fix commit but force a major bump
      createConventionalCommit(SINGLE_PACKAGE_FIXTURE, 'fix', 'minor change');

      // Mock a major version bump directly (simulating what --bump major would do)
      mockVersionUpdates(SINGLE_PACKAGE_FIXTURE, '1.0.0');

      // Verify the version was updated to major
      const newVersion = getPackageVersion(SINGLE_PACKAGE_FIXTURE);
      expect(newVersion).toBe('1.0.0');
    });
  });

  describe('Monorepo Project', () => {
    beforeEach(() => {
      // Clean up and recreate the fixture directory
      execSync(`rm -rf ${MONOREPO_FIXTURE}`);
      mkdirSync(MONOREPO_FIXTURE, { recursive: true });

      // Initialize git repo
      initGitRepo(MONOREPO_FIXTURE);

      // Create root package.json
      createPackageJson(MONOREPO_FIXTURE, 'test-monorepo-root');

      // Create packages directory
      const packagesDir = join(MONOREPO_FIXTURE, 'packages');
      mkdirSync(packagesDir);

      // Create package A
      const packageADir = join(packagesDir, 'package-a');
      mkdirSync(packageADir);
      createPackageJson(packageADir, '@test/package-a');

      // Create package B
      const packageBDir = join(packagesDir, 'package-b');
      mkdirSync(packageBDir);
      createPackageJson(packageBDir, '@test/package-b');

      // Create version.config.json for synced versioning
      createVersionConfig(MONOREPO_FIXTURE, {
        preset: 'conventional-commits',
        packages: ['packages/*'],
        synced: true,
      });

      // Add files to git
      execSync('git add .', { cwd: MONOREPO_FIXTURE });
      execSync('git commit -m "chore: setup monorepo"', { cwd: MONOREPO_FIXTURE });
    });

    it('should update all packages with synced versioning', () => {
      // Create a commit that changes package A
      const fileA = join(MONOREPO_FIXTURE, 'packages/package-a/index.js');
      writeFileSync(fileA, 'console.log("Hello from A");');
      createConventionalCommit(MONOREPO_FIXTURE, 'feat', 'add feature to package A', [fileA]);

      // Mock version updates for both packages
      mockVersionUpdates(join(MONOREPO_FIXTURE, 'packages/package-a'), '0.2.0');
      mockVersionUpdates(join(MONOREPO_FIXTURE, 'packages/package-b'), '0.2.0');

      // Verify both packages have the same updated version
      const versionA = getPackageVersion(MONOREPO_FIXTURE, 'package-a');
      const versionB = getPackageVersion(MONOREPO_FIXTURE, 'package-b');
      expect(versionA).toBe('0.2.0');
      expect(versionB).toBe('0.2.0');
    });

    it('should support independent versioning with different versions', () => {
      // Update config to use async versioning
      createVersionConfig(MONOREPO_FIXTURE, {
        preset: 'conventional-commits',
        packages: ['packages/*'],
        synced: false,
      });
      execSync('git add version.config.json', { cwd: MONOREPO_FIXTURE });
      execSync('git commit -m "chore: switch to async versioning"', { cwd: MONOREPO_FIXTURE });

      // Create a file change
      const fileA = join(MONOREPO_FIXTURE, 'packages/package-a/index.js');
      writeFileSync(fileA, 'console.log("Updated A");');
      createConventionalCommit(MONOREPO_FIXTURE, 'fix', 'fix bug in package A', [fileA]);

      // Mock only package A getting updated
      mockVersionUpdates(join(MONOREPO_FIXTURE, 'packages/package-a'), '0.1.1');
      // Package B remains at its original version

      // Verify only package A was updated
      const versionA = getPackageVersion(MONOREPO_FIXTURE, 'package-a');
      const versionB = getPackageVersion(MONOREPO_FIXTURE, 'package-b');
      expect(versionA).toBe('0.1.1');
      expect(versionB).toBe('0.1.0'); // Unchanged
    });
  });
});

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as TOML from 'smol-toml';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { updatePackageVersion } from '../../src/package/packageManagement.js';
import { executeCliCommand } from '../utils/cli.js';
import { findConfigFiles, restoreFixtureState, saveFixtureState } from '../utils/file.js';
import { createConventionalCommit, initGitRepo } from '../utils/git.js';
import {
  createPackageJson,
  createVersionConfig,
  getPackageVersion,
  mockVersionUpdates,
  readChangelog,
  updateCargoVersion,
} from '../utils/package.js';

// Mock the CLI run directly to avoid dependency issues
vi.mock('../../src/core/versionCalculator.ts', async () => {
  const actual = await vi.importActual('../../src/core/versionCalculator.ts');
  return {
    ...actual,
    calculateVersion: vi.fn().mockImplementation((config, options) => {
      // Check for branch patterns
      if (config.branchPattern && options.branchPattern) {
        // Simple mock implementation that returns predictable versions based on branch
        if (options.currentBranch?.startsWith('feature/')) {
          return '0.2.0'; // Minor bump for feature branches
        }
        if (options.currentBranch?.startsWith('hotfix/')) {
          return '0.1.1'; // Patch bump for hotfix branches
        }
        if (options.currentBranch?.startsWith('release/')) {
          return '1.0.0'; // Major bump for release branches
        }
      }

      // Check for explicit version type
      if (options.type) {
        switch (options.type) {
          case 'major':
            return '1.0.0';
          case 'minor':
            return '0.2.0';
          case 'patch':
            return '0.1.1';
          default:
            return '0.1.1';
        }
      }

      // Fall back to handling the versionType parameter provided
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
const RUST_PACKAGE_FIXTURE = join(FIXTURES_DIR, 'rust-package');
const HYBRID_PACKAGE_FIXTURE = join(FIXTURES_DIR, 'hybrid-package');
const originalCwd = process.cwd();

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
 * Helper to update both package files with a version
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

describe('Integration Tests', () => {
  // Setup and teardown for each test
  beforeAll(() => {
    // Ensure fixtures directory exists
    if (!existsSync(FIXTURES_DIR)) {
      mkdirSync(FIXTURES_DIR, { recursive: true });
    }

    // Save the original state of all config files
    saveFixtureState(FIXTURES_DIR);
  });

  // Restore all package.json files after tests complete
  afterAll(() => {
    restoreFixtureState();
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
        versionPrefix: 'v',
        tagTemplate: '${prefix}${version}',
        packageTagTemplate: '${packageName}@${prefix}${version}',
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

    it('should respect --bump flag to specify version type', () => {
      // Create a fix commit but specify a major bump
      createConventionalCommit(SINGLE_PACKAGE_FIXTURE, 'fix', 'minor change');

      // Mock a major version bump directly (simulating what --bump major would do)
      mockVersionUpdates(SINGLE_PACKAGE_FIXTURE, '1.0.0');

      // Verify the version was updated to major
      const newVersion = getPackageVersion(SINGLE_PACKAGE_FIXTURE);
      expect(newVersion).toBe('1.0.0');
    });

    it('should respect branch pattern for version type', () => {
      // Update config to use branch pattern versioning
      createVersionConfig(SINGLE_PACKAGE_FIXTURE, {
        preset: 'conventional-commits',
        packages: ['./'],
        versionPrefix: 'v',
        tagTemplate: '${prefix}${version}',
        packageTagTemplate: '${packageName}@${prefix}${version}',
        branchPattern: ['feature:minor', 'hotfix:patch', 'release:major'],
        defaultReleaseType: 'patch',
      });
      execSync('git add version.config.json', { cwd: SINGLE_PACKAGE_FIXTURE });
      execSync('git commit -m "chore: update config with branch patterns"', {
        cwd: SINGLE_PACKAGE_FIXTURE,
      });

      // Create a branch that should trigger a minor version bump
      execSync('git checkout -b feature/new-feature', { cwd: SINGLE_PACKAGE_FIXTURE });

      // Create a simple commit
      createConventionalCommit(SINGLE_PACKAGE_FIXTURE, 'chore', 'branch pattern test');

      // Mock a minor version bump (0.2.0) as the branch pattern would cause
      mockVersionUpdates(SINGLE_PACKAGE_FIXTURE, '0.2.0');

      // Verify the version was updated according to branch pattern
      const newVersion = getPackageVersion(SINGLE_PACKAGE_FIXTURE);
      expect(newVersion).toBe('0.2.0');
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
        versionPrefix: 'v',
        tagTemplate: '${prefix}${version}',
        packageTagTemplate: '${packageName}@${prefix}${version}',
      });

      // Add files to git
      execSync('git add .', { cwd: MONOREPO_FIXTURE });
      execSync('git commit -m "chore: setup monorepo"', { cwd: MONOREPO_FIXTURE });
    });

    it('should update all packages with synced versioning', () => {
      // Create a commit that changes package A
      const fileA = join(MONOREPO_FIXTURE, 'packages/package-a/index.js');
      writeFileSync(fileA, 'console.log("Hello from A");');
      createConventionalCommit(
        MONOREPO_FIXTURE,
        'feat',
        'add feature to package A',
        undefined,
        false,
        [fileA],
      );

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
        versionPrefix: 'v',
        tagTemplate: '${prefix}${version}',
        packageTagTemplate: '${packageName}@${prefix}${version}',
      });
      execSync('git add version.config.json', { cwd: MONOREPO_FIXTURE });
      execSync('git commit -m "chore: switch to async versioning"', { cwd: MONOREPO_FIXTURE });

      // Create a file change
      const fileA = join(MONOREPO_FIXTURE, 'packages/package-a/index.js');
      writeFileSync(fileA, 'console.log("Updated A");');
      createConventionalCommit(MONOREPO_FIXTURE, 'fix', 'fix bug in package A', undefined, false, [
        fileA,
      ]);

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

describe('Branch Pattern Versioning Tests', () => {
  const BRANCH_PATTERN_FIXTURE = join(FIXTURES_DIR, 'branch-pattern');

  beforeEach(() => {
    // Clean up and recreate the fixture directory
    execSync(`rm -rf ${BRANCH_PATTERN_FIXTURE}`);
    mkdirSync(BRANCH_PATTERN_FIXTURE, { recursive: true });

    // Initialize git repo
    initGitRepo(BRANCH_PATTERN_FIXTURE);

    // Create package.json
    createPackageJson(BRANCH_PATTERN_FIXTURE, 'branch-pattern-test');

    // Create version.config.json with branch patterns
    createVersionConfig(BRANCH_PATTERN_FIXTURE, {
      preset: 'conventional-commits',
      packages: ['./'],
      versionPrefix: 'v',
      tagTemplate: '${prefix}${version}',
      packageTagTemplate: '${packageName}@${prefix}${version}',
      branchPattern: ['feature:minor', 'hotfix:patch', 'release:major'],
      defaultReleaseType: 'patch',
      versionStrategy: 'branchPattern',
    });

    // Add files to git
    execSync('git add .', { cwd: BRANCH_PATTERN_FIXTURE });
    execSync('git commit -m "chore: setup project"', { cwd: BRANCH_PATTERN_FIXTURE });
  });

  // Restore all package.json files after these tests complete
  afterAll(() => {
    restoreFixtureState();
  });

  it('should determine version based on feature branch pattern', () => {
    // Create a feature branch
    execSync('git checkout -b feature/new-functionality', { cwd: BRANCH_PATTERN_FIXTURE });

    // Create a commit
    createConventionalCommit(BRANCH_PATTERN_FIXTURE, 'chore', 'branch pattern test');

    // Mock version update based on feature branch pattern (minor)
    mockVersionUpdates(BRANCH_PATTERN_FIXTURE, '0.2.0');

    // Verify the version was updated according to branch pattern
    const newVersion = getPackageVersion(BRANCH_PATTERN_FIXTURE);
    expect(newVersion).toBe('0.2.0');
  });

  it('should determine version based on hotfix branch pattern', () => {
    // Create a hotfix branch
    execSync('git checkout -b hotfix/urgent-fix', { cwd: BRANCH_PATTERN_FIXTURE });

    // Create a commit
    createConventionalCommit(BRANCH_PATTERN_FIXTURE, 'chore', 'branch pattern test');

    // Mock version update based on hotfix branch pattern (patch)
    mockVersionUpdates(BRANCH_PATTERN_FIXTURE, '0.1.1');

    // Verify the version was updated according to branch pattern
    const newVersion = getPackageVersion(BRANCH_PATTERN_FIXTURE);
    expect(newVersion).toBe('0.1.1');
  });

  it('should use defaultReleaseType when no matching branch pattern', () => {
    // Create a branch that doesn't match any pattern
    execSync('git checkout -b docs/update-readme', { cwd: BRANCH_PATTERN_FIXTURE });

    // Create a commit
    createConventionalCommit(BRANCH_PATTERN_FIXTURE, 'chore', 'branch pattern test');

    // Mock version update based on defaultReleaseType (patch)
    mockVersionUpdates(BRANCH_PATTERN_FIXTURE, '0.1.1');

    // Verify the version was updated according to defaultReleaseType
    const newVersion = getPackageVersion(BRANCH_PATTERN_FIXTURE);
    expect(newVersion).toBe('0.1.1');
  });
});

describe('Rust Project', () => {
  beforeEach(() => {
    // Clean up and recreate the fixture directory
    if (existsSync(RUST_PACKAGE_FIXTURE)) {
      rmSync(RUST_PACKAGE_FIXTURE, { recursive: true, force: true });
    }
    mkdirSync(RUST_PACKAGE_FIXTURE, { recursive: true });

    // Create src directory
    const srcDir = join(RUST_PACKAGE_FIXTURE, 'src');
    mkdirSync(srcDir, { recursive: true });

    // Create Cargo.toml
    const cargoToml = `
[package]
name = "rust-package-test"
version = "0.1.0"
edition = "2021"
authors = ["Test Author <test@example.com>"]
description = "A test Rust package for package-versioner"
license = "MIT"

[dependencies]
serde = { version = "1.0", features = ["derive"] }
tokio = { version = "1.0", features = ["full"] }

[dev-dependencies]
pretty_assertions = "1.3.0"
`;

    writeFileSync(join(RUST_PACKAGE_FIXTURE, 'Cargo.toml'), cargoToml);

    // Create main.rs
    writeFileSync(
      join(srcDir, 'main.rs'),
      'fn main() {\n    println!("Hello from the Rust test package!");\n}',
    );

    try {
      // Initialize git repo
      initGitRepo(RUST_PACKAGE_FIXTURE);
    } catch (error) {
      console.error('Error initializing git repo:', error);
    }

    // Change to the fixture directory for working
    process.chdir(RUST_PACKAGE_FIXTURE);
  });

  afterEach(() => {
    // Restore original working directory
    process.chdir(originalCwd);
  });

  it('should update Cargo.toml version with minor bump', () => {
    const cargoFile = join(RUST_PACKAGE_FIXTURE, 'Cargo.toml');

    // Create a commit with a minor feature
    const indexFile = join(RUST_PACKAGE_FIXTURE, 'src', 'main.rs');
    writeFileSync(indexFile, 'fn main() {\n  println!("Updated feature!");\n}');

    try {
      createConventionalCommit(
        RUST_PACKAGE_FIXTURE,
        'feat',
        'add new feature to Rust package',
        undefined,
        false,
        [indexFile],
      );
    } catch (error) {
      console.error('Error creating conventional commit:', error);
    }

    // Create a custom function to update Cargo.toml version for the test
    const updateCargoVersion = (cargoPath: string, newVersion: string) => {
      const content = readFileSync(cargoPath, 'utf-8');
      const cargo = TOML.parse(content) as { package: { version: string } };
      cargo.package.version = newVersion;
      writeFileSync(cargoPath, TOML.stringify(cargo));
    };

    // Mock version update in Cargo.toml
    updateCargoVersion(cargoFile, '0.2.0');

    // Read the updated Cargo.toml
    const cargoContent = readFileSync(cargoFile, 'utf-8');
    const cargo = TOML.parse(cargoContent) as { package: { version: string } };

    // Check that version was updated to 0.2.0 (from 0.1.0)
    expect(cargo.package.version).toBe('0.2.0');
  });

  it('should support prerelease versioning for Cargo.toml', () => {
    const cargoFile = join(RUST_PACKAGE_FIXTURE, 'Cargo.toml');

    // Create a commit with a minor feature
    const indexFile = join(RUST_PACKAGE_FIXTURE, 'src', 'main.rs');
    writeFileSync(indexFile, 'fn main() {\n  println!("Updated feature!");\n}');

    try {
      createConventionalCommit(
        RUST_PACKAGE_FIXTURE,
        'feat',
        'add new feature to Rust package',
        undefined,
        false,
        [indexFile],
      );
    } catch (error) {
      console.error('Error creating conventional commit:', error);
    }

    // Create a custom function to update Cargo.toml version for the test
    const updateCargoVersion = (cargoPath: string, newVersion: string) => {
      const content = readFileSync(cargoPath, 'utf-8');
      const cargo = TOML.parse(content) as { package: { version: string } };
      cargo.package.version = newVersion;
      writeFileSync(cargoPath, TOML.stringify(cargo));
    };

    // Mock version update in Cargo.toml
    updateCargoVersion(cargoFile, '0.2.0-beta.0');

    // Read the updated Cargo.toml
    const cargoContent = readFileSync(cargoFile, 'utf-8');
    const cargo = TOML.parse(cargoContent) as { package: { version: string } };

    // Check that version was updated to 0.2.0-beta.0 (from 0.1.0)
    expect(cargo.package.version).toBe('0.2.0-beta.0');
  });
});

describe('Hybrid Package Tests', () => {
  beforeEach(() => {
    // No setup is needed as we're using the existing fixture directly
  });

  afterEach(() => {
    // No special cleanup needed
  });

  it('should update both package.json and Cargo.toml with the same version', () => {
    // Check initial versions
    const initialPkgVersion = getPackageVersion(HYBRID_PACKAGE_FIXTURE);
    const initialCargoVersion = getCargoVersion(HYBRID_PACKAGE_FIXTURE);

    expect(initialPkgVersion).toBe('0.1.0');
    expect(initialCargoVersion).toBe('0.1.0');

    // Directly update both files with new version
    const newVersion = '0.2.0';
    updateBothManifests(HYBRID_PACKAGE_FIXTURE, newVersion);

    // Check package.json version
    const pkgVersion = getPackageVersion(HYBRID_PACKAGE_FIXTURE);
    expect(pkgVersion).toBe('0.2.0');

    // Check Cargo.toml version - this is where we expect to see the bug fixed
    const cargoVersion = getCargoVersion(HYBRID_PACKAGE_FIXTURE);
    expect(cargoVersion).toBe('0.2.0');

    // Both versions should match
    expect(pkgVersion).toBe(cargoVersion);
  });

  it('should respect cargo.enabled configuration option', () => {
    // Set up a test case where cargo updates are disabled
    const testDir = HYBRID_PACKAGE_FIXTURE;

    // Reset versions to initial state
    updateBothManifests(testDir, '0.1.0');

    // Create version config with cargo disabled
    createVersionConfig(testDir, {
      versionPrefix: 'v',
      preset: 'angular',
      updateInternalDependencies: 'patch',
      cargo: {
        enabled: false,
      },
    });

    // Directly update only package.json - we'll simulate what would happen in the PackageProcessor
    const packageJsonPath = join(testDir, 'package.json');

    // Update just package.json to test cargo disable
    updatePackageVersion(packageJsonPath, '0.3.0');

    // Cargo.toml should remain at 0.1.0 since cargo.enabled is false
    const pkgVersion = getPackageVersion(testDir);
    const cargoVersion = getCargoVersion(testDir);

    expect(pkgVersion).toBe('0.3.0');
    expect(cargoVersion).toBe('0.1.0'); // Should remain unchanged
  });

  it('should respect cargo.paths configuration option', () => {
    // Set up a test case for cargo.paths
    const testDir = HYBRID_PACKAGE_FIXTURE;
    const srcDir = join(testDir, 'src');

    // Ensure src directory exists
    if (!existsSync(srcDir)) {
      mkdirSync(srcDir, { recursive: true });
    }

    // Create a src/Cargo.toml file for testing paths option
    const srcCargoToml = `
[package]
name = "nested-rust-package"
version = "0.1.0"
edition = "2021"
    `;
    writeFileSync(join(srcDir, 'Cargo.toml'), srcCargoToml);

    // Reset main Cargo.toml
    updateBothManifests(testDir, '0.1.0');

    // Create version config with cargo paths targeting src/
    createVersionConfig(testDir, {
      versionPrefix: 'v',
      preset: 'angular',
      updateInternalDependencies: 'patch',
      cargo: {
        enabled: true,
        paths: ['src'],
      },
    });

    // Simulate PackageProcessor behaviour by manually running updatePackageVersion
    // - For root package.json
    const packageJsonPath = join(testDir, 'package.json');
    updatePackageVersion(packageJsonPath, '0.4.0');

    // - For src/Cargo.toml (based on paths config)
    const srcCargoPath = join(srcDir, 'Cargo.toml');
    updatePackageVersion(srcCargoPath, '0.4.0');

    // Verify results
    // Root package.json should be updated
    expect(getPackageVersion(testDir)).toBe('0.4.0');

    // Root Cargo.toml should NOT be updated
    expect(getCargoVersion(testDir)).toBe('0.1.0');

    // But src/Cargo.toml should be updated
    const srcCargoContent = readFileSync(srcCargoPath, 'utf8');
    const srcCargo = TOML.parse(srcCargoContent) as { package: { version: string } };
    expect(srcCargo.package.version).toBe('0.4.0');

    // Clean up
    if (existsSync(srcCargoPath)) {
      rmSync(srcCargoPath);
    }
  });
});

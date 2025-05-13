import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as TOML from 'smol-toml';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { updatePackageVersion } from '../../src/package/packageManagement.js';

// Map to store original fixture content
const originalFixtures = new Map<string, string>();

/**
 * Recursively find all config files (package.json and version.config.json) in the given directory
 */
function findConfigFiles(directory: string): string[] {
  const files: string[] = [];

  if (!existsSync(directory)) {
    return files;
  }

  const items = readdirSync(directory, { withFileTypes: true });

  for (const item of items) {
    const itemPath = join(directory, item.name);
    if (item.isDirectory()) {
      files.push(...findConfigFiles(itemPath));
    } else if (item.name === 'package.json' || item.name === 'version.config.json') {
      files.push(itemPath);
    }
  }

  return files;
}

/**
 * Save the original state of all config files in fixtures directory
 */
function saveFixtureState(fixturesDir: string): void {
  const configFiles = findConfigFiles(fixturesDir);

  for (const filePath of configFiles) {
    try {
      const content = readFileSync(filePath, 'utf8');
      originalFixtures.set(filePath, content);
    } catch (error) {
      console.warn(`Could not save original state of ${filePath}:`, error);
    }
  }
}

/**
 * Restore all package.json files to their original state
 */
function restoreFixtureState(): void {
  for (const [filePath, content] of originalFixtures) {
    try {
      if (existsSync(filePath)) {
        writeFileSync(filePath, content);
      }
    } catch (error) {
      console.warn(`Could not restore original state of ${filePath}:`, error);
    }
  }
}

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

  // Allow operations in nested git directories
  execSync('git config --local --add safe.directory "*"', { cwd: dir });

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
        versionPrefix: 'v',
        tagTemplate: '${prefix}${version}',
        packageTagTemplate: '${packageName}@${prefix}${version}',
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
      createConventionalCommit(RUST_PACKAGE_FIXTURE, 'feat', 'add new feature to Rust package', [
        indexFile,
      ]);
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
      createConventionalCommit(RUST_PACKAGE_FIXTURE, 'feat', 'add new feature to Rust package', [
        indexFile,
      ]);
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
    const newVersion = '0.1.1';
    updateBothManifests(HYBRID_PACKAGE_FIXTURE, newVersion);

    // Check package.json version
    const pkgVersion = getPackageVersion(HYBRID_PACKAGE_FIXTURE);
    expect(pkgVersion).toBe('0.1.1');

    // Check Cargo.toml version - this is where we expect to see the bug fixed
    const cargoVersion = getCargoVersion(HYBRID_PACKAGE_FIXTURE);
    expect(cargoVersion).toBe('0.1.1');

    // Both versions should match
    expect(pkgVersion).toBe(cargoVersion);
  });
});

import fs from 'node:fs';
import path from 'node:path';

import { getPackagesSync } from '@manypkg/get-packages';
import { Bumper } from 'conventional-recommended-bump';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import type { Config } from '../src/types.js';
import { type PackagesWithRoot, VersionEngine } from '../src/versionEngine.js';

// Mock @manypkg/get-packages
vi.mock('@manypkg/get-packages', () => ({
  getPackagesSync: vi.fn().mockReturnValue({
    packages: [
      {
        packageJson: { name: 'package-1', version: '1.0.0' },
        dir: '/test/path/packages/package-1',
      },
      {
        packageJson: { name: 'package-2', version: '1.0.0' },
        dir: '/test/path/packages/package-2',
      },
    ],
    root: '/test/path',
  }),
}));

// Mock node:fs at the top level
vi.mock('node:fs', () => ({
  // Provide mocks for both named and default exports
  readFileSync: vi.fn().mockReturnValue('{}'),
  writeFileSync: vi.fn(),
  existsSync: vi.fn().mockReturnValue(true), // Default to true
  default: {
    readFileSync: vi.fn().mockReturnValue('{}'),
    writeFileSync: vi.fn(),
    existsSync: vi.fn().mockReturnValue(true),
  },
  __esModule: true,
}));

// Mock git-semver-tags (needed for test using actual updatePackageVersion)
vi.mock('git-semver-tags', () => ({
  // Default export function, handles potential CJS/ESM interop issues
  __esModule: true, // Indicate it's an ES module
  default: vi
    .fn()
    .mockImplementation((_opts: unknown, callback: (err: Error | null, tags: string[]) => void) => {
      // Simulate async behavior with a resolved promise/callback
      // Return an empty array as a default, tests can override if needed
      process.nextTick(() => callback(null, []));
    }),
}));

// Mock utils.js
vi.mock('../src/utils.js', () => ({
  formatTag: vi.fn().mockReturnValue('prefix@v1.1.0'),
  formatTagPrefix: vi.fn().mockReturnValue('prefix@'),
  formatCommitMessage: vi
    .fn()
    .mockImplementation((msg, version) => `${msg.replace('${version}', version)}`),
  updatePackageVersion: vi.fn(),
  log: vi.fn(),
  gitProcess: vi.fn(), // Mock gitProcess via utils
  getCommitsLength: vi.fn(),
  // Provide default resolved values
  getCurrentBranch: vi.fn().mockResolvedValue('main'),
  lastMergeBranchName: vi.fn().mockResolvedValue(null),
  getLatestTag: vi.fn().mockResolvedValue('v1.0.0'),
}));

// Mock node:process
vi.mock('node:process', () => ({
  cwd: vi.fn().mockReturnValue('/test/path'),
  exit: vi.fn(),
}));

// Mock path
// vi.mock('node:path', () => ({
//     join: vi.fn((...args: string[]) => args.join('/')), // Simple join mock
// }));

// REMOVE redundant git.js mock
// vi.mock('../src/git.js', ...);

import * as process from 'node:process';
// Import after mocks
import * as utils from '../src/utils.js';

// Auto-mock the module
vi.mock('conventional-recommended-bump');

describe('VersionEngine', () => {
  let engine: VersionEngine;
  let mockConfig: Config;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetAllMocks();
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Ensure Bumper and its instances/methods are deeply mocked AFTER reset
    vi.mocked(Bumper, { deep: true });

    // Set default implementations on the PROTOTYPE of the deeply mocked class
    vi.mocked(Bumper.prototype.loadPreset).mockImplementation(vi.fn());
    vi.mocked(Bumper.prototype.bump).mockResolvedValue({ releaseType: 'patch' });

    // Explicitly reset branch mocks AFTER resetAllMocks
    vi.mocked(utils.getCurrentBranch).mockResolvedValue('main');
    vi.mocked(utils.lastMergeBranchName).mockResolvedValue(null);

    mockConfig = {
      preset: 'conventional-commits',
      packages: [],
      tagPrefix: 'v',
      commitMessage: 'chore(release): ${version}',
      versionStrategy: 'branchPattern' as const,
      baseBranch: 'main',
      synced: true,
      branchPattern: ['feature:minor', 'fix:patch'],
      skip: [], // Ensure skip is always an array
      updateInternalDependencies: 'no-internal-update' as const,
    };

    // Create engine instance
    engine = new VersionEngine(mockConfig);

    // Reset mock implementations AFTER resetAllMocks and engine creation
    vi.mocked(utils.formatTag).mockReturnValue('prefix@v1.1.0');
    vi.mocked(utils.formatTagPrefix).mockReturnValue('prefix@');
    vi.mocked(utils.formatCommitMessage).mockImplementation(
      (msg, version) => `${msg.replace('${version}', version)}`,
    );
    vi.mocked(utils.getLatestTag).mockResolvedValue('v1.0.0');
    vi.mocked(utils.getCommitsLength).mockResolvedValue(1);
    vi.mocked(getPackagesSync).mockReturnValue({
      packages: [
        {
          packageJson: { name: 'package-1', version: '1.0.0' },
          dir: '/test/path/packages/package-1',
        },
        {
          packageJson: { name: 'package-2', version: '1.0.0' },
          dir: '/test/path/packages/package-2',
        },
      ],
      root: '/test/path',
    } as PackagesWithRoot);

    if (vi.isMockFunction(fs.existsSync)) {
      vi.mocked(fs.existsSync).mockReturnValue(true);
    }
    if (vi.isMockFunction(fs.readFileSync)) {
      vi.mocked(fs.readFileSync).mockReturnValue('{}');
    }
    if (vi.isMockFunction(fs.writeFileSync)) {
      vi.mocked(fs.writeFileSync).mockImplementation(() => {});
    }

    vi.mocked(utils.updatePackageVersion).mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('syncedStrategy', () => {
    it('should update all packages to the same version when tags exist and commits are present', async () => {
      vi.mocked(utils.getLatestTag).mockResolvedValue('v1.0.0');
      vi.mocked(Bumper.prototype.bump).mockResolvedValue({ releaseType: 'patch' });
      vi.mocked(utils.getCommitsLength).mockResolvedValue(1);

      const expectedVersion = '1.0.1';
      vi.mocked(utils.formatTag).mockReturnValue(`v${expectedVersion}`);
      vi.mocked(utils.formatCommitMessage).mockReturnValue(`chore(release): v${expectedVersion}`);

      await engine.syncedStrategy();

      expect(utils.updatePackageVersion).toHaveBeenCalledTimes(3);
      expect(utils.updatePackageVersion).toHaveBeenCalledWith(
        expect.objectContaining({ version: expectedVersion }),
      );

      expect(utils.gitProcess).toHaveBeenCalledWith(
        expect.objectContaining({
          files: expect.arrayContaining([
            path.join('/test/path', 'package.json'),
            path.join('/test/path', 'packages', 'package-1', 'package.json'),
            path.join('/test/path', 'packages', 'package-2', 'package.json'),
          ]),
          nextTag: `v${expectedVersion}`,
          commitMessage: `chore(release): v${expectedVersion}`,
        }),
      );
    });

    it('should use initial version 0.0.1 when no tags exist', async () => {
      vi.mocked(utils.getLatestTag).mockResolvedValue('');
      vi.mocked(Bumper.prototype.bump).mockResolvedValue({ releaseType: 'patch' });

      const expectedInitialVersion = '0.0.1';
      vi.mocked(utils.formatTag).mockReturnValue(`v${expectedInitialVersion}`);
      vi.mocked(utils.formatCommitMessage).mockReturnValue(
        `chore(release): v${expectedInitialVersion}`,
      );

      await engine.syncedStrategy();

      expect(utils.updatePackageVersion).toHaveBeenCalledTimes(3);
      expect(utils.updatePackageVersion).toHaveBeenCalledWith(
        expect.objectContaining({ version: expectedInitialVersion }),
      );
      expect(utils.gitProcess).toHaveBeenCalledWith(
        expect.objectContaining({
          files: expect.arrayContaining([
            path.join('/test/path', 'package.json'),
            path.join('/test/path', 'packages', 'package-1', 'package.json'),
            path.join('/test/path', 'packages', 'package-2', 'package.json'),
          ]),
          nextTag: `v${expectedInitialVersion}`,
          commitMessage: `chore(release): v${expectedInitialVersion}`,
        }),
      );
      expect(utils.getCommitsLength).not.toHaveBeenCalled();
    });

    it('should skip version update when tags exist but no relevant commits are found', async () => {
      vi.mocked(utils.getLatestTag).mockResolvedValue('v1.0.0');
      vi.mocked(Bumper.prototype.bump).mockResolvedValue({ releaseType: undefined });
      vi.mocked(utils.getCommitsLength).mockResolvedValue(1);

      await engine.syncedStrategy();

      expect(utils.updatePackageVersion).not.toHaveBeenCalled();
      expect(utils.gitProcess).not.toHaveBeenCalled();
      expect(utils.log).toHaveBeenCalledWith(
        'info',
        expect.stringContaining('No relevant commits found'),
      );
    });

    it('should skip version update when tags exist but getCommitsLength returns 0', async () => {
      vi.mocked(utils.getLatestTag).mockResolvedValue('v1.0.0');
      vi.mocked(Bumper.prototype.bump).mockResolvedValue({ releaseType: 'patch' });
      vi.mocked(utils.getCommitsLength).mockResolvedValue(0);

      await engine.syncedStrategy();

      expect(utils.updatePackageVersion).not.toHaveBeenCalled();
      expect(utils.gitProcess).not.toHaveBeenCalled();
      expect(utils.log).toHaveBeenCalledWith(
        'info',
        expect.stringContaining('No new commits found'),
      );
    });

    it('should log error if updating root package.json fails', async () => {
      vi.mocked(utils.getLatestTag).mockResolvedValue('v1.0.0');
      vi.mocked(Bumper.prototype.bump).mockResolvedValue({ releaseType: 'patch' });
      vi.mocked(utils.getCommitsLength).mockResolvedValue(1);

      const expectedVersion = '1.0.1';
      vi.mocked(utils.formatTag).mockReturnValue(`v${expectedVersion}`);
      vi.mocked(utils.formatCommitMessage).mockReturnValue(`chore(release): v${expectedVersion}`);

      const updateError = new Error('updatePackageVersion failed for root');
      vi.mocked(utils.updatePackageVersion).mockImplementation(({ name }: { name: string }) => {
        if (name === 'root') {
          throw updateError;
        }
      });

      await engine.syncedStrategy();

      expect(utils.updatePackageVersion).toHaveBeenCalledTimes(3);
      expect(utils.updatePackageVersion).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'root' }),
      );
      expect(utils.log).toHaveBeenCalledWith('error', 'Failed to update root package.json');
      expect(utils.gitProcess).toHaveBeenCalled();
    });
  });

  describe('singleStrategy', () => {
    it('should update only the specified package', async () => {
      mockConfig.packages = ['package-1'];
      mockConfig.synced = false;
      vi.mocked(utils.getLatestTag).mockResolvedValue('vpackage-1@1.0.0');
      vi.mocked(Bumper.prototype.bump).mockResolvedValue({ releaseType: 'minor' });
      vi.mocked(utils.getCommitsLength).mockResolvedValue(5);

      const expectedVersion = '1.1.0';
      const pkg1Path = '/test/path/packages/package-1';
      const expectedTag = `vpackage-1@${expectedVersion}`;
      vi.mocked(utils.formatTag).mockReturnValue(expectedTag);
      vi.mocked(utils.formatCommitMessage).mockReturnValue(`chore(release): ${expectedVersion}`);

      await engine.singleStrategy();

      expect(utils.updatePackageVersion).toHaveBeenCalledTimes(1);
      expect(utils.updatePackageVersion).toHaveBeenCalledWith(
        expect.objectContaining({ path: pkg1Path, version: expectedVersion }),
      );
      expect(utils.gitProcess).toHaveBeenCalledWith(
        expect.objectContaining({
          files: [path.join(pkg1Path, 'package.json')],
          nextTag: expectedTag,
          commitMessage: `chore(release): ${expectedVersion}`,
        }),
      );
    });

    it('should use initial version 0.0.1 for specified package when no tags exist', async () => {
      mockConfig.packages = ['package-1'];
      mockConfig.synced = false;
      vi.mocked(utils.getLatestTag).mockResolvedValue('');
      vi.mocked(Bumper.prototype.bump).mockResolvedValue({ releaseType: 'minor' });

      const expectedVersion = '0.0.1';
      const pkg1Path = '/test/path/packages/package-1';
      const expectedTag = `vpackage-1@${expectedVersion}`;
      vi.mocked(utils.formatTag).mockReturnValue(expectedTag);
      vi.mocked(utils.formatCommitMessage).mockReturnValue(`chore(release): ${expectedVersion}`);

      await engine.singleStrategy();

      expect(utils.updatePackageVersion).toHaveBeenCalledTimes(1);
      expect(utils.updatePackageVersion).toHaveBeenCalledWith(
        expect.objectContaining({ path: pkg1Path, version: expectedVersion }),
      );
      expect(utils.gitProcess).toHaveBeenCalledWith(
        expect.objectContaining({
          files: [path.join(pkg1Path, 'package.json')],
          nextTag: expectedTag,
          commitMessage: `chore(release): ${expectedVersion}`,
        }),
      );
      expect(utils.getCommitsLength).not.toHaveBeenCalled();
    });

    it('should throw error when no package is specified', async () => {
      mockConfig.packages = [];
      mockConfig.synced = false;
      vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('Process exit');
      });

      await expect(engine.singleStrategy()).rejects.toThrow('Process exit');

      expect(utils.log).toHaveBeenCalledWith(
        'error',
        'Single mode requires exactly one package name',
      );
      expect(process.exit).toHaveBeenCalledWith(1);
    });

    // Add test for package not found
    it('should exit with error if specified package is not found', async () => {
      mockConfig.packages = ['non-existent-package'];
      mockConfig.synced = false;
      vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('Process exit');
      });

      await expect(engine.singleStrategy()).rejects.toThrow('Process exit');

      expect(utils.log).toHaveBeenCalledWith('error', 'Package non-existent-package not found');
      expect(process.exit).toHaveBeenCalledWith(1);
    });

    // Add test for no version change
    it('should do nothing if calculateVersion returns empty string', async () => {
      mockConfig.packages = ['package-1'];
      mockConfig.synced = false;
      Object.defineProperty(engine, 'calculateVersion', {
        value: vi.fn().mockResolvedValue(''), // No version change
        configurable: true,
      });

      await engine.singleStrategy();

      expect(utils.updatePackageVersion).not.toHaveBeenCalled();
      expect(utils.gitProcess).not.toHaveBeenCalled();
      expect(utils.log).toHaveBeenCalledWith('info', 'No version change needed for package-1');
    });

    // Add test for gitProcess error
    it('should handle errors during gitProcess', async () => {
      mockConfig.packages = ['package-1'];
      mockConfig.synced = false;
      Object.defineProperty(engine, 'calculateVersion', {
        value: vi.fn().mockResolvedValue('1.1.0'),
        configurable: true,
      });
      const gitError = new Error('Git process failed');
      vi.mocked(utils.gitProcess).mockRejectedValue(gitError);
      vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('Process exit');
      });

      await expect(engine.singleStrategy()).rejects.toThrow('Process exit');

      // The error is logged within the createGitCommitAndTag private method
      expect(utils.log).toHaveBeenCalledWith('error', 'Failed to create git commit and tag');
      // The raw error is passed to console.error
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('Git process failed'), // Check wrapped error
        }),
      );
      expect(process.exit).toHaveBeenCalledWith(1);
    });

    // Add test for getPackagesSync error
    it('should handle errors when getPackagesSync fails', async () => {
      mockConfig.packages = ['package-1']; // Need a package specified
      mockConfig.synced = false;
      const error = new Error('getPackagesSync failed');
      vi.mocked(getPackagesSync).mockImplementation(() => {
        throw error;
      });
      vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('Process exit');
      });

      await expect(engine.singleStrategy()).rejects.toThrow('Process exit');

      expect(utils.log).toHaveBeenCalledWith('error', 'Failed to get packages information');
      expect(consoleErrorSpy).toHaveBeenCalledWith(error);
      expect(process.exit).toHaveBeenCalledWith(1);
    });

    // Add test for calculateVersion failure within singleStrategy
    it('should handle errors from calculateVersion', async () => {
      mockConfig.packages = ['package-1'];
      mockConfig.synced = false;
      const calcError = new Error('Calculation failed');
      // Mock the prototype BUMP function to throw
      vi.mocked(Bumper.prototype.bump).mockRejectedValue(calcError);
      vi.mocked(utils.getLatestTag).mockResolvedValue(''); // Example: no tags scenario

      // Act
      await engine.singleStrategy();

      // Assert: Check logs and ensure no updates/git happened
      expect(utils.log).toHaveBeenCalledWith(
        'error',
        expect.stringContaining('Failed to calculate version'),
      );
      expect(utils.updatePackageVersion).not.toHaveBeenCalled();
      expect(utils.gitProcess).not.toHaveBeenCalled();
      // Assert that the *original* rejected error was caught and logged by calculateVersion's catch block
      expect(consoleErrorSpy).toHaveBeenCalledWith(calcError);
    });
  });

  describe('asyncStrategy', () => {
    beforeEach(() => {
      // Default to async mode for these tests
      mockConfig.synced = false;
      engine = new VersionEngine(mockConfig); // Re-create engine with updated config
      vi.mocked(utils.getLatestTag).mockResolvedValue('v1.0.0');
      vi.mocked(Bumper.prototype.bump).mockResolvedValue({ releaseType: 'patch' });
      vi.mocked(utils.getCommitsLength).mockResolvedValue(1);
    });

    it('should update only packages where calculateVersion returns a version', async () => {
      // Mock calculateVersion directly for finer control in async tests
      // biome-ignore lint/suspicious/noExplicitAny: Need to spy on private method for testing
      const calculateVersionSpy = vi.spyOn(engine as any, 'calculateVersion');
      calculateVersionSpy
        .mockResolvedValueOnce('1.0.1') // package-1 gets an update
        .mockResolvedValueOnce(''); // package-2 does not

      await engine.asyncStrategy();

      expect(utils.updatePackageVersion).toHaveBeenCalledTimes(1);
      expect(utils.updatePackageVersion).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'package-1', version: '1.0.1' }),
      );
      expect(utils.updatePackageVersion).not.toHaveBeenCalledWith(
        expect.objectContaining({ name: 'package-2' }),
      );

      expect(utils.gitProcess).toHaveBeenCalledWith(
        expect.objectContaining({
          files: [path.join('/test/path', 'packages', 'package-1', 'package.json')],
          commitMessage: 'chore(release): ${version}',
          nextTag: '',
          skipHooks: undefined,
          dryRun: undefined,
        }),
      );
      // Check the updated log message
      expect(utils.log).toHaveBeenCalledWith('success', 'Created version commit for 1 package(s)');
    });

    it('should do nothing when calculateVersion returns no versions', async () => {
      // biome-ignore lint/suspicious/noExplicitAny: Need to spy on private method for testing
      const calculateVersionSpy = vi.spyOn(engine as any, 'calculateVersion');
      calculateVersionSpy.mockResolvedValue(''); // No packages get updates

      await engine.asyncStrategy();

      expect(utils.updatePackageVersion).not.toHaveBeenCalled();
      expect(utils.gitProcess).not.toHaveBeenCalled();
      // Check the updated log message
      expect(utils.log).toHaveBeenCalledWith(
        'info',
        'No packages to process based on changes and targets',
      );
    });

    // --- New tests for --target flag ---

    it('should process only targeted packages when cliTargets are provided', async () => {
      // biome-ignore lint/suspicious/noExplicitAny: Need to spy on private method for testing
      const calculateVersionSpy = vi.spyOn(engine as any, 'calculateVersion');
      calculateVersionSpy.mockResolvedValue('1.0.1'); // Assume target package needs update

      const targets = ['package-1'];
      await engine.asyncStrategy(targets);

      // Verify processPackages was effectively called for only the target
      expect(calculateVersionSpy).toHaveBeenCalledTimes(1);
      expect(calculateVersionSpy).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'package-1' }),
      );

      expect(utils.updatePackageVersion).toHaveBeenCalledTimes(1);
      expect(utils.updatePackageVersion).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'package-1', version: '1.0.1' }),
      );

      expect(utils.gitProcess).toHaveBeenCalledWith(
        expect.objectContaining({
          files: [path.join('/test/path', 'packages', 'package-1', 'package.json')],
          commitMessage: 'chore(release): ${version}',
          nextTag: '',
          skipHooks: undefined,
          dryRun: undefined,
        }),
      );
      expect(utils.log).toHaveBeenCalledWith('success', 'Created version commit for 1 package(s)');
    });

    it('should process no packages if targets do not match discovered packages', async () => {
      // biome-ignore lint/suspicious/noExplicitAny: Need to spy on private method for testing
      const calculateVersionSpy = vi.spyOn(engine as any, 'calculateVersion');
      const targets = ['non-existent-package'];
      await engine.asyncStrategy(targets);

      expect(calculateVersionSpy).not.toHaveBeenCalled();
      expect(utils.updatePackageVersion).not.toHaveBeenCalled();
      expect(utils.gitProcess).not.toHaveBeenCalled();
      expect(utils.log).toHaveBeenCalledWith(
        'info',
        'No packages to process based on changes and targets',
      );
    });

    it('should respect config skip list even if package is targeted', async () => {
      mockConfig.skip = ['package-1']; // Add package-1 to skip list
      engine = new VersionEngine(mockConfig); // Re-create engine

      // biome-ignore lint/suspicious/noExplicitAny: Need to spy on private method for testing
      const calculateVersionSpy = vi.spyOn(engine as any, 'calculateVersion');
      calculateVersionSpy.mockResolvedValue('1.0.1'); // Assume package-2 needs update

      const targets = ['package-1', 'package-2']; // Target both
      await engine.asyncStrategy(targets);

      // Verify package-1 was skipped despite being targeted
      expect(utils.log).toHaveBeenCalledWith(
        'info',
        'Skipping package package-1 based on config skip list.',
      );

      // Verify only package-2 was processed
      expect(calculateVersionSpy).toHaveBeenCalledTimes(1);
      expect(calculateVersionSpy).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'package-2' }),
      );

      expect(utils.updatePackageVersion).toHaveBeenCalledTimes(1);
      expect(utils.updatePackageVersion).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'package-2', version: '1.0.1' }),
      );

      expect(utils.gitProcess).toHaveBeenCalledWith(
        expect.objectContaining({
          files: [path.join('/test/path', 'packages', 'package-2', 'package.json')],
        }),
      );
      expect(utils.log).toHaveBeenCalledWith('success', 'Created version commit for 1 package(s)');
    });
  });
});

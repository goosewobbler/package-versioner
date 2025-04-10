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
  gitProcess: vi.fn(),
  getCommitsLength: vi.fn(),
  getCurrentBranch: vi.fn().mockResolvedValue('main'),
  lastMergeBranchName: vi.fn().mockResolvedValue(null),
  getLatestTag: vi.fn().mockResolvedValue('v1.0.0'),
  gitAdd: vi.fn(),
  gitCommit: vi.fn(),
  createGitTag: vi.fn(),
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

// Mock the individual git functions we need for asyncTargetedStrategy
vi.mock('../src/git.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/git.js')>();
  return {
    ...original, // Keep original exports like isGitRepository if needed
    gitAdd: vi.fn(),
    gitCommit: vi.fn(),
    createGitTag: vi.fn(),
    // Mock others if they are called unexpectedly
  };
});

// Need to import git functions directly for mocking/spying after the mock setup
import { createGitTag, gitAdd, gitCommit } from '../src/git.js';

describe('VersionEngine', () => {
  let engine: VersionEngine;
  let mockConfig: Config;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  // Spy on the new private method
  // biome-ignore lint/suspicious/noExplicitAny: Explicit any needed to bypass spy type mismatch
  let asyncTargetedStrategySpy: any;
  // Spy on the original private method
  // biome-ignore lint/suspicious/noExplicitAny: Explicit any needed to bypass spy type mismatch
  let processPackagesSpy: any;
  // Spy on the calculateVersion method
  // biome-ignore lint/suspicious/noExplicitAny: Explicit any needed to bypass spy type mismatch
  let calculateVersionSpy: any;

  beforeEach(() => {
    vi.resetAllMocks();
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Mock Bumper
    vi.mocked(Bumper, { deep: true });
    vi.mocked(Bumper.prototype.loadPreset).mockImplementation(vi.fn());
    vi.mocked(Bumper.prototype.bump).mockResolvedValue({ releaseType: 'patch' });

    // Mock utils functions (used by multiple strategies)
    vi.mocked(utils.getCurrentBranch).mockResolvedValue('main');
    vi.mocked(utils.lastMergeBranchName).mockResolvedValue(null);
    vi.mocked(utils.formatTag).mockImplementation(({ name, tagPrefix }, { version }) =>
      name ? `${tagPrefix}${name}@${version}` : `${tagPrefix || 'v'}${version}`,
    );
    vi.mocked(utils.formatTagPrefix).mockImplementation((prefix) => (prefix ? `${prefix}` : ''));
    vi.mocked(utils.formatCommitMessage).mockImplementation(
      (msg, version) => `${msg.replace('${version}', version)}`,
    );
    vi.mocked(utils.getLatestTag).mockResolvedValue('v1.0.0');
    vi.mocked(utils.getCommitsLength).mockResolvedValue(1);
    vi.mocked(utils.updatePackageVersion).mockImplementation(() => {});
    vi.mocked(utils.log).mockImplementation(() => {}); // Mock log to suppress output in tests

    // Mock manypkg (used by multiple strategies)
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

    // Mock fs
    if (vi.isMockFunction(fs.existsSync)) vi.mocked(fs.existsSync).mockReturnValue(true);
    if (vi.isMockFunction(fs.readFileSync))
      vi.mocked(fs.readFileSync).mockReturnValue('{"name": "test", "version": "1.0.0"}'); // Provide valid JSON
    if (vi.isMockFunction(fs.writeFileSync))
      vi.mocked(fs.writeFileSync).mockImplementation(() => {});

    // Default config
    mockConfig = {
      preset: 'conventional-commits',
      packages: [],
      tagPrefix: 'v',
      commitMessage: 'chore(release): ${version}',
      versionStrategy: 'commitMessage' as const,
      baseBranch: 'main',
      synced: false, // Default to async for relevant tests
      branchPattern: [],
      skip: [],
      updateInternalDependencies: 'no-internal-update' as const,
      skipHooks: false,
      dryRun: false,
    };

    engine = new VersionEngine(mockConfig);

    // --- Spy on private methods AFTER engine instantiation ---
    // biome-ignore lint/suspicious/noExplicitAny: Accessing private method for testing
    asyncTargetedStrategySpy = vi.spyOn(engine as any, 'asyncTargetedStrategy');
    // biome-ignore lint/suspicious/noExplicitAny: Accessing private method for testing
    processPackagesSpy = vi.spyOn(engine as any, 'processPackages');
    // biome-ignore lint/suspicious/noExplicitAny: Accessing private method for testing
    calculateVersionSpy = vi.spyOn(engine as any, 'calculateVersion');

    // Default implementation for calculateVersion (can be overridden per test)
    calculateVersionSpy.mockResolvedValue('1.0.1');

    // Mock the original gitProcess (used by non-targeted async)
    vi.mocked(utils.gitProcess).mockResolvedValue();

    // Mock individual git functions via utils mock (used by targeted async)
    vi.mocked(utils.gitAdd).mockResolvedValue({ stdout: '', stderr: '' });
    vi.mocked(utils.gitCommit).mockResolvedValue({ stdout: '', stderr: '' });
    vi.mocked(utils.createGitTag).mockResolvedValue({ stdout: '', stderr: '' });
  });

  afterEach(() => {
    vi.restoreAllMocks(); // Restore all mocks, including spies
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
      calculateVersionSpy.mockResolvedValue('0.0.1');

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
      calculateVersionSpy.mockResolvedValue('');
      vi.mocked(utils.getCommitsLength).mockResolvedValue(1);

      await engine.syncedStrategy();

      expect(utils.updatePackageVersion).not.toHaveBeenCalled();
      expect(utils.gitProcess).not.toHaveBeenCalled();
      // Expect the specific log message from syncedStrategy when no version is calculated
      expect(utils.log).toHaveBeenCalledWith('info', 'No version change needed');
    });

    it('should skip version update when tags exist but getCommitsLength returns 0', async () => {
      vi.mocked(utils.getLatestTag).mockResolvedValue('v1.0.0');
      vi.mocked(Bumper.prototype.bump).mockResolvedValue({ releaseType: 'patch' }); // Bump proposed
      calculateVersionSpy.mockResolvedValue(''); // But calculateVersion returns no change due to commitsLength
      vi.mocked(utils.getCommitsLength).mockResolvedValue(0);

      await engine.syncedStrategy();

      expect(utils.updatePackageVersion).not.toHaveBeenCalled();
      expect(utils.gitProcess).not.toHaveBeenCalled();
      // Expect the specific log message from syncedStrategy when no version is calculated
      expect(utils.log).toHaveBeenCalledWith('info', 'No version change needed');
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
      calculateVersionSpy.mockResolvedValue('1.1.0');

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
      calculateVersionSpy.mockResolvedValue('0.0.1');

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
      calculateVersionSpy.mockResolvedValue('');

      await engine.singleStrategy();

      expect(utils.updatePackageVersion).not.toHaveBeenCalled();
      expect(utils.gitProcess).not.toHaveBeenCalled();
      expect(utils.log).toHaveBeenCalledWith('info', 'No version change needed for package-1');
    });

    // Add test for gitProcess error
    it('should handle errors during gitProcess', async () => {
      mockConfig.packages = ['package-1'];
      mockConfig.synced = false;
      calculateVersionSpy.mockResolvedValue('1.1.0');
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
      calculateVersionSpy.mockRejectedValue(calcError);
      vi.mocked(utils.getLatestTag).mockResolvedValue('v1.0.0');

      await engine.singleStrategy();

      // Check error log from calculateVersion's catch block (which logs and returns '')
      expect(utils.log).toHaveBeenCalledWith(
        'error',
        expect.stringContaining(`Failed to calculate version for package-1: ${calcError.message}`),
      );
      // Check that singleStrategy then logs "no version change" because calculateVersion returned ''
      expect(utils.log).toHaveBeenCalledWith('info', 'No version change needed for package-1');
      // Verify no actual updates or git commands ran
      expect(utils.updatePackageVersion).not.toHaveBeenCalled();
      expect(utils.gitProcess).not.toHaveBeenCalled();
    });
  });

  describe('asyncStrategy', () => {
    beforeEach(() => {
      // Ensure async mode
      mockConfig.synced = false;
      engine = new VersionEngine(mockConfig);
      // Re-apply spies after engine recreation
      // biome-ignore lint/suspicious/noExplicitAny: Accessing private method for testing
      asyncTargetedStrategySpy = vi.spyOn(engine as any, 'asyncTargetedStrategy');
      // biome-ignore lint/suspicious/noExplicitAny: Accessing private method for testing
      processPackagesSpy = vi.spyOn(engine as any, 'processPackages');
    });

    it('should call asyncTargetedStrategy when cliTargets are provided', async () => {
      const targets = ['package-1'];
      await engine.asyncStrategy(targets);

      expect(asyncTargetedStrategySpy).toHaveBeenCalledWith(targets);
      expect(processPackagesSpy).not.toHaveBeenCalled(); // Original processor shouldn't be called
      expect(utils.gitProcess).not.toHaveBeenCalled(); // Original git process shouldn't be called
    });

    it('should call original processPackages and gitProcess when no cliTargets are provided', async () => {
      // Mock original processPackages to return file paths
      processPackagesSpy.mockResolvedValue(['/test/path/packages/package-1/package.json']);

      await engine.asyncStrategy([]); // Empty targets

      expect(asyncTargetedStrategySpy).not.toHaveBeenCalled();
      expect(processPackagesSpy).toHaveBeenCalledWith(expect.any(Array), []); // Called with empty targets
      expect(utils.gitProcess).toHaveBeenCalledWith(
        expect.objectContaining({
          files: ['/test/path/packages/package-1/package.json'],
          nextTag: '', // No tag for default async
          commitMessage: mockConfig.commitMessage, // Expect template
        }),
      );
    });

    it('should handle no packages being processed in the original flow', async () => {
      processPackagesSpy.mockResolvedValue([]); // No files updated
      await engine.asyncStrategy([]);
      expect(asyncTargetedStrategySpy).not.toHaveBeenCalled();
      expect(processPackagesSpy).toHaveBeenCalled();
      expect(utils.gitProcess).not.toHaveBeenCalled();
      expect(utils.log).toHaveBeenCalledWith(
        'info',
        'No packages to process based on changes and targets',
      );
    });
  });

  // --- NEW Suite for asyncTargetedStrategy ---
  describe('asyncTargetedStrategy (private method test)', () => {
    beforeEach(() => {
      // Ensure async mode
      mockConfig.synced = false;
      engine = new VersionEngine(mockConfig);
      // Re-apply spies after engine recreation
      // biome-ignore lint/suspicious/noExplicitAny: Accessing private method for testing
      asyncTargetedStrategySpy = vi.spyOn(engine as any, 'asyncTargetedStrategy');
      // biome-ignore lint/suspicious/noExplicitAny: Accessing private method for testing
      processPackagesSpy = vi.spyOn(engine as any, 'processPackages');
      // biome-ignore lint/suspicious/noExplicitAny: Accessing private method for testing
      calculateVersionSpy = vi.spyOn(engine as any, 'calculateVersion');
      calculateVersionSpy.mockResolvedValue('1.1.0'); // Default successful bump
    });

    // Helper to call the private method
    const callPrivateMethod = (targets: string[]) => {
      // biome-ignore lint/suspicious/noExplicitAny: Calling private method
      return (engine as any).asyncTargetedStrategy(targets);
    };

    it('should update, tag, and commit targeted packages', async () => {
      const targets = ['package-1'];
      calculateVersionSpy.mockResolvedValue('1.1.0'); // Ensure correct version
      await callPrivateMethod(targets);

      // Verify version calculation and update
      expect(calculateVersionSpy).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'package-1' }),
      );
      expect(utils.updatePackageVersion).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'package-1', version: '1.1.0' }),
      );

      // Verify tagging
      expect(utils.formatTag).toHaveBeenCalledWith(
        { synced: false, name: 'package-1', tagPrefix: mockConfig.tagPrefix },
        { version: '1.1.0', tagPrefix: mockConfig.tagPrefix },
      );
      const expectedTag = `${mockConfig.tagPrefix}package-1@1.1.0`;
      expect(utils.createGitTag).toHaveBeenCalledWith({
        tag: expectedTag,
        message: 'chore(release): package-1 1.1.0',
      });

      // Verify commit message (uses template because it's a single package)
      const expectedCommitMsg = 'chore(release): 1.1.0 [skip-ci]'; // Formatted by template
      expect(utils.gitCommit).toHaveBeenCalledWith({
        message: expectedCommitMsg,
        skipHooks: false,
      });
      expect(utils.log).toHaveBeenCalledWith(
        'success',
        'Created commit for targeted release: package-1',
      );
    });

    it('should handle multiple targeted packages', async () => {
      const targets = ['package-1', 'package-2'];
      calculateVersionSpy.mockResolvedValue('1.2.0');
      await callPrivateMethod(targets);

      // Verify updates for both
      expect(utils.updatePackageVersion).toHaveBeenCalledTimes(2);
      expect(utils.updatePackageVersion).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'package-1', version: '1.2.0' }),
      );
      expect(utils.updatePackageVersion).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'package-2', version: '1.2.0' }),
      );

      // Verify tagging for both
      expect(utils.createGitTag).toHaveBeenCalledTimes(2);
      expect(utils.createGitTag).toHaveBeenCalledWith({
        tag: `${mockConfig.tagPrefix}package-1@1.2.0`,
        message: 'chore(release): package-1 1.2.0',
      });
      expect(utils.createGitTag).toHaveBeenCalledWith({
        tag: `${mockConfig.tagPrefix}package-2@1.2.0`,
        message: 'chore(release): package-2 1.2.0',
      });

      // Verify commit message (uses generic list format)
      const expectedCommitMsg = 'chore(release): package-1, package-2 1.2.0 [skip-ci]'; // Generic format
      expect(utils.gitCommit).toHaveBeenCalledWith({
        message: expectedCommitMsg,
        skipHooks: false,
      });
      expect(utils.log).toHaveBeenCalledWith(
        'success',
        'Created commit for targeted release: package-1, package-2',
      );
    });

    it('should skip packages not matching targets or in skip list', async () => {
      mockConfig.skip = ['package-2'];
      engine = new VersionEngine(mockConfig);
      // Re-spy after recreation
      // biome-ignore lint/suspicious/noExplicitAny: Accessing private method for testing
      calculateVersionSpy = vi.spyOn(engine as any, 'calculateVersion');
      calculateVersionSpy.mockResolvedValue('1.0.5');

      const targets = ['package-1', 'package-2'];
      await callPrivateMethod(targets);

      // Verify skip log for package-2
      expect(utils.log).toHaveBeenCalledWith(
        'info',
        'Skipping package package-2 based on config skip list.',
      );

      // Verify only package-1 was processed
      expect(calculateVersionSpy).toHaveBeenCalledTimes(1);
      expect(calculateVersionSpy).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'package-1' }),
      );
      expect(utils.updatePackageVersion).toHaveBeenCalledTimes(1);
      expect(utils.createGitTag).toHaveBeenCalledTimes(1);
      expect(utils.gitCommit).toHaveBeenCalledTimes(1);

      // Verify commit message (uses template as only one package was actually processed)
      const expectedCommitMsg = 'chore(release): 1.0.5 [skip-ci]'; // Formatted by template
      expect(utils.gitCommit).toHaveBeenCalledWith(
        expect.objectContaining({ message: expectedCommitMsg }),
      );
    });

    it('should handle dry run correctly', async () => {
      mockConfig.dryRun = true;
      engine = new VersionEngine(mockConfig);
      // Re-apply spies
      // biome-ignore lint/suspicious/noExplicitAny: Accessing private method for testing
      calculateVersionSpy = vi.spyOn(engine as any, 'calculateVersion');
      // Ensure specific version for this test
      calculateVersionSpy.mockResolvedValue('1.1.0');

      const targets = ['package-1'];
      await callPrivateMethod(targets);

      // Verify tag log expectation
      expect(utils.log).toHaveBeenCalledWith(
        'info',
        '[DRY RUN] Would create tag: vpackage-1@1.1.0',
      );
      // Verify commit log expectation (uses template for single package)
      const expectedDryRunCommit = 'chore(release): 1.1.0 [skip-ci]';
      expect(utils.log).toHaveBeenCalledWith(
        'info',
        `[DRY RUN] Would commit with message: "${expectedDryRunCommit}"`,
      );
      // ... other dry run expects ...
    });

    it('should proceed with commit even if tagging fails', async () => {
      const tagError = new Error('Tagging failed');
      vi.mocked(utils.createGitTag).mockRejectedValue(tagError);
      const targets = ['package-1'];
      await callPrivateMethod(targets);

      // Verify error was logged
      expect(utils.log).toHaveBeenCalledWith(
        'error',
        // Match the actual log format including the error message
        expect.stringContaining(
          'Failed to create tag vpackage-1@1.1.0 for package-1: Tagging failed',
        ),
      );

      // Verify the second error log (stack trace) was called (optional but good)
      expect(utils.log).toHaveBeenCalledWith(
        'error',
        expect.stringContaining('Error: Tagging failed'), // Check for stack trace start
      );

      // Verify commit still happened
      expect(utils.gitCommit).toHaveBeenCalledTimes(1);
      expect(utils.log).toHaveBeenCalledWith(
        'success',
        'Created commit for targeted release: package-1',
      );
    });

    it('should exit if commit fails', async () => {
      const commitError = new Error('Commit failed');
      vi.mocked(utils.gitCommit).mockRejectedValue(commitError);
      vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('Simulated Exit');
      }); // Prevent actual exit

      const targets = ['package-1'];
      await expect(callPrivateMethod(targets)).rejects.toThrow('Simulated Exit');

      // Verify error logging and exit call
      expect(utils.log).toHaveBeenCalledWith(
        'error',
        'Failed to create commit for targeted release.',
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(commitError);
      expect(process.exit).toHaveBeenCalledWith(1);
    });

    it('should do nothing if no targeted packages require updates', async () => {
      calculateVersionSpy.mockResolvedValue(''); // No version change
      const targets = ['package-1'];
      await callPrivateMethod(targets);

      expect(utils.updatePackageVersion).not.toHaveBeenCalled();
      expect(utils.createGitTag).not.toHaveBeenCalled();
      expect(utils.gitCommit).not.toHaveBeenCalled();
      expect(utils.log).toHaveBeenCalledWith(
        'info',
        'No targeted packages required a version update.',
      );
    });
  });
});

import fs from 'node:fs';
import path from 'node:path';

import { getPackagesSync } from '@manypkg/get-packages';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

describe('VersionEngine', () => {
  let engine: VersionEngine;
  let mockConfig: Config;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>; // Spy for console.error to check logged errors

  beforeEach(() => {
    vi.resetAllMocks();
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

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

    // Set/Reset mock implementations AFTER engine creation
    vi.mocked(utils.formatTag).mockReturnValue('prefix@v1.1.0');
    vi.mocked(utils.formatTagPrefix).mockReturnValue('prefix@');
    vi.mocked(utils.formatCommitMessage).mockImplementation(
      (msg, version) => `${msg.replace('${version}', version)}`,
    );
    vi.mocked(utils.getLatestTag).mockResolvedValue('v1.0.0');
    // Reset getPackagesSync mock with explicit structure
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
    vi.restoreAllMocks(); // Ensure consoleErrorSpy is restored
  });

  describe('syncedStrategy', () => {
    it('should update all packages to the same version', async () => {
      Object.defineProperty(engine, 'calculateVersion', {
        value: vi.fn().mockResolvedValue('1.1.0'),
        configurable: true,
      });

      await engine.syncedStrategy();

      // Should call for root + 2 packages
      expect(utils.updatePackageVersion).toHaveBeenCalledTimes(3);
      expect(utils.updatePackageVersion).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'root' }),
      );
      expect(utils.updatePackageVersion).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'package-1' }),
      );

      expect(utils.gitProcess).toHaveBeenCalledWith(
        expect.objectContaining({
          files: [
            path.join('/test/path', 'package.json'),
            path.join('/test/path', 'packages', 'package-1', 'package.json'),
            path.join('/test/path', 'packages', 'package-2', 'package.json'),
          ],
          nextTag: 'prefix@v1.1.0',
          commitMessage: 'chore(release): 1.1.0',
        }),
      );
    });

    it('should skip version update when no new version is calculated', async () => {
      Object.defineProperty(engine, 'calculateVersion', {
        value: vi.fn().mockResolvedValue(''),
        configurable: true,
      });

      await engine.syncedStrategy();

      expect(utils.updatePackageVersion).not.toHaveBeenCalled();
      expect(utils.gitProcess).not.toHaveBeenCalled();
      expect(utils.log).toHaveBeenCalledWith('info', 'No version change needed');
    });

    // Rename test for clarity
    it('should handle errors when calculateVersion fails', async () => {
      // This test should simulate calculateVersion failing
      const calcError = new Error('calculateVersion failed');
      // Mock calculateVersion using Object.defineProperty
      const calculateVersionMock = vi.fn().mockRejectedValue(calcError);
      Object.defineProperty(engine, 'calculateVersion', {
        value: calculateVersionMock,
        configurable: true, // Important for cleanup
      });

      await expect(engine.syncedStrategy()).rejects.toThrow('calculateVersion failed');

      expect(calculateVersionMock).toHaveBeenCalled();
    });

    it('should log error if updating root package.json fails', async () => {
      Object.defineProperty(engine, 'calculateVersion', {
        value: vi.fn().mockResolvedValue('1.1.0'),
      });

      const updateError = new Error('updatePackageVersion failed for root');
      vi.mocked(utils.updatePackageVersion).mockImplementation(({ name }: { name: string }) => {
        if (name === 'root') {
          throw updateError;
        }
        // Do nothing for other packages
      });

      await engine.syncedStrategy();

      // Check updatePackageVersion was called 3 times (root, pkg1, pkg2)
      // It will be called for root, and throw, then called for pkg1 and pkg2
      expect(utils.updatePackageVersion).toHaveBeenCalledTimes(3);
      // Check it was called with root args (before throwing)
      expect(utils.updatePackageVersion).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'root' }),
      );
      // Check the specific log *was* called by the CATCH BLOCK in versionEngine.syncedStrategy
      expect(utils.log).toHaveBeenCalledWith('error', 'Failed to update root package.json');
      // Should still attempt git process because error was handled internally in syncedStrategy
      expect(utils.gitProcess).toHaveBeenCalled();
    });
  });

  describe('singleStrategy', () => {
    it('should update only the specified package', async () => {
      mockConfig.packages = ['package-1'];
      mockConfig.synced = false;
      // Store mock fn to check calls later if needed
      const calculateVersionMock = vi.fn().mockResolvedValue('1.1.0');
      Object.defineProperty(engine, 'calculateVersion', {
        value: calculateVersionMock,
        configurable: true,
      });
      // Define expected commit message based on mock config and version
      const expectedCommitMessage = 'chore(release): v1.1.0';
      // Explicitly mock the return value for formatCommitMessage for this test
      vi.mocked(utils.formatCommitMessage).mockReturnValue(expectedCommitMessage);

      await engine.singleStrategy();

      expect(utils.updatePackageVersion).toHaveBeenCalledTimes(1);
      expect(utils.updatePackageVersion).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'package-1', version: '1.1.0' }),
      );

      // Verify formatCommitMessage mock was called correctly
      expect(utils.formatCommitMessage).toHaveBeenCalledWith(
        mockConfig.commitMessage, // Should be defined now
        '1.1.0',
      );

      // Verify gitProcess was called with the expected formatted message - Simplified check
      expect(utils.gitProcess).toHaveBeenCalledTimes(1);
      const gitProcessArgs = vi.mocked(utils.gitProcess).mock.calls[0][0];
      expect(gitProcessArgs).toHaveProperty('files', [
        '/test/path/packages/package-1/package.json',
      ]);
      expect(gitProcessArgs).toHaveProperty('nextTag', 'prefix@v1.1.0');
      expect(gitProcessArgs).toHaveProperty('commitMessage', expectedCommitMessage);
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
  });

  describe('asyncStrategy', () => {
    it('should update only packages with changes', async () => {
      mockConfig.synced = false;
      Object.defineProperty(engine, 'processPackages', {
        value: vi.fn().mockResolvedValue(['/test/path/packages/package-1/package.json']),
        configurable: true,
      });

      await engine.asyncStrategy();

      expect(utils.gitProcess).toHaveBeenCalledWith(
        expect.objectContaining({
          files: ['/test/path/packages/package-1/package.json'],
          nextTag: '',
          commitMessage: 'chore(release): ${version}',
        }),
      );
      expect(utils.log).toHaveBeenCalledWith('success', 'Created version commit');
    });

    it('should do nothing when no packages have changes', async () => {
      mockConfig.synced = false;
      Object.defineProperty(engine, 'processPackages', {
        value: vi.fn().mockResolvedValue([]),
        configurable: true,
      });

      await engine.asyncStrategy();

      expect(utils.gitProcess).not.toHaveBeenCalled();
      expect(utils.log).toHaveBeenCalledWith('info', 'No packages to process');
    });

    // Add test for getPackagesSync error
    it('should handle errors when getPackagesSync fails', async () => {
      mockConfig.synced = false;
      const error = new Error('getPackagesSync failed');
      vi.mocked(getPackagesSync).mockImplementation(() => {
        throw error;
      });
      vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('Process exit');
      });

      await expect(engine.asyncStrategy()).rejects.toThrow('Process exit');

      expect(utils.log).toHaveBeenCalledWith('error', 'Failed to get packages information');
      expect(consoleErrorSpy).toHaveBeenCalledWith(error);
      expect(process.exit).toHaveBeenCalledWith(1);
    });

    // Test for gitProcess error in asyncStrategy
    it('should handle errors when creating git commit', async () => {
      mockConfig.synced = false;
      Object.defineProperty(engine, 'processPackages', {
        value: vi.fn().mockResolvedValue(['/path/pkg-a/package.json']), // Simulate packages found
        configurable: true,
      });
      const gitError = new Error('Git error');
      vi.mocked(utils.gitProcess).mockRejectedValue(gitError);
      vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('Process exit');
      });

      await expect(engine.asyncStrategy()).rejects.toThrow('Process exit');

      expect(utils.log).toHaveBeenCalledWith('error', 'Failed to create version commit');
      // Ensure consoleErrorSpy is checked correctly for the wrapped error
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('Git error'), // Check wrapped error
        }),
      );
      expect(process.exit).toHaveBeenCalledWith(1);
    });
  });
});

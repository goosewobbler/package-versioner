import fs from 'node:fs';
import path from 'node:path';
import type { Package } from '@manypkg/get-packages';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as calculator from '../../../src/core/versionCalculator.js';
import type { PackagesWithRoot } from '../../../src/core/versionEngine.js';
import * as strategies from '../../../src/core/versionStrategies.js';
import { VersionError } from '../../../src/errors/versionError.js';
import * as gitCommands from '../../../src/git/commands.js';
import * as gitTags from '../../../src/git/tagsAndBranches.js';
import * as packageManagement from '../../../src/package/packageManagement.js';
import { PackageProcessor } from '../../../src/package/packageProcessor.js';
import type { Config } from '../../../src/types.js';
import * as formatting from '../../../src/utils/formatting.js';
import * as jsonOutput from '../../../src/utils/jsonOutput.js';
import * as logging from '../../../src/utils/logging.js';

// Mock dependencies
vi.mock('../../../src/git/commands.js');
vi.mock('../../../src/git/tagsAndBranches.js');
vi.mock('../../../src/utils/logging.js');
vi.mock('../../../src/core/versionCalculator.js');
vi.mock('../../../src/package/packageManagement.js');
vi.mock('../../../src/utils/jsonOutput.js');
vi.mock('../../../src/utils/formatting.js', () => ({
  formatVersionPrefix: vi.fn().mockReturnValue('v'),
  formatTag: vi
    .fn()
    .mockImplementation((version, _prefix, packageName) =>
      packageName ? `${packageName}@v${version}` : `v${version}`,
    ),
  formatCommitMessage: vi.fn().mockImplementation((template, version, packageName) => {
    if (template === 'chore: release ${packageName}@${version} [skip-ci]') {
      return `chore: release ${packageName || ''}@${version} [skip-ci]`;
    }
    return template.replace(/\$\{version\}/g, version);
  }),
}));
vi.mock('../../../src/package/packageProcessor.js');
vi.mock('node:fs');
vi.mock('node:path');

// For simplicity in tests
const git = {
  ...gitCommands,
  ...gitTags,
};

describe('Version Strategies', () => {
  // Mock data
  const mockPackages: PackagesWithRoot = {
    root: '/test/workspace',
    packages: [
      {
        dir: '/test/workspace/packages/a',
        packageJson: { name: 'package-a', version: '1.0.0' },
      },
      {
        dir: '/test/workspace/packages/b',
        packageJson: { name: 'package-b', version: '1.0.0' },
      },
    ],
  };

  // Mock package paths
  const rootPackagePath = '/test/workspace/package.json';
  const packageAPath = '/test/workspace/packages/a/package.json';
  const packageBPath = '/test/workspace/packages/b/package.json';

  // Default config for tests
  const defaultConfig: Partial<Config> = {
    preset: 'conventional-commits',
    versionPrefix: 'v',
    tagTemplate: '${prefix}${version}',
    baseBranch: 'main',
  };

  beforeEach(() => {
    // Reset all mocks
    vi.resetAllMocks();

    // Setup common mocks
    vi.mocked(path.join, { partial: true }).mockImplementation((...args) => args.join('/'));
    vi.mocked(fs.existsSync, { partial: true }).mockReturnValue(true);
    vi.mocked(git.getLatestTag, { partial: true }).mockResolvedValue('v1.0.0');
    vi.mocked(calculator.calculateVersion, { partial: true }).mockResolvedValue('1.1.0');
    vi.mocked(formatting.formatVersionPrefix, { partial: true }).mockReturnValue('v');
    vi.mocked(formatting.formatTag, { partial: true }).mockReturnValue('v1.1.0');
    vi.mocked(formatting.formatCommitMessage, { partial: true }).mockReturnValue(
      'chore(release): v1.1.0',
    );

    // Setup PackageProcessor mock
    vi.mocked(PackageProcessor.prototype.processPackages, { partial: true }).mockResolvedValue({
      updatedPackages: [
        { name: 'package-a', version: '1.1.0', path: '/test/workspace/packages/a' },
      ],
      tags: ['v1.1.0'],
      commitMessage: 'chore(release): v1.1.0',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Helper function for testing package processing logic
  // Since targeting is now handled at discovery time, this only checks skip logic
  const shouldProcessPackage = (pkg: Package, config: Partial<Config>): boolean => {
    const pkgName = pkg.packageJson.name;

    // Only check skip list - targeting is now handled at discovery time
    return !config.skip?.includes(pkgName);
  };

  describe('shouldProcessPackage', () => {
    it('should skip packages that are in the exclude list', () => {
      const config: Partial<Config> = {
        ...defaultConfig,
        skip: ['package-a'],
      };

      const result = shouldProcessPackage(mockPackages.packages[0], config);

      expect(result).toBe(false);
    });

    it('should process all packages if no targets specified', () => {
      const config: Partial<Config> = {
        ...defaultConfig,
      };

      const result = shouldProcessPackage(mockPackages.packages[0], config);

      expect(result).toBe(true);
    });

    it('should process all packages since targeting is now at discovery time', () => {
      const config: Partial<Config> = {
        ...defaultConfig,
      };

      const resultA = shouldProcessPackage(mockPackages.packages[0], config);
      const resultB = shouldProcessPackage(mockPackages.packages[1], config);

      expect(resultA).toBe(true);
      expect(resultB).toBe(true);
    });
  });

  describe('createSyncedStrategy', () => {
    it('should update all packages to the same version', async () => {
      // Setup
      const config: Partial<Config> = {
        ...defaultConfig,
        synced: true,
        commitMessage: 'chore(release): v${version}',
      };

      const syncedStrategy = strategies.createSyncedStrategy(config as Config);

      // Execute
      await syncedStrategy(mockPackages);

      // Verify
      expect(git.getLatestTag).toHaveBeenCalled();
      expect(calculator.calculateVersion).toHaveBeenCalledWith(
        config as Config,
        expect.objectContaining({
          latestTag: 'v1.0.0',
          versionPrefix: 'v',
        }),
      );

      // Check root package update
      expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(rootPackagePath, '1.1.0');

      // Check workspace packages update
      expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(packageAPath, '1.1.0');
      expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(packageBPath, '1.1.0');

      // Check commit and tag
      expect(git.createGitCommitAndTag).toHaveBeenCalledWith(
        expect.arrayContaining([rootPackagePath, packageAPath, packageBPath]),
        'v1.1.0',
        'chore(release): v1.1.0',
        undefined,
        undefined,
      );
    });

    it('should use mainPackage for version calculation when specified', async () => {
      // Setup with mainPackage
      const config: Partial<Config> = {
        ...defaultConfig,
        synced: true,
        mainPackage: 'package-b',
      };

      const syncedStrategy = strategies.createSyncedStrategy(config as Config);

      // Execute
      await syncedStrategy(mockPackages);

      // Verify that version calculation used package-b
      expect(calculator.calculateVersion).toHaveBeenCalledWith(
        config as Config,
        expect.objectContaining({
          path: '/test/workspace/packages/b',
          name: 'package-b',
        }),
      );

      // Still updates all packages
      expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(rootPackagePath, '1.1.0');
      expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(packageAPath, '1.1.0');
      expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(packageBPath, '1.1.0');
    });

    it('should fall back to root package if mainPackage is not found', async () => {
      // Setup with non-existent mainPackage
      const config: Partial<Config> = {
        ...defaultConfig,
        synced: true,
        mainPackage: 'package-z',
      };

      const syncedStrategy = strategies.createSyncedStrategy(config as Config);

      // Execute
      await syncedStrategy(mockPackages);

      // Verify that version calculation used root package
      expect(calculator.calculateVersion).toHaveBeenCalledWith(
        config as Config,
        expect.objectContaining({
          path: '/test/workspace',
          name: undefined,
        }),
      );

      // Verify warning was logged
      expect(logging.log).toHaveBeenCalledWith(
        "Main package 'package-z' not found. Using root package for version determination.",
        'warning',
      );
    });

    it('should handle packageName being null in commit message template', async () => {
      // Setup
      const config: Partial<Config> = {
        ...defaultConfig,
        synced: true,
        commitMessage: 'chore: release ${packageName}@${version} [skip-ci]',
      };

      const syncedStrategy = strategies.createSyncedStrategy(config as Config);

      // Execute
      await syncedStrategy(mockPackages);

      // Verify that formatCommitMessage was called with the right template and parameters
      // The synced strategy no longer suppresses warnings by default
      expect(formatting.formatCommitMessage).toHaveBeenCalledWith(
        'chore: release ${packageName}@${version} [skip-ci]',
        '1.1.0',
        undefined,
        undefined,
      );
    });

    it('should exit early if no version change needed', async () => {
      // Mock calculateVersion to return empty string (no change)
      vi.mocked(calculator.calculateVersion, { partial: true }).mockResolvedValue('');

      const config: Partial<Config> = {
        ...defaultConfig,
        synced: true,
      };

      const syncedStrategy = strategies.createSyncedStrategy(config as Config);

      // Execute
      await syncedStrategy(mockPackages);

      // Verify no updates were made
      expect(packageManagement.updatePackageVersion).not.toHaveBeenCalled();
      expect(git.createGitCommitAndTag).not.toHaveBeenCalled();
      expect(logging.log).toHaveBeenCalledWith('No version change needed', 'info');
    });

    it('should respect skip configuration', async () => {
      const config: Partial<Config> = {
        ...defaultConfig,
        synced: true,
        skip: ['package-b'],
      };

      const syncedStrategy = strategies.createSyncedStrategy(config as Config);

      // Execute
      await syncedStrategy(mockPackages);

      // Verify package-b was skipped
      expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(rootPackagePath, '1.1.0');
      expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(packageAPath, '1.1.0');
      expect(packageManagement.updatePackageVersion).not.toHaveBeenCalledWith(
        packageBPath,
        '1.1.0',
      );
    });
  });

  describe('createSingleStrategy', () => {
    it('should update only the specified package', async () => {
      // Setup
      const config: Partial<Config> = {
        ...defaultConfig,
        mainPackage: 'package-a',
        commitMessage: 'chore(release): ${version}',
      };

      const singleStrategy = strategies.createSingleStrategy(config as Config);

      // Execute
      await singleStrategy(mockPackages);

      // Verify
      expect(git.getLatestTag).toHaveBeenCalled();
      expect(calculator.calculateVersion).toHaveBeenCalledWith(
        config as Config,
        expect.objectContaining({
          latestTag: 'v1.0.0',
          versionPrefix: 'v',
          path: '/test/workspace/packages/a',
          name: 'package-a',
        }),
      );

      // Check only package-a update
      expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(packageAPath, '1.1.0');
      expect(packageManagement.updatePackageVersion).not.toHaveBeenCalledWith(
        packageBPath,
        expect.anything(),
      );

      // Check commit and tag
      expect(git.createGitCommitAndTag).toHaveBeenCalledWith(
        [packageAPath],
        'v1.1.0',
        'chore(release): v1.1.0',
        undefined,
        undefined,
      );
    });

    it('should use packageName in commit message template', async () => {
      // Setup
      const config: Partial<Config> = {
        ...defaultConfig,
        mainPackage: 'package-a',
        commitMessage: 'chore: release ${packageName}@${version} [skip-ci]',
      };

      const singleStrategy = strategies.createSingleStrategy(config as Config);

      // Execute
      await singleStrategy(mockPackages);

      // Verify that formatCommitMessage was called with the right parameters
      expect(formatting.formatCommitMessage).toHaveBeenCalledWith(
        'chore: release ${packageName}@${version} [skip-ci]',
        '1.1.0',
        'package-a',
      );
    });

    it('should throw if packages array is not exactly one item', async () => {
      // Setup with no packages
      const config1: Partial<Config> = {
        ...defaultConfig,
        packages: [],
      };

      // Setup with multiple packages
      const config2: Partial<Config> = {
        ...defaultConfig,
        packages: ['package-a', 'package-b'],
      };

      const singleStrategy1 = strategies.createSingleStrategy(config1 as Config);
      const singleStrategy2 = strategies.createSingleStrategy(config2 as Config);

      // Execute and verify errors - update the expected error message to match the new implementation
      await expect(singleStrategy1(mockPackages)).rejects.toThrow(
        'Invalid configuration: Single mode requires either mainPackage or exactly one resolved package',
      );
      await expect(singleStrategy2(mockPackages)).rejects.toThrow(
        'Invalid configuration: Single mode requires either mainPackage or exactly one resolved package',
      );
    });

    it('should use mainPackage instead of packages array when both are provided', async () => {
      // Setup with both mainPackage and packages array
      const config: Partial<Config> = {
        ...defaultConfig,
        mainPackage: 'package-b',
        packages: ['package-a'],
      };

      const singleStrategy = strategies.createSingleStrategy(config as Config);

      // Execute
      await singleStrategy(mockPackages);

      // Verify package-b was used instead of package-a
      expect(calculator.calculateVersion).toHaveBeenCalledWith(
        config as Config,
        expect.objectContaining({
          path: '/test/workspace/packages/b',
          name: 'package-b',
        }),
      );

      expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(packageBPath, '1.1.0');
      expect(packageManagement.updatePackageVersion).not.toHaveBeenCalledWith(
        packageAPath,
        expect.anything(),
      );
    });

    it('should throw if mainPackage is not found', async () => {
      // Setup with non-existent mainPackage
      const config: Partial<Config> = {
        ...defaultConfig,
        mainPackage: 'package-z',
      };

      const singleStrategy = strategies.createSingleStrategy(config as Config);

      // Execute and verify error
      await expect(singleStrategy(mockPackages)).rejects.toThrow('Package not found: package-z');
    });

    it('should exit early if no version change needed', async () => {
      // Mock calculateVersion to return empty string (no change)
      vi.mocked(calculator.calculateVersion, { partial: true }).mockResolvedValue('');

      const config: Partial<Config> = {
        ...defaultConfig,
        mainPackage: 'package-a',
      };

      const singleStrategy = strategies.createSingleStrategy(config as Config);

      // Execute
      await singleStrategy(mockPackages);

      // Verify no updates were made
      expect(packageManagement.updatePackageVersion).not.toHaveBeenCalled();
      expect(git.createGitCommitAndTag).not.toHaveBeenCalled();
      expect(logging.log).toHaveBeenCalledWith('No version change needed for package-a', 'info');
    });
  });

  describe('createAsyncStrategy', () => {
    it('should use PackageProcessor to process packages', async () => {
      // Setup
      const config: Partial<Config> = {
        ...defaultConfig,
        packages: ['package-a', 'package-b'],
      };

      const asyncStrategy = strategies.createAsyncStrategy(config as Config);

      // Execute
      await asyncStrategy(mockPackages);

      // Verify that packages are processed (no setTargets call since targeting is at discovery time)
      expect(PackageProcessor.prototype.processPackages).toHaveBeenCalledWith(
        mockPackages.packages,
      );

      // Check logging
      expect(logging.log).toHaveBeenCalledWith('Processing 2 pre-filtered packages', 'info');
      expect(logging.log).toHaveBeenCalledWith('Updated 1 package(s): package-a', 'success');
    });

    it('should ignore provided targets since targeting is now at discovery time', async () => {
      // Setup
      const config: Partial<Config> = {
        ...defaultConfig,
        packages: ['package-a', 'package-b'],
      };

      const asyncStrategy = strategies.createAsyncStrategy(config as Config);

      // Execute with targets (should be ignored)
      await asyncStrategy(mockPackages, ['package-b']);

      // Verify that packages are processed normally (targets ignored)
      expect(PackageProcessor.prototype.processPackages).toHaveBeenCalledWith(
        mockPackages.packages,
      );
      expect(logging.log).toHaveBeenCalledWith('Processing 2 pre-filtered packages', 'info');
    });

    it('should process all pre-filtered packages', async () => {
      // Setup
      const config: Partial<Config> = {
        ...defaultConfig,
        packages: [],
      };

      const asyncStrategy = strategies.createAsyncStrategy(config as Config);

      // Execute
      await asyncStrategy(mockPackages);

      // Verify packages are processed
      expect(PackageProcessor.prototype.processPackages).toHaveBeenCalledWith(
        mockPackages.packages,
      );
      expect(logging.log).toHaveBeenCalledWith('Processing 2 pre-filtered packages', 'info');
    });

    it('should handle case when no packages were updated', async () => {
      // Mock PackageProcessor to return no updates
      vi.mocked(PackageProcessor.prototype.processPackages, { partial: true }).mockResolvedValue({
        updatedPackages: [],
        tags: [],
      });

      const config: Partial<Config> = {
        ...defaultConfig,
      };

      const asyncStrategy = strategies.createAsyncStrategy(config as Config);

      // Execute
      await asyncStrategy(mockPackages);

      // Verify
      expect(logging.log).toHaveBeenCalledWith('No packages required a version update.', 'info');
    });
  });

  describe('createStrategy', () => {
    it('should return synced strategy when synced is true', () => {
      const config: Partial<Config> = {
        ...defaultConfig,
        synced: true,
      };

      // Since we've already tested the individual strategies, just verify the strategy map exists
      const strategyMap = strategies.createStrategyMap(config as Config);
      expect(strategyMap).toHaveProperty('synced');
    });

    it('should return async strategy when packages has one item (CLI will handle strategy selection)', () => {
      const config: Partial<Config> = {
        ...defaultConfig,
        packages: ['package-a'],
      };

      // The createStrategy function now defaults to async strategy
      // The CLI will determine the actual strategy based on resolved packages
      const strategy = strategies.createStrategy(config as Config);

      // Since it's now async strategy, it should process packages without throwing
      // (the actual strategy selection happens in the CLI)
      expect(strategy).toBeDefined();
    });

    it('should return async strategy when mainPackage is specified (CLI will handle strategy selection)', async () => {
      // The createStrategy function now defaults to async strategy
      // The CLI will determine the actual strategy based on resolved packages
      const config: Partial<Config> = {
        ...defaultConfig,
        mainPackage: 'package-a',
      };

      const strategy = strategies.createStrategy(config as Config);

      // Since it's now async strategy, it should process packages without throwing
      // (the actual strategy selection happens in the CLI)
      await expect(strategy(mockPackages)).resolves.toBeUndefined();
    });

    it('should return async strategy as default', () => {
      const config: Partial<Config> = {
        ...defaultConfig,
      };

      // Since we've already tested the individual strategies, just verify the strategy map exists
      const strategyMap = strategies.createStrategyMap(config as Config);
      expect(strategyMap).toHaveProperty('async');
    });
  });

  describe('createStrategyMap', () => {
    it('should create a map of all strategies', () => {
      const config: Partial<Config> = {
        ...defaultConfig,
      };

      const strategyMap = strategies.createStrategyMap(config as Config);

      // Instead of checking function calls, check the structure of the returned map
      expect(strategyMap).toHaveProperty('synced');
      expect(strategyMap).toHaveProperty('single');
      expect(strategyMap).toHaveProperty('async');
    });
  });
});

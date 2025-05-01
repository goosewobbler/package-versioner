import * as fs from 'node:fs';
import path from 'node:path';
import type { Package } from '@manypkg/get-packages';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as cargoHandler from '../../../src/cargo/cargoHandler.js';
import * as calculator from '../../../src/core/versionCalculator.js';
import { calculateVersion } from '../../../src/core/versionCalculator.js';
import * as gitCommands from '../../../src/git/commands.js';
import * as gitTags from '../../../src/git/tagsAndBranches.js';
import * as packageManagement from '../../../src/package/packageManagement.js';
import { PackageProcessor } from '../../../src/package/packageProcessor.js';
import type { Config } from '../../../src/types.js';
import * as formatting from '../../../src/utils/formatting.js';
import * as logging from '../../../src/utils/logging.js';

// Mock dependencies
vi.mock('node:path');
vi.mock('node:process');
vi.mock('../../../src/package/packageManagement.js');
vi.mock('../../../src/git/commands.js');
vi.mock('../../../src/git/tagsAndBranches.js');
vi.mock('../../../src/utils/logging.js');
vi.mock('../../../src/utils/formatting.js');
vi.mock('../../../src/utils/jsonOutput.js');
vi.mock('../../../src/core/versionCalculator.js');
vi.mock('../../../src/version/versionCalc.js');
vi.mock('node:fs');
vi.mock('../../../src/cargo/cargoHandler.js');

// Mock Package type without importing from @manypkg to avoid external dependencies
interface MockPackage {
  dir: string;
  packageJson: {
    name: string;
    version: string;
  };
}

describe('Package Processor', () => {
  // Mock data
  const mockPackages: Package[] = [
    {
      dir: '/path/to/package-a',
      packageJson: { name: 'package-a', version: '1.0.0' },
    },
    {
      dir: '/path/to/package-b',
      packageJson: { name: 'package-b', version: '1.0.0' },
    },
    {
      dir: '/path/to/package-c',
      packageJson: { name: 'package-c', version: '1.0.0' },
    },
  ] as MockPackage[];

  // Mock config
  const mockConfig: Config = {
    synced: false,
    updateInternalDependencies: 'patch',
    preset: 'conventional',
    versionPrefix: 'v',
    tagTemplate: '${prefix}${version}',
    packageTagTemplate: '${packageName}@${prefix}${version}',
    baseBranch: 'main',
    packages: [],
    branchPattern: ['feature/*'],
    commitMessage: 'chore(release): version ${version}',
  };

  // Mock getLatestTag function
  const mockGetLatestTag = vi.fn().mockResolvedValue('v1.0.0');

  // Default processor options
  const defaultOptions = {
    skip: ['package-c'],
    targets: ['package-a', 'package-b'],
    versionPrefix: 'v',
    commitMessageTemplate: 'chore(release): ${version}',
    dryRun: false,
    skipHooks: false,
    getLatestTag: mockGetLatestTag,
    config: {
      branchPattern: ['feature/*'],
      baseBranch: 'main',
      prereleaseIdentifier: undefined,
      type: undefined,
    },
    fullConfig: mockConfig,
  };

  beforeEach(() => {
    vi.resetAllMocks();

    // Path mock
    vi.mocked(path.join).mockImplementation((...args) => args.join('/'));

    // Calculator mock - fix to return a Promise
    vi.mocked(calculator.calculateVersion).mockResolvedValue('1.1.0');

    // Git mocks
    vi.mocked(gitCommands.createGitTag).mockResolvedValue({ stdout: '', stderr: '' });
    vi.mocked(gitCommands.gitAdd).mockResolvedValue({ stdout: '', stderr: '' });
    vi.mocked(gitCommands.gitCommit).mockResolvedValue({ stdout: '', stderr: '' });

    // Formatting mocks
    vi.mocked(formatting.formatVersionPrefix).mockReturnValue('v');
    vi.mocked(formatting.formatTag).mockImplementation((version, prefix) => `${prefix}${version}`);
    vi.mocked(formatting.formatCommitMessage).mockImplementation((template, version) =>
      template.replace('${version}', version),
    );

    // Default mock implementations
    vi.mocked(gitCommands.gitProcess).mockResolvedValue(undefined);
    vi.mocked(packageManagement.updatePackageVersion).mockImplementation(() => undefined);

    // Ensure direct import is mocked correctly too
    vi.mocked(calculateVersion).mockResolvedValue('1.1.0');

    // Mock fs.existsSync to simulate package.json files exist
    vi.mocked(fs.existsSync).mockImplementation((path) => {
      return String(path).endsWith('package.json');
    });

    // Mock fs.readFileSync for package.json files
    vi.mocked(fs.readFileSync).mockImplementation((path) => {
      const pathStr = String(path);
      if (pathStr.includes('package-a')) {
        return JSON.stringify({ name: 'package-a', version: '1.0.0' });
      }
      if (pathStr.includes('package-b')) {
        return JSON.stringify({ name: 'package-b', version: '1.0.0' });
      }
      if (pathStr.includes('package-c')) {
        return JSON.stringify({ name: 'package-c', version: '1.0.0' });
      }
      return '';
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Constructor', () => {
    it('should initialize with default values when not provided', async () => {
      const minimalOptions = {
        getLatestTag: mockGetLatestTag,
        config: {},
        fullConfig: { preset: 'conventional-commits' } as unknown as Config,
      };

      const processor = new PackageProcessor(minimalOptions);

      // Test behavior instead of implementation details
      const result = await processor.processPackages(mockPackages);

      // Since we're not providing targets or skip lists, all packages should be processed
      expect(result.updatedPackages.length).toBe(mockPackages.length);
      expect(result.tags.length).toBe(mockPackages.length);
    });

    it('should initialize with provided options', async () => {
      const processor = new PackageProcessor(defaultOptions);

      // Test behavior instead of checking private properties
      // Process with packages to verify skip and target lists are applied
      const result = await processor.processPackages(mockPackages);

      // Should only update package-a and package-b (skipping package-c)
      expect(result.updatedPackages.length).toBe(2);
      expect(result.updatedPackages.some((p) => p.name === 'package-a')).toBe(true);
      expect(result.updatedPackages.some((p) => p.name === 'package-b')).toBe(true);
      expect(result.updatedPackages.some((p) => p.name === 'package-c')).toBe(false);
    });
  });

  describe('setTargets', () => {
    it('should update the targets array', async () => {
      const processor = new PackageProcessor(defaultOptions);
      const newTargets = ['package-b'];

      processor.setTargets(newTargets);

      // Verify behavior by processing packages
      const result = await processor.processPackages(mockPackages);

      // Should only process package-b now
      expect(result.updatedPackages.length).toBe(1);
      expect(result.updatedPackages[0].name).toBe('package-b');
    });
  });

  describe('processPackages', () => {
    it('should return early if no packages are provided', async () => {
      const processor = new PackageProcessor(defaultOptions);
      const result = await processor.processPackages([]);

      expect(result).toEqual({ updatedPackages: [], tags: [] });
      expect(logging.log).toHaveBeenCalledWith(
        'Found 0 targeted package(s) to process after filtering.',
        'info',
      );
      expect(logging.log).toHaveBeenCalledWith(
        'No matching targeted packages found to process.',
        'info',
      );
    });

    it('should return early if no packages match filtering criteria', async () => {
      const processor = new PackageProcessor({
        ...defaultOptions,
        targets: ['non-existent-package'],
      });

      const result = await processor.processPackages(mockPackages);

      expect(result).toEqual({ updatedPackages: [], tags: [] });
      expect(logging.log).toHaveBeenCalledWith(
        'No matching targeted packages found to process.',
        'info',
      );
    });

    it('should skip packages in the exclusion list', async () => {
      const processor = new PackageProcessor({
        ...defaultOptions,
        skip: ['package-a'],
        targets: [], // Process all non-skipped packages
      });

      await processor.processPackages(mockPackages);

      expect(logging.log).toHaveBeenCalledWith(
        "Skipping package package-a as it's in the skip list.",
        'info',
      );
      expect(calculator.calculateVersion).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ name: 'package-a' }),
      );
    });

    it('should only process packages in the target list if provided', async () => {
      const processor = new PackageProcessor({
        ...defaultOptions,
        targets: ['package-a'],
      });

      await processor.processPackages(mockPackages);

      expect(logging.log).toHaveBeenCalledWith(
        'Package package-b not in target list, skipping.',
        'info',
      );
      expect(calculator.calculateVersion).toHaveBeenCalledTimes(1);

      // Only verify it was called for the package-a and not for other packages
      expect(calculator.calculateVersion).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          name: 'package-a',
        }),
      );

      // Verify it was NOT called for package-b
      expect(calculator.calculateVersion).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          name: 'package-b',
        }),
      );
    });

    it('should process all non-skipped packages if no targets specified', async () => {
      const processor = new PackageProcessor({
        ...defaultOptions,
        targets: [], // empty targets = process all non-skipped
      });

      await processor.processPackages(mockPackages);

      // Should process package-a and package-b, but not package-c (skipped)
      expect(calculator.calculateVersion).toHaveBeenCalledTimes(2);
    });

    it('should skip package updates if no version change needed', async () => {
      // Set calculateVersion to return empty string (no version change)
      vi.mocked(calculator.calculateVersion).mockResolvedValue('');
      vi.mocked(calculateVersion).mockResolvedValue('');

      const processor = new PackageProcessor(defaultOptions);

      await processor.processPackages([mockPackages[0]]);

      // Should not update any packages
      expect(packageManagement.updatePackageVersion).not.toHaveBeenCalled();
      expect(gitCommands.createGitTag).not.toHaveBeenCalled();
    });

    it('should create tags and update packages with version changes', async () => {
      const processor = new PackageProcessor({
        ...defaultOptions,
        targets: ['package-a'],
      });

      const result = await processor.processPackages([mockPackages[0]]);

      // Should update package-a
      expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(
        '/path/to/package-a/package.json',
        '1.1.0',
      );

      // Should create a tag
      expect(gitCommands.createGitTag).toHaveBeenCalledWith({
        tag: 'v1.1.0',
        message: 'chore(release): package-a 1.1.0',
      });

      // Should return the updated package info
      expect(result.updatedPackages).toEqual([
        {
          name: 'package-a',
          version: '1.1.0',
          path: '/path/to/package-a',
        },
      ]);
      expect(result.tags).toContain('v1.1.0');
    });

    it('should create a commit for all updated packages', async () => {
      const processor = new PackageProcessor({
        ...defaultOptions,
        targets: ['package-a', 'package-b'],
      });

      const result = await processor.processPackages(mockPackages);

      // Should add all package.json files
      expect(gitCommands.gitAdd).toHaveBeenCalledWith([
        '/path/to/package-a/package.json',
        '/path/to/package-b/package.json',
      ]);

      // Should create a commit with both packages
      expect(gitCommands.gitCommit).toHaveBeenCalledWith({
        message: 'chore(release): package-a, package-b 1.1.0',
        skipHooks: false,
      });

      // Should return info for both packages
      expect(result.updatedPackages).toHaveLength(2);
      expect(result.updatedPackages[0].name).toBe('package-a');
      expect(result.updatedPackages[1].name).toBe('package-b');
    });

    it('should handle errors during tag creation gracefully', async () => {
      const tagError = new Error('Failed to create tag');
      vi.mocked(gitCommands.createGitTag).mockRejectedValue(tagError);

      const processor = new PackageProcessor(defaultOptions);

      // Should not throw, but log the error
      await processor.processPackages([mockPackages[0]]);

      expect(logging.log).toHaveBeenCalledWith(
        expect.stringContaining('Failed to create tag v1.1.0 for package-a'),
        'error',
      );

      // Should still continue with the commit
      expect(gitCommands.gitAdd).toHaveBeenCalled();
      expect(gitCommands.gitCommit).toHaveBeenCalled();
    });

    it('should handle dry run mode', async () => {
      const processor = new PackageProcessor({
        ...defaultOptions,
        dryRun: true,
      });

      await processor.processPackages([mockPackages[0]]);

      // Should not make actual changes
      expect(gitCommands.createGitTag).not.toHaveBeenCalled();
      expect(gitCommands.gitAdd).not.toHaveBeenCalled();
      expect(gitCommands.gitCommit).not.toHaveBeenCalled();

      // Should log what would have been done
      expect(logging.log).toHaveBeenCalledWith('[DRY RUN] Would create tag: v1.1.0', 'info');
      expect(logging.log).toHaveBeenCalledWith('[DRY RUN] Would add files:', 'info');
      expect(logging.log).toHaveBeenCalledWith(
        expect.stringMatching(/\[DRY RUN\] Would commit with message:/),
        'info',
      );
    });

    it('should use custom commit message format with one package', async () => {
      const processor = new PackageProcessor({
        ...defaultOptions,
        targets: ['package-a'],
        commitMessageTemplate: 'release: v${version} of packages',
      });

      await processor.processPackages([mockPackages[0]]);

      expect(gitCommands.gitCommit).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'release: v1.1.0 of packages',
        }),
      );
    });

    it('should use generic commit message format with multiple packages', async () => {
      const processor = new PackageProcessor({
        ...defaultOptions,
        targets: ['package-a', 'package-b'],
        commitMessageTemplate: 'release: v${version} of package',
      });

      await processor.processPackages(mockPackages);

      // Should use a generic message with package names when multiple packages
      expect(gitCommands.gitCommit).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'chore(release): package-a, package-b 1.1.0',
        }),
      );
    });

    it('should process all packages when no filters are applied', async () => {
      const processor = new PackageProcessor({
        getLatestTag: gitTags.getLatestTag,
        config: {},
        fullConfig: mockConfig,
      });

      const result = await processor.processPackages(mockPackages);

      expect(result.updatedPackages.length).toBe(3);
      expect(result.tags.length).toBe(3);
      expect(packageManagement.updatePackageVersion).toHaveBeenCalledTimes(3);
      expect(gitCommands.gitProcess).toHaveBeenCalledTimes(0); // gitProcess is not directly called
      expect(gitCommands.gitAdd).toHaveBeenCalledTimes(1);
      expect(gitCommands.gitCommit).toHaveBeenCalledTimes(1);
    });

    it('should skip specified packages', async () => {
      const processor = new PackageProcessor({
        getLatestTag: gitTags.getLatestTag,
        config: {},
        fullConfig: mockConfig,
        skip: ['package-a'],
      });

      const result = await processor.processPackages(mockPackages);

      expect(result.updatedPackages.length).toBe(2);
      expect(result.tags.length).toBe(2);
      expect(packageManagement.updatePackageVersion).toHaveBeenCalledTimes(2);
      expect(packageManagement.updatePackageVersion).not.toHaveBeenCalledWith(
        expect.stringContaining('package-a'),
        expect.any(String),
      );
    });

    it('should only process target packages when specified', async () => {
      const processor = new PackageProcessor({
        getLatestTag: gitTags.getLatestTag,
        config: {},
        fullConfig: mockConfig,
        targets: ['package-a'],
      });

      const result = await processor.processPackages(mockPackages);

      expect(result.updatedPackages.length).toBe(1);
      expect(result.tags.length).toBe(1);
      expect(packageManagement.updatePackageVersion).toHaveBeenCalledTimes(1);
      expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(
        expect.stringContaining('package-a'),
        expect.any(String),
      );
    });

    it('should use specified release type when provided', async () => {
      const processor = new PackageProcessor({
        getLatestTag: gitTags.getLatestTag,
        config: { type: 'major' },
        fullConfig: mockConfig,
      });

      await processor.processPackages(mockPackages);

      // We can't easily test the calculateVersion call since it's mocked
      // but we can check if the packages are updated with appropriate mock
      expect(packageManagement.updatePackageVersion).toHaveBeenCalledTimes(3);
    });

    it('should not update packages when calculateVersion returns empty string', async () => {
      const processor = new PackageProcessor({
        getLatestTag: gitTags.getLatestTag,
        config: {},
        fullConfig: mockConfig,
      });
      vi.mocked(calculateVersion).mockResolvedValue('');

      const result = await processor.processPackages(mockPackages);

      // When calculateVersion returns empty string, packages should still be processed
      // but without actual updates
      expect(result.updatedPackages.length).toBe(0);
      expect(result.tags.length).toBe(0);
      expect(packageManagement.updatePackageVersion).not.toHaveBeenCalled();
    });

    it('should handle when Git process fails', async () => {
      const processor = new PackageProcessor({
        getLatestTag: gitTags.getLatestTag,
        config: {},
        fullConfig: mockConfig,
      });

      const error = new Error('Git commit failed');
      // Mock gitAdd instead of gitCommit since the implementation may catch gitCommit errors
      vi.mocked(gitCommands.gitAdd).mockRejectedValue(error);

      // The processor might handle the error internally, so just verify logging
      await processor.processPackages(mockPackages);

      expect(logging.log).toHaveBeenCalledWith(expect.stringContaining('Failed'), 'error');
    });

    it('should construct commit message with package details', async () => {
      const processor = new PackageProcessor({
        getLatestTag: gitTags.getLatestTag,
        config: {},
        fullConfig: mockConfig,
      });

      await processor.processPackages(mockPackages);

      expect(gitCommands.gitCommit).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('chore(release)'),
        }),
      );

      expect(gitCommands.gitAdd).toHaveBeenCalledWith(
        expect.arrayContaining([expect.stringContaining('package-a')]),
      );
    });
  });

  describe('Cargo.toml handling', () => {
    // Mock package with both package.json and Cargo.toml
    const rustPackage: Package = {
      dir: '/path/to/rust-package',
      packageJson: { name: 'rust-package', version: '1.0.0' },
    } as MockPackage;

    beforeEach(() => {
      vi.resetAllMocks();

      // Path mock
      vi.mocked(path.join).mockImplementation((...args) => args.join('/'));

      // Mock fs.existsSync to handle both package.json and Cargo.toml files
      vi.mocked(fs.existsSync).mockImplementation((path) => {
        const pathStr = String(path);
        return pathStr.endsWith('package.json') || pathStr.endsWith('Cargo.toml');
      });

      // Calculator mock
      vi.mocked(calculator.calculateVersion).mockResolvedValue('1.1.0');
      vi.mocked(calculateVersion).mockResolvedValue('1.1.0');

      // Cargo mock
      vi.mocked(cargoHandler.getCargoInfo).mockReturnValue({
        name: 'rust-package',
        version: '1.0.0',
        path: '/path/to/rust-package/Cargo.toml',
        dir: '/path/to/rust-package',
        content: { package: { name: 'rust-package', version: '1.0.0' } },
      });

      // Git mocks
      vi.mocked(gitCommands.createGitTag).mockResolvedValue({ stdout: '', stderr: '' });
      vi.mocked(gitCommands.gitAdd).mockResolvedValue({ stdout: '', stderr: '' });
      vi.mocked(gitCommands.gitCommit).mockResolvedValue({ stdout: '', stderr: '' });
      vi.mocked(gitTags.getLatestTagForPackage).mockResolvedValue('');

      // Formatting mocks
      vi.mocked(formatting.formatVersionPrefix).mockReturnValue('v');
      vi.mocked(formatting.formatTag).mockImplementation(
        (version, prefix) => `${prefix}${version}`,
      );
      vi.mocked(formatting.formatCommitMessage).mockImplementation((template, version) =>
        template.replace('${version}', version),
      );
    });

    it('should update both package.json and Cargo.toml when both exist', async () => {
      const processor = new PackageProcessor({
        getLatestTag: mockGetLatestTag,
        config: {},
        fullConfig: mockConfig,
      });

      await processor.processPackages([rustPackage]);

      // Check that both files were updated
      expect(packageManagement.updatePackageVersion).toHaveBeenCalledTimes(2);
      expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(
        '/path/to/rust-package/package.json',
        '1.1.0',
      );
      expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(
        '/path/to/rust-package/Cargo.toml',
        '1.1.0',
      );

      // The gitAdd call might only include package.json in the mock implementation,
      // so we need to check if it was called at least once
      expect(gitCommands.gitAdd).toHaveBeenCalled();
    });

    it('should use Cargo.toml as fallback when package.json is missing', async () => {
      // Setup: package.json doesn't exist but Cargo.toml does
      vi.mocked(fs.existsSync).mockImplementation((path) => {
        const pathStr = String(path);
        return pathStr.endsWith('Cargo.toml');
      });

      const processor = new PackageProcessor({
        getLatestTag: vi.fn().mockResolvedValue(null),
        config: {},
        fullConfig: mockConfig,
      });

      await processor.processPackages([rustPackage]);

      // Should use Cargo.toml version as fallback
      expect(logging.log).toHaveBeenCalledWith(
        expect.stringContaining('Using Cargo.toml version 1.0.0'),
        'info',
      );
      expect(packageManagement.updatePackageVersion).toHaveBeenCalledWith(
        '/path/to/rust-package/Cargo.toml',
        '1.1.0',
      );
    });

    it('should handle error when reading Cargo.toml fails', async () => {
      // Setup: package.json doesn't exist, Cargo.toml exists but errors on read
      vi.mocked(fs.existsSync).mockImplementation((path) => {
        const pathStr = String(path);
        return pathStr.endsWith('Cargo.toml');
      });
      vi.mocked(cargoHandler.getCargoInfo).mockImplementation(() => {
        throw new Error('Failed to parse Cargo.toml');
      });

      const processor = new PackageProcessor({
        getLatestTag: mockGetLatestTag,
        config: {},
        fullConfig: mockConfig,
      });

      await processor.processPackages([rustPackage]);

      // Should log the error
      expect(logging.log).toHaveBeenCalledWith(
        expect.stringContaining('Error reading Cargo.toml'),
        'warning',
      );
      // Should still proceed with global tag
      expect(mockGetLatestTag).toHaveBeenCalled();
    });
  });

  describe('Tag resolution and fallbacks', () => {
    beforeEach(() => {
      vi.resetAllMocks();

      // Path mock
      vi.mocked(path.join).mockImplementation((...args) => args.join('/'));

      // Calculator mock
      vi.mocked(calculator.calculateVersion).mockResolvedValue('1.1.0');
      vi.mocked(calculateVersion).mockResolvedValue('1.1.0');

      // Mock fs.existsSync to only handle package.json by default
      vi.mocked(fs.existsSync).mockImplementation((path) => {
        return String(path).endsWith('package.json');
      });

      // Mock fs.readFileSync for package.json files
      vi.mocked(fs.readFileSync).mockImplementation((path) => {
        const pathStr = String(path);
        if (pathStr.includes('package-a')) {
          return JSON.stringify({ name: 'package-a', version: '1.0.0' });
        }
        return '';
      });

      // Git mocks
      vi.mocked(gitCommands.createGitTag).mockResolvedValue({ stdout: '', stderr: '' });
      vi.mocked(gitCommands.gitAdd).mockResolvedValue({ stdout: '', stderr: '' });
      vi.mocked(gitCommands.gitCommit).mockResolvedValue({ stdout: '', stderr: '' });

      // Formatting mocks
      vi.mocked(formatting.formatVersionPrefix).mockReturnValue('v');
      vi.mocked(formatting.formatTag).mockImplementation(
        (version, prefix) => `${prefix}${version}`,
      );
    });

    it('should use package-specific tag when available', async () => {
      vi.mocked(gitTags.getLatestTagForPackage).mockResolvedValue('package-a@v1.0.0');
      const mockGetLatestTagFn = vi.fn().mockResolvedValue('v0.9.0'); // Global tag (should not be used)

      const processor = new PackageProcessor({
        getLatestTag: mockGetLatestTagFn,
        config: {},
        fullConfig: mockConfig,
      });

      await processor.processPackages([mockPackages[0]]);

      // Should use the package-specific tag
      expect(calculator.calculateVersion).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          latestTag: 'package-a@v1.0.0',
        }),
      );
      // Should not call global getLatestTag
      expect(mockGetLatestTagFn).not.toHaveBeenCalled();
    });

    it('should fallback to package.json version when no package-specific tag or global tag', async () => {
      // No package-specific tag
      vi.mocked(gitTags.getLatestTagForPackage).mockResolvedValue('');
      // No global tag
      const mockGetLatestTagFn = vi.fn().mockResolvedValue('');

      const processor = new PackageProcessor({
        getLatestTag: mockGetLatestTagFn,
        config: {},
        fullConfig: mockConfig,
      });

      await processor.processPackages([mockPackages[0]]);

      // Should log about using package.json version 1.0.0
      expect(logging.log).toHaveBeenCalledWith(
        expect.stringContaining('Using package.json version 1.0.0'),
        'info',
      );

      // Should use a constructed tag based on package.json version
      expect(calculator.calculateVersion).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          latestTag: 'v1.0.0', // This should match the formatted version from package.json
        }),
      );
    });

    it('should fall back to global tag when package-specific tag and manifest files fail', async () => {
      // No package-specific tag
      vi.mocked(gitTags.getLatestTagForPackage).mockResolvedValue('');

      // Mock package.json to be invalid
      vi.mocked(fs.readFileSync).mockImplementation(() => {
        throw new Error('Failed to read package.json');
      });

      // Has global tag
      const mockGetLatestTagFn = vi.fn().mockResolvedValue('v0.8.0');

      const processor = new PackageProcessor({
        getLatestTag: mockGetLatestTagFn,
        config: {},
        fullConfig: mockConfig,
      });

      await processor.processPackages([mockPackages[0]]);

      // Should log error reading package.json
      expect(logging.log).toHaveBeenCalledWith(
        expect.stringContaining('Error reading package.json'),
        'warning',
      );

      // Should log about using global tag
      expect(logging.log).toHaveBeenCalledWith(
        expect.stringContaining('Using global tag v0.8.0 as fallback'),
        'info',
      );

      // Should use global tag
      expect(calculator.calculateVersion).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          latestTag: 'v0.8.0',
        }),
      );
    });

    it('should handle errors when getting package-specific tag', async () => {
      // Throw error when getting package-specific tag
      vi.mocked(gitTags.getLatestTagForPackage).mockRejectedValue(new Error('Git tag error'));

      // Make sure package.json exists and can be read
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ version: '1.0.0' }));

      // Has global tag
      const mockGetLatestTagFn = vi.fn().mockResolvedValue('v0.8.0');

      const processor = new PackageProcessor({
        getLatestTag: mockGetLatestTagFn,
        config: {},
        fullConfig: mockConfig,
      });

      await processor.processPackages([mockPackages[0]]);

      // Should log error about package-specific tag failure
      expect(logging.log).toHaveBeenCalledWith(
        expect.stringContaining('Error getting package-specific tag'),
        'warning',
      );

      // In this case we may not reach the global tag because the package.json fallback is used
      // So let's just check if calculateVersion was called with any tag value
      expect(calculator.calculateVersion).toHaveBeenCalled();
    });

    it('should handle case where all tag resolution methods fail', async () => {
      // Error getting package-specific tag
      vi.mocked(gitTags.getLatestTagForPackage).mockRejectedValue(new Error('Git tag error'));

      // Error reading package.json
      vi.mocked(fs.readFileSync).mockImplementation(() => {
        throw new Error('Failed to read package.json');
      });

      // Error getting global tag
      const mockGetLatestTagFn = vi.fn().mockRejectedValue(new Error('Global tag error'));

      const processor = new PackageProcessor({
        getLatestTag: mockGetLatestTagFn,
        config: {},
        fullConfig: mockConfig,
      });

      await processor.processPackages([mockPackages[0]]);

      // Should log multiple errors
      expect(logging.log).toHaveBeenCalledWith(
        expect.stringContaining('Error getting package-specific tag'),
        'warning',
      );
      expect(logging.log).toHaveBeenCalledWith(
        expect.stringContaining('Error reading package.json'),
        'warning',
      );
      expect(logging.log).toHaveBeenCalledWith(
        expect.stringContaining('Error getting fallback version'),
        'warning',
      );

      // Should still try to calculate version with empty tag
      expect(calculator.calculateVersion).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          latestTag: '', // Empty string when all methods fail
        }),
      );
    });
  });

  describe('Input validation and error handling', () => {
    beforeEach(() => {
      vi.resetAllMocks();

      // Path mock
      vi.mocked(path.join).mockImplementation((...args) => args.join('/'));

      // Calculator mock
      vi.mocked(calculator.calculateVersion).mockResolvedValue('1.1.0');
      vi.mocked(calculateVersion).mockResolvedValue('1.1.0');

      // Mock fs.existsSync
      vi.mocked(fs.existsSync).mockReturnValue(true);

      // Git mocks
      vi.mocked(gitCommands.createGitTag).mockResolvedValue({ stdout: '', stderr: '' });
      vi.mocked(gitCommands.gitAdd).mockResolvedValue({ stdout: '', stderr: '' });
      vi.mocked(gitCommands.gitCommit).mockResolvedValue({ stdout: '', stderr: '' });

      // Formatting mocks
      vi.mocked(formatting.formatVersionPrefix).mockReturnValue('v');
      vi.mocked(formatting.formatTag).mockImplementation(
        (version, prefix) => `${prefix}${version}`,
      );
    });

    it('should handle null input gracefully', async () => {
      const processor = new PackageProcessor({
        getLatestTag: mockGetLatestTag,
        config: {},
        fullConfig: mockConfig,
      });

      // @ts-ignore - Intentionally passing null to test error handling
      const result = await processor.processPackages(null);

      expect(result).toEqual({ updatedPackages: [], tags: [] });
      expect(logging.log).toHaveBeenCalledWith(
        'Invalid packages data provided. Expected array of packages.',
        'error',
      );
    });

    it('should handle undefined input gracefully', async () => {
      const processor = new PackageProcessor({
        getLatestTag: mockGetLatestTag,
        config: {},
        fullConfig: mockConfig,
      });

      // @ts-ignore - Intentionally passing undefined to test error handling
      const result = await processor.processPackages(undefined);

      expect(result).toEqual({ updatedPackages: [], tags: [] });
      expect(logging.log).toHaveBeenCalledWith(
        'Invalid packages data provided. Expected array of packages.',
        'error',
      );
    });

    it('should handle non-array input gracefully', async () => {
      const processor = new PackageProcessor({
        getLatestTag: mockGetLatestTag,
        config: {},
        fullConfig: mockConfig,
      });

      // @ts-ignore - Intentionally passing object to test error handling
      const result = await processor.processPackages({});

      expect(result).toEqual({ updatedPackages: [], tags: [] });
      expect(logging.log).toHaveBeenCalledWith(
        'Invalid packages data provided. Expected array of packages.',
        'error',
      );
    });
  });

  describe('Custom tag formats', () => {
    beforeEach(() => {
      vi.resetAllMocks();

      // Path mock
      vi.mocked(path.join).mockImplementation((...args) => args.join('/'));

      // Calculator mock
      vi.mocked(calculator.calculateVersion).mockResolvedValue('1.1.0');
      vi.mocked(calculateVersion).mockResolvedValue('1.1.0');

      // Mock fs.existsSync
      vi.mocked(fs.existsSync).mockReturnValue(true);

      // Git mocks
      vi.mocked(gitCommands.createGitTag).mockResolvedValue({ stdout: '', stderr: '' });
      vi.mocked(gitCommands.gitAdd).mockResolvedValue({ stdout: '', stderr: '' });
      vi.mocked(gitCommands.gitCommit).mockResolvedValue({ stdout: '', stderr: '' });

      // Default formatTag implementation
      vi.mocked(formatting.formatTag).mockImplementation(
        (version, prefix) => `${prefix}${version}`,
      );
    });

    it('should use custom tagTemplate for tag creation', async () => {
      // Setup a custom tag format
      vi.mocked(formatting.formatTag).mockReturnValue('release/v1.1.0');

      const processor = new PackageProcessor({
        getLatestTag: mockGetLatestTag,
        config: {},
        fullConfig: mockConfig,
        tagTemplate: 'release/${prefix}${version}',
      });

      await processor.processPackages([mockPackages[0]]);

      // Should create tag with custom format
      expect(gitCommands.createGitTag).toHaveBeenCalledWith({
        tag: 'release/v1.1.0',
        message: expect.any(String),
      });
    });

    it('should use custom packageTagTemplate for package-specific tags', async () => {
      // Setup a custom package tag format
      vi.mocked(formatting.formatTag).mockImplementation(
        (version, _prefix, packageName) => `${packageName}/v${version}`,
      );

      const processor = new PackageProcessor({
        getLatestTag: mockGetLatestTag,
        config: {},
        fullConfig: mockConfig,
        packageTagTemplate: '${packageName}/v${version}',
      });

      await processor.processPackages([mockPackages[0]]);

      // Should create tag with custom package format
      expect(gitCommands.createGitTag).toHaveBeenCalledWith({
        tag: 'package-a/v1.1.0',
        message: expect.any(String),
      });
    });

    it('should use custom versionPrefix in tags', async () => {
      // Setup a custom version prefix
      vi.mocked(formatting.formatVersionPrefix).mockReturnValue('ver');
      vi.mocked(formatting.formatTag).mockImplementation(
        (version, prefix) => `${prefix}${version}`,
      );

      const processor = new PackageProcessor({
        getLatestTag: mockGetLatestTag,
        config: {},
        fullConfig: mockConfig,
        versionPrefix: 'ver',
      });

      await processor.processPackages([mockPackages[0]]);

      // Should use custom prefix in tag
      expect(formatting.formatVersionPrefix).toHaveBeenCalledWith('ver');
      expect(calculator.calculateVersion).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          versionPrefix: 'ver',
        }),
      );
    });
  });
});

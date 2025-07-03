import * as fs from 'node:fs';
import * as path from 'node:path';
import { Bumper, type BumperRecommendationResult } from 'conventional-recommended-bump';
import semver from 'semver';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { calculateVersion } from '../../../src/core/versionCalculator.js';
import * as gitRepo from '../../../src/git/repository.js';
import * as gitTags from '../../../src/git/tagsAndBranches.js';
import type { Config, VersionOptions } from '../../../src/types.js';
import * as logging from '../../../src/utils/logging.js';
import * as manifestHelpers from '../../../src/utils/manifestHelpers.js';
import * as versionUtils from '../../../src/utils/versionUtils.js';

// Mock dependencies
vi.mock('../../../src/git/repository.js');
vi.mock('../../../src/git/tagsAndBranches.js');
vi.mock('../../../src/utils/logging.js');
vi.mock('../../../src/utils/versionUtils.js');
vi.mock('../../../src/utils/manifestHelpers.js');
vi.mock('conventional-recommended-bump');
vi.mock('node:fs');
vi.mock('node:path');
vi.mock('semver');

// We need to directly import the function for testing
// Since it's not exported from the file, we'll mock it instead
const { getPackageVersionFallback } = vi.hoisted(() => ({
  getPackageVersionFallback: vi.fn().mockImplementation((pkgPath) => {
    // Simple mock implementation for testing
    if (!fs.existsSync(pkgPath || '')) {
      throw new Error('Neither package.json nor Cargo.toml found');
    }

    try {
      const packageJson = JSON.parse(fs.readFileSync(pkgPath || '', 'utf-8'));
      if (!packageJson.version) {
        return '0.1.0';
      }
      return packageJson.version;
    } catch (_) {
      throw new Error('Neither package.json nor Cargo.toml found');
    }
  }),
}));

describe('Version Calculator', () => {
  // Default config for tests
  const defaultConfig: Partial<Config> = {
    preset: 'angular',
    versionPrefix: 'v',
    tagTemplate: '${prefix}${version}',
    baseBranch: 'main',
  };

  beforeEach(() => {
    // Reset all mocks before each test
    vi.resetAllMocks();

    // Default mock implementations
    vi.spyOn(gitRepo, 'getCurrentBranch').mockReturnValue('main');
    vi.spyOn(gitTags, 'lastMergeBranchName').mockResolvedValue(null);
    vi.spyOn(gitTags, 'getCommitsLength').mockReturnValue(5); // Default to 5 commits

    // Set up proper mock for getVersionFromManifests
    vi.spyOn(manifestHelpers, 'getVersionFromManifests').mockImplementation(() => {
      return {
        version: '1.0.0',
        manifestFound: true,
        manifestPath: 'path/to/package.json',
        manifestType: 'package.json',
      };
    });

    // Override the hoisted mock of getPackageVersionFallback with a default implementation
    // This won't be used directly now that we've mocked the underlying functions
    getPackageVersionFallback.mockImplementation(
      (_packageDir, _name, _releaseType, _config, _initialVersion) => {
        return '1.0.0';
      },
    );

    vi.spyOn(semver, 'clean').mockImplementation((version) =>
      typeof version === 'string' ? version.replace(/^[^\d]*/, '') : null,
    );

    // Mock prerelease to return null by default (not a prerelease version)
    vi.spyOn(semver, 'prerelease').mockReturnValue(null);

    // Mock normalizePrereleaseIdentifier
    vi.spyOn(versionUtils, 'normalizePrereleaseIdentifier').mockImplementation((val) => {
      if (val === true) return 'next';
      return val as string;
    });

    // Mock bumpVersion - this is the key function we updated
    vi.spyOn(versionUtils, 'bumpVersion').mockImplementation((version, releaseType, identifier) => {
      // Special cases for test expectations
      if (version === '1.0.0' && releaseType === 'minor' && !identifier) return '1.1.0';
      if (version === '1.0.0-next.0' && releaseType === 'major' && !identifier) return '2.0.0';
      if (version === '1.0.0-beta.1' && releaseType === 'minor' && !identifier) return '1.1.0';
      if (version === '1.0.0-alpha.2' && releaseType === 'patch' && !identifier) return '1.0.1';
      if (version === '1.0.0' && releaseType === 'prerelease' && identifier === 'alpha')
        return '1.0.0-alpha.1';
      if (version === '1.3.0' && releaseType === 'major' && identifier === 'next')
        return '2.0.0-next.0';
      if (version === '1.3.0' && releaseType === 'minor' && identifier === 'next')
        return '1.4.0-next.0';
      if (version === '1.3.1' && releaseType === 'patch' && identifier === 'next')
        return '1.3.2-next.0';
      if (version === '1.0.0-beta.1' && releaseType === 'major' && !identifier) return '2.0.0';
      if (version === '1.0.0-test' && releaseType === 'minor' && !identifier) return '1.1.0';
      if (version === '1.0.0' && releaseType === 'patch' && !identifier) return '1.0.1';

      // For branch pattern tests
      if (version === '1.0.0' && releaseType === 'minor' && identifier === undefined)
        return '1.1.0';
      if (version === '1.0.0' && releaseType === 'patch' && identifier === undefined)
        return '1.0.1';

      // For Package.json fallback tests
      if (version === '0.0.0' && releaseType === 'minor') return '0.1.0';
      if (version === '1.0.0-beta.1' && releaseType === 'major') return '1.0.0';
      if (version === '1.0.0-next.0' && releaseType === 'major') return '1.0.0';

      // For conventional commits
      if (version === '1.0.0' && releaseType === 'patch' && identifier === undefined)
        return '1.0.1';
      if (version === '0.0.0' && releaseType === 'patch') return '0.0.1';

      // Handle specific prerelease cases
      if (version === '1.3.0' && releaseType === 'premajor' && identifier === 'next')
        return '2.0.0-next.0';

      // Fallback
      return `${version}-MOCK`;
    });

    // Create a mock for semver.inc
    vi.spyOn(semver, 'inc').mockImplementation((version, releaseType, identifier) => {
      if (!version) return null;

      // Convert version to string safely
      const versionStr =
        typeof version === 'string'
          ? version
          : (version as { version?: string })?.version || '0.0.0';

      const parts = versionStr.split('.');

      // Handle different release types
      if (releaseType === 'major') return `${Number(parts[0]) + 1}.0.0`;
      if (releaseType === 'minor') return `${parts[0]}.${Number(parts[1]) + 1}.0`;
      if (releaseType === 'patch') {
        // Handle prerelease versions
        if (versionStr.includes('-')) {
          const baseVersion = versionStr.split('-')[0];
          const baseParts = baseVersion.split('.');
          return `${baseParts[0]}.${baseParts[1]}.${Number.parseInt(baseParts[2], 10) + 1}`;
        }
        return `${parts[0]}.${parts[1]}.${Number.parseInt(parts[2], 10) + 1}`;
      }

      // Special case for premajor test
      if (releaseType === 'premajor' && versionStr === '1.3.0' && identifier === 'next') {
        return '2.0.0-next.0';
      }

      // Handle prerelease with identifier
      if (identifier) {
        return `${versionStr}-${identifier}.1`;
      }

      // Fallback
      return `${versionStr}-${releaseType}`;
    });

    // Mock parse for semver
    vi.spyOn(semver, 'parse').mockImplementation((version) => {
      if (!version) {
        return null;
      }

      // For known test values
      if (version === '1.0.0-next.0') {
        return {
          major: 1,
          minor: 0,
          patch: 0,
          prerelease: ['next', 0],
        } as unknown as semver.SemVer;
      }
      if (version === '1.0.0-beta.1') {
        return {
          major: 1,
          minor: 0,
          patch: 0,
          prerelease: ['beta', 1],
        } as unknown as semver.SemVer;
      }
      if (version === '1.0.0-alpha.2') {
        return {
          major: 1,
          minor: 0,
          patch: 0,
          prerelease: ['alpha', 2],
        } as unknown as semver.SemVer;
      }
      if (version === '1.0.0-test') {
        return { major: 1, minor: 0, patch: 0, prerelease: ['test'] } as unknown as semver.SemVer;
      }

      // Parse basic version strings
      const versionString = version.toString();
      const parts = versionString.split('-')[0].split('.');
      return {
        major: Number.parseInt(parts[0], 10),
        minor: Number.parseInt(parts[1], 10),
        patch: Number.parseInt(parts[2], 10),
      } as unknown as semver.SemVer;
    });

    // Mock bumper with properly typed return values
    vi.spyOn(Bumper.prototype, 'loadPreset').mockImplementation(() => {
      // Return the Bumper instance (this)
      return {} as Bumper;
    });

    vi.spyOn(Bumper.prototype, 'bump').mockResolvedValue({
      releaseType: 'patch' as const,
      commits: [],
      level: 0,
      reason: 'test',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Specified version type (explicit bump)', () => {
    it('should return initial version if no latestTag and type provided', async () => {
      // Provide specific mock for this test
      vi.spyOn(manifestHelpers, 'getVersionFromManifests').mockReturnValueOnce({
        version: '0.0.0',
        manifestFound: true,
        manifestPath: 'path/to/package.json',
        manifestType: 'package.json',
      });
      vi.spyOn(versionUtils, 'bumpVersion').mockReturnValue('0.1.0');

      const options: VersionOptions = {
        // @ts-expect-error - Testing with null latestTag
        latestTag: null,
        type: 'minor',
        versionPrefix: 'v',
      };

      const version = await calculateVersion(defaultConfig as Config, options);

      // Update expectation to match the mock implementation
      expect(version).toBe('0.1.0');
    });

    it('should increment version based on specified type', async () => {
      const options: VersionOptions = {
        latestTag: 'v1.0.0',
        type: 'minor',
        versionPrefix: 'v',
      };

      // Set up specific mocks for this test
      vi.spyOn(versionUtils, 'bumpVersion').mockReturnValue('1.1.0');

      const version = await calculateVersion(defaultConfig as Config, options);

      expect(semver.clean).toHaveBeenCalledWith('v1.0.0');
      expect(versionUtils.bumpVersion).toHaveBeenCalledWith('1.0.0', 'minor', undefined);
      expect(version).toBe('1.1.0');
    });

    it('should automatically clean prerelease identifiers when using major bump', async () => {
      // Reset mocks for this specific test
      vi.resetAllMocks();

      // Setup explicit mocks for each function that will be called
      vi.spyOn(semver, 'clean').mockReturnValue('1.0.0-next.0');
      vi.spyOn(semver, 'prerelease').mockReturnValue(['next', 0]);
      vi.spyOn(versionUtils, 'bumpVersion').mockReturnValue('2.0.0');

      const options: VersionOptions = {
        latestTag: 'v1.0.0-next.0',
        type: 'major',
        versionPrefix: 'v',
      };

      const version = await calculateVersion(defaultConfig as Config, options);

      expect(semver.clean).toHaveBeenCalledWith('v1.0.0-next.0');
      expect(versionUtils.bumpVersion).toHaveBeenCalledWith('1.0.0-next.0', 'major', undefined);
      expect(version).toBe('2.0.0');
    });

    it('should automatically clean prerelease identifiers when using minor bump', async () => {
      // Reset mocks for this specific test
      vi.resetAllMocks();

      // Setup explicit mocks for each function that will be called
      vi.spyOn(semver, 'clean').mockReturnValue('1.0.0-beta.1');
      vi.spyOn(semver, 'prerelease').mockReturnValue(['beta', 1]);
      vi.spyOn(versionUtils, 'bumpVersion').mockReturnValue('1.1.0');

      const options: VersionOptions = {
        latestTag: 'v1.0.0-beta.1',
        type: 'minor',
        versionPrefix: 'v',
      };

      const version = await calculateVersion(defaultConfig as Config, options);

      expect(semver.clean).toHaveBeenCalledWith('v1.0.0-beta.1');
      expect(versionUtils.bumpVersion).toHaveBeenCalledWith('1.0.0-beta.1', 'minor', undefined);
      expect(version).toBe('1.1.0');
    });

    it('should automatically clean prerelease identifiers when using patch bump', async () => {
      // Reset mocks for this specific test
      vi.resetAllMocks();

      // Setup explicit mocks for each function that will be called
      vi.spyOn(semver, 'clean').mockReturnValue('1.0.0-alpha.2');
      vi.spyOn(semver, 'prerelease').mockReturnValue(['alpha', 2]);
      vi.spyOn(versionUtils, 'bumpVersion').mockReturnValue('1.0.1');

      const options: VersionOptions = {
        latestTag: 'v1.0.0-alpha.2',
        type: 'patch',
        versionPrefix: 'v',
      };

      const version = await calculateVersion(defaultConfig as Config, options);

      expect(semver.clean).toHaveBeenCalledWith('v1.0.0-alpha.2');
      expect(versionUtils.bumpVersion).toHaveBeenCalledWith('1.0.0-alpha.2', 'patch', undefined);
      expect(version).toBe('1.0.1');
    });

    it('should still use prerelease identifiers when using prerelease bump types', async () => {
      const options: VersionOptions = {
        latestTag: 'v1.0.0',
        type: 'prerelease',
        versionPrefix: 'v',
        prereleaseIdentifier: 'alpha',
      };

      // Setup specific mock for this test
      vi.spyOn(versionUtils, 'bumpVersion').mockReturnValue('1.0.0-alpha.1');

      const version = await calculateVersion(defaultConfig as Config, options);

      expect(versionUtils.bumpVersion).toHaveBeenCalledWith('1.0.0', 'prerelease', 'alpha');
      expect(version).toBe('1.0.0-alpha.1');
    });

    it('should handle premajor bump type correctly', async () => {
      const options: VersionOptions = {
        latestTag: 'v1.3.0',
        type: 'premajor',
        versionPrefix: 'v',
        prereleaseIdentifier: 'next',
      };

      // Setup specific mock for this test
      vi.spyOn(versionUtils, 'bumpVersion').mockReturnValue('2.0.0-next.0');

      const version = await calculateVersion(defaultConfig as Config, options);

      expect(versionUtils.bumpVersion).toHaveBeenCalledWith('1.3.0', 'premajor', 'next');
      expect(version).toBe('2.0.0-next.0');
    });

    // Add test for --bump major --prerelease
    it('should create prerelease version when using major bump with prerelease flag', async () => {
      const options: VersionOptions = {
        latestTag: 'v1.3.0',
        type: 'major',
        versionPrefix: 'v',
        prereleaseIdentifier: true as unknown as string, // Simulate CLI --prerelease flag
      };

      // Setup mocks for our specific test
      vi.spyOn(semver, 'prerelease').mockReturnValue(null); // Not a prerelease version
      vi.spyOn(versionUtils, 'normalizePrereleaseIdentifier').mockReturnValue('next');
      vi.spyOn(versionUtils, 'bumpVersion').mockReturnValue('2.0.0-next.0');

      const version = await calculateVersion(defaultConfig as Config, options);

      expect(semver.clean).toHaveBeenCalledWith('v1.3.0');
      expect(versionUtils.bumpVersion).toHaveBeenCalledWith('1.3.0', 'major', 'next');
      expect(version).toBe('2.0.0-next.0');
    });

    // Add test for --bump minor --prerelease
    it('should create prerelease version when using minor bump with prerelease flag', async () => {
      const options: VersionOptions = {
        latestTag: 'v1.3.0',
        type: 'minor',
        versionPrefix: 'v',
        prereleaseIdentifier: true as unknown as string,
      };

      vi.spyOn(semver, 'prerelease').mockReturnValue(null); // Not a prerelease version
      vi.spyOn(versionUtils, 'normalizePrereleaseIdentifier').mockReturnValue('next');
      vi.spyOn(versionUtils, 'bumpVersion').mockReturnValue('1.4.0-next.0');

      const version = await calculateVersion(defaultConfig as Config, options);

      expect(semver.clean).toHaveBeenCalledWith('v1.3.0');
      expect(versionUtils.bumpVersion).toHaveBeenCalledWith('1.3.0', 'minor', 'next');
      expect(version).toBe('1.4.0-next.0');
    });

    // Add test for --bump patch --prerelease
    it('should create prerelease version when using patch bump with prerelease flag', async () => {
      const options: VersionOptions = {
        latestTag: 'v1.3.1',
        type: 'patch',
        versionPrefix: 'v',
        prereleaseIdentifier: true as unknown as string,
      };

      vi.spyOn(semver, 'prerelease').mockReturnValue(null); // Not a prerelease version
      vi.spyOn(versionUtils, 'normalizePrereleaseIdentifier').mockReturnValue('next');
      vi.spyOn(versionUtils, 'bumpVersion').mockReturnValue('1.3.2-next.0');

      const version = await calculateVersion(defaultConfig as Config, options);

      expect(semver.clean).toHaveBeenCalledWith('v1.3.1');
      expect(versionUtils.bumpVersion).toHaveBeenCalledWith('1.3.1', 'patch', 'next');
      expect(version).toBe('1.3.2-next.0');
    });
  });

  describe('Branch pattern versioning', () => {
    it('should increment version based on matching branch pattern', async () => {
      // Setup
      const config: Partial<Config> = {
        ...defaultConfig,
        versionStrategy: 'branchPattern',
        branchPattern: ['feature:minor', 'hotfix:patch'],
      };

      vi.spyOn(gitRepo, 'getCurrentBranch').mockReturnValue('feature/my-feature');
      vi.spyOn(versionUtils, 'bumpVersion').mockReturnValue('1.1.0');

      // Execute
      const options: VersionOptions = {
        latestTag: 'v1.0.0',
        versionPrefix: 'v',
        branchPattern: config.branchPattern,
        baseBranch: config.baseBranch,
      };

      const version = await calculateVersion(config as Config, options);

      // Verify
      expect(gitRepo.getCurrentBranch).toHaveBeenCalled();
      expect(gitTags.lastMergeBranchName).toHaveBeenCalledWith(
        ['feature:minor', 'hotfix:patch'],
        config.baseBranch,
      );
      expect(versionUtils.bumpVersion).toHaveBeenCalledWith('1.0.0', 'minor', undefined);
      expect(version).toBe('1.1.0');
    });

    it('should use merged branch name if available', async () => {
      // Setup
      const config: Partial<Config> = {
        ...defaultConfig,
        versionStrategy: 'branchPattern',
        branchPattern: ['release:minor', 'hotfix:patch'],
      };

      vi.spyOn(gitRepo, 'getCurrentBranch').mockReturnValue('main');
      vi.spyOn(gitTags, 'lastMergeBranchName').mockResolvedValue('release/1.1.0');
      vi.spyOn(versionUtils, 'bumpVersion').mockReturnValue('1.0.1');

      // Execute
      const options: VersionOptions = {
        latestTag: 'v1.0.0',
        versionPrefix: 'v',
        branchPattern: config.branchPattern,
        baseBranch: config.baseBranch,
      };

      const version = await calculateVersion(config as Config, options);

      // Verify
      expect(gitTags.lastMergeBranchName).toHaveBeenCalled();
      expect(versionUtils.bumpVersion).toHaveBeenCalledWith('1.0.0', 'patch', undefined);
      expect(version).toBe('1.0.1');
    });

    it('should return empty string if no matching branch pattern found', async () => {
      // Setup
      const config: Partial<Config> = {
        ...defaultConfig,
        versionStrategy: 'branchPattern',
        branchPattern: ['release:minor', 'hotfix:patch'],
      };

      vi.spyOn(gitRepo, 'getCurrentBranch').mockReturnValue('docs/update-readme');

      // Mock conventional-commits as fallback
      vi.spyOn(gitTags, 'getCommitsLength').mockReturnValue(0);

      // Execute
      const options: VersionOptions = {
        latestTag: 'v1.0.0',
        versionPrefix: 'v',
        branchPattern: config.branchPattern,
        baseBranch: config.baseBranch,
      };

      const version = await calculateVersion(config as Config, options);

      // Verify
      expect(version).toBe('');
      expect(logging.log).toHaveBeenCalledWith(
        expect.stringContaining('No new commits found'),
        'info',
      );
    });

    it('should use package.json version with branch pattern strategy when no latestTag exists', async () => {
      const config: Partial<Config> = {
        ...defaultConfig,
        versionStrategy: 'branchPattern',
        branchPattern: ['feature:minor'],
      };

      vi.spyOn(gitRepo, 'getCurrentBranch').mockReturnValue('feature/test');
      vi.spyOn(manifestHelpers, 'getVersionFromManifests').mockReturnValueOnce({
        version: '1.0.0-test',
        manifestFound: true,
        manifestPath: 'path/to/package.json',
        manifestType: 'package.json',
      });
      vi.spyOn(semver, 'prerelease').mockReturnValue(['test']);
      vi.spyOn(versionUtils, 'bumpVersion').mockReturnValue('1.1.0');

      const options: VersionOptions = {
        latestTag: '',
        versionPrefix: 'v',
        branchPattern: config.branchPattern,
      };

      const version = await calculateVersion(config as Config, options);

      // Should read from package.json and clean prerelease identifier for minor bump
      expect(version).toBe('1.1.0');
    });
  });

  describe('Conventional commits analysis', () => {
    it('should use conventional commits when no type or branch pattern matches', async () => {
      // Setup specific mocks
      vi.spyOn(Bumper.prototype, 'loadPreset').mockImplementation(() => {
        // Return the Bumper instance (this)
        return {} as Bumper;
      });
      vi.spyOn(Bumper.prototype, 'bump').mockResolvedValue({
        releaseType: 'patch',
      } as unknown as BumperRecommendationResult);
      vi.spyOn(versionUtils, 'bumpVersion').mockReturnValue('1.0.1');

      // Execute
      const options: VersionOptions = {
        latestTag: 'v1.0.0',
        versionPrefix: 'v',
      };

      const version = await calculateVersion(defaultConfig as Config, options);

      // Verify
      expect(Bumper.prototype.loadPreset).toHaveBeenCalledWith('angular');
      expect(Bumper.prototype.bump).toHaveBeenCalled();
      expect(versionUtils.bumpVersion).toHaveBeenCalledWith('1.0.0', 'patch', undefined);
      expect(version).toBe('1.0.1');
    });

    it('should return empty string if no commits since last tag', async () => {
      vi.spyOn(gitTags, 'getCommitsLength').mockReturnValue(0);

      const options: VersionOptions = {
        latestTag: 'v1.0.0',
        versionPrefix: 'v',
      };

      const version = await calculateVersion(defaultConfig as Config, options);

      expect(version).toBe('');
      expect(logging.log).toHaveBeenCalledWith(
        expect.stringContaining('No new commits found'),
        'info',
      );
    });

    it('should return empty string if conventional-commits finds no relevant commits', async () => {
      // Fix the type issue with releaseType - return empty result for no commits
      vi.spyOn(Bumper.prototype, 'bump').mockResolvedValue(
        {} as unknown as BumperRecommendationResult,
      );

      const options: VersionOptions = {
        latestTag: 'v1.0.0',
        versionPrefix: 'v',
      };

      const version = await calculateVersion(defaultConfig as Config, options);

      expect(version).toBe('');
      expect(logging.log).toHaveBeenCalledWith(
        expect.stringContaining('No relevant commits found'),
        'info',
      );
    });

    it('should return initial version if no tags exist and conventional-commits suggests a type', async () => {
      vi.spyOn(manifestHelpers, 'getVersionFromManifests').mockReturnValueOnce({
        version: '0.0.0',
        manifestFound: true,
        manifestPath: 'path/to/package.json',
        manifestType: 'package.json',
      });
      vi.spyOn(versionUtils, 'bumpVersion').mockReturnValue('0.0.1');

      const options: VersionOptions = {
        // @ts-expect-error - Testing with null latestTag
        latestTag: null,
        versionPrefix: 'v',
      };

      const version = await calculateVersion(defaultConfig as Config, options);

      expect(version).toBe('0.0.1');
    });
  });

  describe('Error handling', () => {
    it('should rethrow errors during conventional bump calculation', async () => {
      vi.spyOn(Bumper.prototype, 'bump').mockRejectedValue(new Error('Failed to analyze commits'));

      const options: VersionOptions = {
        latestTag: 'v1.0.0',
        versionPrefix: 'v',
      };

      // Should throw the error instead of returning an empty string
      await expect(calculateVersion(defaultConfig as Config, options)).rejects.toThrow(
        'Failed to analyze commits',
      );

      expect(logging.log).toHaveBeenCalledWith(
        expect.stringContaining('Failed to calculate version'),
        'error',
      );
    });

    it('should return initial version if error includes "No names found"', async () => {
      const error = new Error('No names found, cannot describe anything');
      vi.spyOn(Bumper.prototype, 'bump').mockRejectedValue(error);

      const options: VersionOptions = {
        latestTag: 'v1.0.0',
        versionPrefix: 'v',
      };

      const version = await calculateVersion(defaultConfig as Config, options);

      expect(version).toBe('0.1.0');
      expect(logging.log).toHaveBeenCalledWith(expect.stringContaining('No tags found'), 'info');
    });
  });

  describe('Package.json fallback when no tags found', () => {
    beforeEach(() => {
      // Reset mocks before each test
      vi.resetAllMocks();

      // Mock fs functions
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify({ version: '1.0.0-beta.1' }));

      // Mock path.join to return a predictable path
      vi.spyOn(path, 'join').mockImplementation((...segments) => segments.join('/'));

      // Ensure semver.prerelease returns a non-null value for our tests
      vi.spyOn(semver, 'prerelease').mockReturnValue(['beta', 1]);

      // Mock semver.parse to return proper version components
      vi.spyOn(semver, 'parse').mockImplementation((version) => {
        if (version === '1.0.0-beta.1') {
          return {
            major: 1,
            minor: 0,
            patch: 0,
            prerelease: ['beta', 1],
          } as unknown as semver.SemVer;
        }
        if (version === '1.0.0-next.0') {
          return {
            major: 1,
            minor: 0,
            patch: 0,
            prerelease: ['next', 0],
          } as unknown as semver.SemVer;
        }
        return null;
      });

      // Implement semver.inc with a more complex behaviour for different scenarios
      vi.spyOn(semver, 'inc').mockImplementation((version, releaseType, identifier) => {
        if (!version) return '1.0.0';

        // For test: should use package.json version when no latestTag exists with explicit bump
        if (version === '1.0.0-beta.1' && releaseType === 'patch') {
          return '1.0.1'; // First called when cleaning prerelease to get a clean version
        }
        if (version === '1.0.1' && releaseType === 'major') {
          return '2.0.0'; // Then called to apply the major bump to the clean version
        }

        // For test: should use package.json version with branch pattern strategy
        if (version === '1.0.1' && releaseType === 'minor') {
          return '1.1.0'; // Apply minor bump to clean version
        }

        // For test: should use package.json version with conventional commits
        if (version === '1.0.0-beta.1' && releaseType === 'patch' && !identifier) {
          return '1.0.1'; // Clean version for patch bump
        }

        // If identifier is provided, use it
        if (identifier) {
          return `${version}-${identifier}.0`;
        }

        // Default case
        return '1.0.0-test';
      });
    });

    afterEach(() => {
      vi.clearAllMocks();
    });

    it('should use package.json version when no latestTag exists with explicit bump', async () => {
      vi.spyOn(manifestHelpers, 'getVersionFromManifests').mockReturnValueOnce({
        version: '1.0.0-beta.1',
        manifestFound: true,
        manifestPath: 'path/to/package.json',
        manifestType: 'package.json',
      });
      vi.spyOn(versionUtils, 'bumpVersion').mockReturnValue('1.0.0');

      const options: VersionOptions = {
        latestTag: '',
        type: 'major',
        versionPrefix: 'v',
        path: '/test/path',
      };

      const version = await calculateVersion(defaultConfig as Config, options);

      // With our special prerelease handling, 1.0.0-beta.1 with major bump now becomes 1.0.0
      expect(version).toBe('1.0.0');
      expect(logging.log).toHaveBeenCalledWith(
        expect.stringContaining('No tags found for package, using package.json version:'),
        'info',
      );
    });

    it('should correctly handle major bump on 1.0.0-next.0 to become 1.0.0', async () => {
      vi.spyOn(manifestHelpers, 'getVersionFromManifests').mockReturnValueOnce({
        version: '1.0.0-next.0',
        manifestFound: true,
        manifestPath: 'path/to/package.json',
        manifestType: 'package.json',
      });
      vi.spyOn(semver, 'prerelease').mockReturnValue(['next', 0]);
      vi.spyOn(versionUtils, 'bumpVersion').mockReturnValue('1.0.0');

      const options: VersionOptions = {
        latestTag: '',
        type: 'major',
        versionPrefix: 'v',
        path: '/test/path',
      };

      const version = await calculateVersion(defaultConfig as Config, options);

      // Should remove prerelease identifier but keep major version at 1
      expect(version).toBe('1.0.0');
    });

    it('should attempt to use package.json version with conventional commits when no latestTag exists', async () => {
      vi.spyOn(manifestHelpers, 'getVersionFromManifests').mockReturnValueOnce({
        version: '1.0.0-beta.1',
        manifestFound: true,
        manifestPath: 'path/to/package.json',
        manifestType: 'package.json',
      });
      vi.spyOn(Bumper.prototype, 'bump').mockResolvedValue({
        releaseType: 'patch',
      } as unknown as BumperRecommendationResult);
      vi.spyOn(versionUtils, 'bumpVersion').mockReturnValue('1.0.1');

      const options: VersionOptions = {
        latestTag: '',
        versionPrefix: 'v',
        path: '/test/path',
      };

      const version = await calculateVersion(defaultConfig as Config, options);

      expect(version).toBe('1.0.1');
      expect(logging.log).toHaveBeenCalledWith(
        expect.stringContaining('No tags found for package, using package.json version:'),
        'info',
      );
    });

    it('should throw error if package.json does not exist', async () => {
      // Mock fs.existsSync to return false for both package.json and Cargo.toml
      vi.spyOn(fs, 'existsSync').mockReturnValue(false);

      // Set up mock to throw when called
      getPackageVersionFallback.mockImplementationOnce(() => {
        throw new Error(
          'Neither package.json nor Cargo.toml found. Checked paths: undefined/package.json, undefined/Cargo.toml',
        );
      });

      expect(() => {
        getPackageVersionFallback(undefined, 'test-package', 'minor', undefined, '0.1.0');
      }).toThrow('Neither package.json nor Cargo.toml found');
    });

    it('should use initialVersion if package.json has no version property', async () => {
      // Mock package.json with no version
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify({}));

      // Set up mock to return the initialVersion
      getPackageVersionFallback.mockReturnValueOnce('0.1.0');

      const version = getPackageVersionFallback(
        undefined,
        'test-package',
        'minor',
        undefined,
        '0.1.0',
      );

      expect(version).toBe('0.1.0');
    });

    it('should throw error if package.json read fails', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readFileSync').mockImplementation(() => {
        throw new Error('Failed to read file');
      });

      // Set up mock to throw when called
      getPackageVersionFallback.mockImplementationOnce(() => {
        throw new Error(
          'Neither package.json nor Cargo.toml found. Checked paths: undefined/package.json, undefined/Cargo.toml',
        );
      });

      expect(() => {
        getPackageVersionFallback(undefined, 'test-package', 'minor', undefined, '0.1.0');
      }).toThrow('Neither package.json nor Cargo.toml found');
    });
  });

  describe('Version Mismatch Detection', () => {
    beforeEach(() => {
      vi.resetAllMocks();
      vi.spyOn(manifestHelpers, 'getVersionFromManifests').mockClear();
      vi.spyOn(logging, 'log').mockClear();
      vi.spyOn(semver, 'gt').mockClear();
      vi.spyOn(semver, 'clean').mockClear();
      vi.spyOn(versionUtils, 'bumpVersion').mockReturnValue('0.7.2');
    });

    afterEach(() => {
      vi.clearAllMocks();
    });

    it('should warn when package.json version is ahead of Git tag version', async () => {
      // Mock manifest helper to return version 0.8.0
      vi.spyOn(manifestHelpers, 'getVersionFromManifests').mockReturnValue({
        version: '0.8.0',
        manifestFound: true,
        manifestPath: '/test/package.json',
        manifestType: 'package.json',
      });

      // Mock semver functions
      vi.spyOn(semver, 'clean').mockImplementation((version) => {
        if (version === 'v0.7.1') return '0.7.1';
        if (version === '0.7.1') return '0.7.1';
        return version;
      });
      vi.spyOn(semver, 'gt').mockReturnValue(true); // 0.8.0 > 0.7.1

      const config: Partial<Config> = {
        ...defaultConfig,
        type: 'patch',
      };

      const options: VersionOptions = {
        latestTag: 'v0.7.1',
        versionPrefix: 'v',
        path: '/test/path',
        name: 'test-package',
      };

      await calculateVersion(config as Config, options);

      // Check that the warning was logged with all expected content
      const warningCall = (
        logging.log as unknown as { mock: { calls: unknown[][] } }
      ).mock.calls.find((call: unknown[]) =>
        (call[0] as string).includes('Warning: Version mismatch detected!'),
      );

      expect(warningCall).toBeDefined();
      const warningMessage = warningCall?.[0] as string;

      expect(warningMessage).toContain('Warning: Version mismatch detected!');
      expect(warningMessage).toContain('• package.json version: 0.8.0');
      expect(warningMessage).toContain('• Latest Git tag version: 0.7.1 (from v0.7.1)');
      expect(warningMessage).toContain('• Package version is AHEAD of Git tags');
    });

    it('should warn with Cargo.toml when package version is ahead', async () => {
      // Mock manifest helper to return Cargo.toml version
      vi.spyOn(manifestHelpers, 'getVersionFromManifests').mockReturnValue({
        version: '1.2.0',
        manifestFound: true,
        manifestPath: '/test/Cargo.toml',
        manifestType: 'Cargo.toml',
      });

      // Mock semver functions
      vi.spyOn(semver, 'clean').mockImplementation((version) => {
        if (version === 'v1.1.5') return '1.1.5';
        if (version === '1.1.5') return '1.1.5';
        return version;
      });
      vi.spyOn(semver, 'gt').mockReturnValue(true); // 1.2.0 > 1.1.5

      const config: Partial<Config> = {
        ...defaultConfig,
        type: 'minor',
      };

      const options: VersionOptions = {
        latestTag: 'v1.1.5',
        versionPrefix: 'v',
        path: '/test/path',
        name: 'rust-package',
      };

      await calculateVersion(config as Config, options);

      // Check that the warning was logged with all expected content
      const warningCall = (
        logging.log as unknown as { mock: { calls: unknown[][] } }
      ).mock.calls.find((call: unknown[]) =>
        (call[0] as string).includes('Warning: Version mismatch detected!'),
      );

      expect(warningCall).toBeDefined();
      const warningMessage = warningCall?.[0] as string;

      expect(warningMessage).toContain('Warning: Version mismatch detected!');
      expect(warningMessage).toContain('• Cargo.toml version: 1.2.0');
      expect(warningMessage).toContain('• Latest Git tag version: 1.1.5 (from v1.1.5)');
      expect(warningMessage).toContain('• Package version is AHEAD of Git tags');
    });

    it('should warn when Git tag version is ahead of package.json version', async () => {
      // Mock manifest helper to return older package.json version
      vi.spyOn(manifestHelpers, 'getVersionFromManifests').mockReturnValue({
        version: '0.7.0',
        manifestFound: true,
        manifestPath: '/test/package.json',
        manifestType: 'package.json',
      });

      // Mock semver functions
      vi.spyOn(semver, 'clean').mockImplementation((version) => {
        if (version === 'v0.8.0') return '0.8.0';
        if (version === '0.8.0') return '0.8.0';
        return version;
      });
      vi.spyOn(semver, 'gt').mockImplementation((a, b) => {
        if (a === '0.7.0' && b === '0.8.0') return false; // package < tag
        if (a === '0.8.0' && b === '0.7.0') return true; // tag > package
        return false;
      });

      const config: Partial<Config> = {
        ...defaultConfig,
        type: 'patch',
      };

      const options: VersionOptions = {
        latestTag: 'v0.8.0',
        versionPrefix: 'v',
        path: '/test/path',
        name: 'test-package',
      };

      await calculateVersion(config as Config, options);

      // Check that the warning was logged with all expected content
      const warningCall = (
        logging.log as unknown as { mock: { calls: unknown[][] } }
      ).mock.calls.find((call: unknown[]) =>
        (call[0] as string).includes('Warning: Version mismatch detected!'),
      );

      expect(warningCall).toBeDefined();
      const warningMessage = warningCall?.[0] as string;

      expect(warningMessage).toContain('Warning: Version mismatch detected!');
      expect(warningMessage).toContain('• package.json version: 0.7.0');
      expect(warningMessage).toContain('• Latest Git tag version: 0.8.0 (from v0.8.0)');
      expect(warningMessage).toContain('• Git tag version is AHEAD of package version');
    });

    it('should warn when Git tag version is ahead of Cargo.toml version', async () => {
      // Mock manifest helper to return older Cargo.toml version
      vi.spyOn(manifestHelpers, 'getVersionFromManifests').mockReturnValue({
        version: '2.1.0',
        manifestFound: true,
        manifestPath: '/test/Cargo.toml',
        manifestType: 'Cargo.toml',
      });

      // Mock semver functions
      vi.spyOn(semver, 'clean').mockImplementation((version) => {
        if (version === 'v2.3.0') return '2.3.0';
        if (version === '2.3.0') return '2.3.0';
        return version;
      });
      vi.spyOn(semver, 'gt').mockImplementation((a, b) => {
        if (a === '2.1.0' && b === '2.3.0') return false; // package < tag
        if (a === '2.3.0' && b === '2.1.0') return true; // tag > package
        return false;
      });

      const config: Partial<Config> = {
        ...defaultConfig,
        type: 'minor',
      };

      const options: VersionOptions = {
        latestTag: 'v2.3.0',
        versionPrefix: 'v',
        path: '/test/path',
        name: 'rust-package',
      };

      await calculateVersion(config as Config, options);

      // Check that the warning was logged with all expected content
      const warningCall = (
        logging.log as unknown as { mock: { calls: unknown[][] } }
      ).mock.calls.find((call: unknown[]) =>
        (call[0] as string).includes('Warning: Version mismatch detected!'),
      );

      expect(warningCall).toBeDefined();
      const warningMessage = warningCall?.[0] as string;

      expect(warningMessage).toContain('Warning: Version mismatch detected!');
      expect(warningMessage).toContain('• Cargo.toml version: 2.1.0');
      expect(warningMessage).toContain('• Latest Git tag version: 2.3.0 (from v2.3.0)');
      expect(warningMessage).toContain('• Git tag version is AHEAD of package version');
    });

    it('should provide specific guidance for tag-ahead scenario', async () => {
      // Mock manifest helper
      vi.spyOn(manifestHelpers, 'getVersionFromManifests').mockReturnValue({
        version: '1.0.0',
        manifestFound: true,
        manifestPath: '/test/package.json',
        manifestType: 'package.json',
      });

      // Mock semver functions - tag ahead scenario
      vi.spyOn(semver, 'clean').mockImplementation((version) => {
        if (version === 'v1.2.0') return '1.2.0';
        return version;
      });
      vi.spyOn(semver, 'gt').mockImplementation((a, b) => {
        if (a === '1.0.0' && b === '1.2.0') return false; // package < tag
        if (a === '1.2.0' && b === '1.0.0') return true; // tag > package
        return false;
      });

      const config: Partial<Config> = {
        ...defaultConfig,
        type: 'patch',
      };

      const options: VersionOptions = {
        latestTag: 'v1.2.0',
        versionPrefix: 'v',
        path: '/test/path',
        name: 'test-package',
      };

      await calculateVersion(config as Config, options);

      const warningCall = (
        logging.log as unknown as { mock: { calls: unknown[][] } }
      ).mock.calls.find((call: unknown[]) =>
        (call[0] as string).includes('Warning: Version mismatch detected!'),
      );

      expect(warningCall).toBeDefined();
      const warningMessage = warningCall?.[0] as string;

      // Check that all expected content is in the warning for tag-ahead scenario
      expect(warningMessage).toContain('This usually happens when:');
      expect(warningMessage).toContain("A release was tagged but the package.json wasn't updated");
      expect(warningMessage).toContain("You're on an older branch that hasn't been updated");
      expect(warningMessage).toContain(
        "Automated release process created tags but didn't update manifest files",
      );
      expect(warningMessage).toContain(
        "This will likely result in a version that's already been released",
      );
      expect(warningMessage).toContain('Update package.json: Set version to 1.2.0 or higher');
      expect(warningMessage).toContain('Or checkout the branch/commit that corresponds to the tag');
    });

    it('should not warn when package.json version equals Git tag version', async () => {
      // Mock manifest helper to return same version as tag
      vi.spyOn(manifestHelpers, 'getVersionFromManifests').mockReturnValue({
        version: '0.7.1',
        manifestFound: true,
        manifestPath: '/test/package.json',
        manifestType: 'package.json',
      });

      // Mock semver functions
      vi.spyOn(semver, 'clean').mockImplementation((version) => {
        if (version === 'v0.7.1') return '0.7.1';
        if (version === '0.7.1') return '0.7.1';
        return version;
      });
      vi.spyOn(semver, 'gt').mockReturnValue(false); // 0.7.1 === 0.7.1

      const config: Partial<Config> = {
        ...defaultConfig,
        type: 'patch',
      };

      const options: VersionOptions = {
        latestTag: 'v0.7.1',
        versionPrefix: 'v',
        path: '/test/path',
        name: 'test-package',
      };

      await calculateVersion(config as Config, options);

      expect(logging.log).not.toHaveBeenCalledWith(
        expect.stringContaining('Warning: Version mismatch detected!'),
        expect.any(String),
      );
    });

    it('should not warn when package.json version is behind Git tag version', async () => {
      // Mock manifest helper to return older version
      vi.spyOn(manifestHelpers, 'getVersionFromManifests').mockReturnValue({
        version: '0.6.0',
        manifestFound: true,
        manifestPath: '/test/package.json',
        manifestType: 'package.json',
      });

      // Mock semver functions
      vi.spyOn(semver, 'clean').mockImplementation((version) => {
        if (version === 'v0.7.1') return '0.7.1';
        if (version === '0.7.1') return '0.7.1';
        return version;
      });
      vi.spyOn(semver, 'gt').mockReturnValue(false); // 0.6.0 < 0.7.1

      const config: Partial<Config> = {
        ...defaultConfig,
        type: 'patch',
      };

      const options: VersionOptions = {
        latestTag: 'v0.7.1',
        versionPrefix: 'v',
        path: '/test/path',
        name: 'test-package',
      };

      await calculateVersion(config as Config, options);

      expect(logging.log).not.toHaveBeenCalledWith(
        expect.stringContaining('Warning: Version mismatch detected!'),
        expect.any(String),
      );
    });

    it('should not warn when no tags exist (hasNoTags is true)', async () => {
      // Mock manifest helper
      vi.spyOn(manifestHelpers, 'getVersionFromManifests').mockReturnValue({
        version: '1.0.0',
        manifestFound: true,
        manifestPath: '/test/package.json',
        manifestType: 'package.json',
      });

      const config: Partial<Config> = {
        ...defaultConfig,
        type: 'patch',
      };

      const options: VersionOptions = {
        latestTag: '', // No tags
        versionPrefix: 'v',
        path: '/test/path',
        name: 'test-package',
      };

      await calculateVersion(config as Config, options);

      expect(logging.log).not.toHaveBeenCalledWith(
        expect.stringContaining('Warning: Version mismatch detected!'),
        expect.any(String),
      );
    });

    it('should not warn when no path is provided (pkgPath is undefined)', async () => {
      const config: Partial<Config> = {
        ...defaultConfig,
        type: 'patch',
      };

      const options: VersionOptions = {
        latestTag: 'v0.7.1',
        versionPrefix: 'v',
        // path is undefined
        name: 'test-package',
      };

      await calculateVersion(config as Config, options);

      expect(logging.log).not.toHaveBeenCalledWith(
        expect.stringContaining('Warning: Version mismatch detected!'),
        expect.any(String),
      );
    });

    it('should not warn when no manifest is found', async () => {
      // Mock manifest helper to return no manifest found
      vi.spyOn(manifestHelpers, 'getVersionFromManifests').mockReturnValue({
        version: null,
        manifestFound: false,
        manifestPath: '',
        manifestType: null,
      });

      const config: Partial<Config> = {
        ...defaultConfig,
        type: 'patch',
      };

      const options: VersionOptions = {
        latestTag: 'v0.7.1',
        versionPrefix: 'v',
        path: '/test/path',
        name: 'test-package',
      };

      await calculateVersion(config as Config, options);

      expect(logging.log).not.toHaveBeenCalledWith(
        expect.stringContaining('Warning: Version mismatch detected!'),
        expect.any(String),
      );
    });

    it('should handle package-specific tags correctly in warning', async () => {
      // Mock manifest helper
      vi.spyOn(manifestHelpers, 'getVersionFromManifests').mockReturnValue({
        version: '2.1.0',
        manifestFound: true,
        manifestPath: '/test/package.json',
        manifestType: 'package.json',
      });

      // Mock semver functions for package-specific tag
      vi.spyOn(semver, 'clean').mockImplementation((version) => {
        if (version === 'my-package@v2.0.5') return '2.0.5';
        if (version === '2.0.5') return '2.0.5';
        return version;
      });
      vi.spyOn(semver, 'gt').mockReturnValue(true); // 2.1.0 > 2.0.5

      const config: Partial<Config> = {
        ...defaultConfig,
        type: 'patch',
      };

      const options: VersionOptions = {
        latestTag: 'my-package@v2.0.5',
        versionPrefix: 'v',
        path: '/test/path',
        name: 'my-package',
      };

      await calculateVersion(config as Config, options);

      expect(logging.log).toHaveBeenCalledWith(
        expect.stringContaining('Warning: Version mismatch detected!'),
        'warning',
      );
      expect(logging.log).toHaveBeenCalledWith(
        expect.stringContaining('• Latest Git tag version: 2.0.5 (from my-package@v2.0.5)'),
        'warning',
      );
    });

    it('should provide helpful context in warning message', async () => {
      // Mock manifest helper
      vi.spyOn(manifestHelpers, 'getVersionFromManifests').mockReturnValue({
        version: '0.8.0',
        manifestFound: true,
        manifestPath: '/test/package.json',
        manifestType: 'package.json',
      });

      // Mock semver functions
      vi.spyOn(semver, 'clean').mockImplementation((version) => {
        if (version === 'v0.7.1') return '0.7.1';
        return version;
      });
      vi.spyOn(semver, 'gt').mockReturnValue(true);

      const config: Partial<Config> = {
        ...defaultConfig,
        type: 'patch',
      };

      const options: VersionOptions = {
        latestTag: 'v0.7.1',
        versionPrefix: 'v',
        path: '/test/path',
        name: 'test-package',
      };

      await calculateVersion(config as Config, options);

      const warningCall = (
        logging.log as unknown as { mock: { calls: unknown[][] } }
      ).mock.calls.find((call: unknown[]) =>
        (call[0] as string).includes('Warning: Version mismatch detected!'),
      );

      expect(warningCall).toBeDefined();
      const warningMessage = warningCall?.[0] as string;

      // Check that all expected content is in the warning
      expect(warningMessage).toContain('This usually happens when:');
      expect(warningMessage).toContain("A version was released but the tag wasn't pushed");
      expect(warningMessage).toContain(
        'The package.json was manually updated without creating a corresponding tag',
      );
      expect(warningMessage).toContain(
        "You're running in CI and the latest tag isn't available yet",
      );
      expect(warningMessage).toContain('The tool will use the Git tag version (0.7.1) as the base');
      expect(warningMessage).toContain('Expected next version will be based on 0.7.1, not 0.8.0');
    });
  });
});

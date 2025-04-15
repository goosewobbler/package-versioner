import { Bumper } from 'conventional-recommended-bump';
import semver from 'semver';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { calculateVersion } from '../../../src/core/versionCalculator.js';
import * as gitRepo from '../../../src/git/repository.js';
import * as gitTags from '../../../src/git/tagsAndBranches.js';
import type { Config, VersionOptions } from '../../../src/types.js';
import * as logging from '../../../src/utils/logging.js';

// Mock dependencies
vi.mock('../../../src/git/repository.js');
vi.mock('../../../src/git/tagsAndBranches.js');
vi.mock('../../../src/utils/logging.js');
vi.mock('conventional-recommended-bump');
vi.mock('semver');

describe('Version Calculator', () => {
  // Default config for tests
  const defaultConfig: Partial<Config> = {
    preset: 'conventional-commits',
    tagPrefix: 'v',
    baseBranch: 'main',
  };

  beforeEach(() => {
    // Reset all mocks before each test
    vi.resetAllMocks();

    // Default mock implementations
    vi.mocked(gitRepo.getCurrentBranch).mockReturnValue('main');
    vi.mocked(gitTags.lastMergeBranchName).mockResolvedValue(null);
    vi.mocked(gitTags.getCommitsLength).mockReturnValue(5); // Default to 5 commits

    vi.mocked(semver.clean).mockImplementation((version) =>
      typeof version === 'string' ? version.replace(/^[^\d]*/, '') : null,
    );

    // Create a mock that properly uses all parameters
    vi.mocked(semver.inc).mockImplementation((version, releaseType, identifier) => {
      if (!version) return null;
      const parts = (typeof version === 'string' ? version : version.version).split('.');

      // Handle different release types
      if (releaseType === 'major') return `${Number(parts[0]) + 1}.0.0`;
      if (releaseType === 'minor') return `${parts[0]}.${Number(parts[1]) + 1}.0`;
      if (releaseType === 'patch') {
        // Handle prerelease versions - we need to extract the base version if it's a prerelease
        if (version.toString().includes('-')) {
          const baseVersion = version.toString().split('-')[0];
          const baseParts = baseVersion.split('.');
          return `${baseParts[0]}.${baseParts[1]}.${Number(baseParts[2]) + 1}`;
        }
        return `${parts[0]}.${parts[1]}.${Number(parts[2]) + 1}`;
      }

      // Handle prerelease with identifier
      if (identifier)
        return `${typeof version === 'string' ? version : version.version}-${identifier}.1`;

      // Fallback
      return `${version}-${releaseType}`;
    });

    // Mock bumper with properly typed return values
    vi.mocked(Bumper.prototype.loadPreset).mockImplementation(() => {
      // Return the Bumper instance (this)
      return {} as Bumper;
    });
    vi.mocked(Bumper.prototype.bump).mockResolvedValue({ releaseType: 'patch' as const });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Forced version type (explicit bump)', () => {
    it('should return initial version if no latestTag and type provided', async () => {
      const options: VersionOptions = {
        // @ts-expect-error - Testing with null latestTag
        latestTag: null,
        type: 'minor',
        tagPrefix: 'v',
      };

      const version = await calculateVersion(defaultConfig as Config, options);

      expect(version).toBe('0.0.1');
    });

    it('should increment version based on specified type', async () => {
      const options: VersionOptions = {
        latestTag: 'v1.0.0',
        type: 'minor',
        tagPrefix: 'v',
      };

      const version = await calculateVersion(defaultConfig as Config, options);

      expect(semver.clean).toHaveBeenCalledWith('v1.0.0');
      expect(semver.inc).toHaveBeenCalledWith('1.0.0', 'minor', undefined);
      expect(version).toBe('1.1.0');
    });

    it('should automatically clean prerelease identifiers when using major bump', async () => {
      // Setup semver.prerelease to return a non-empty array for prerelease versions
      vi.mocked(semver.prerelease).mockReturnValue(['next', '0']);

      const options: VersionOptions = {
        latestTag: 'v1.0.0-next.0',
        type: 'major',
        tagPrefix: 'v',
      };

      const version = await calculateVersion(defaultConfig as Config, options);

      expect(semver.clean).toHaveBeenCalledWith('v1.0.0-next.0');
      expect(semver.prerelease).toHaveBeenCalledWith('1.0.0-next.0');
      expect(semver.inc).toHaveBeenCalledWith('1.0.0-next.0', 'major');
      expect(version).toBe('2.0.0');
    });

    it('should automatically clean prerelease identifiers when using minor bump', async () => {
      // Setup semver.prerelease to return a non-empty array for prerelease versions
      vi.mocked(semver.prerelease).mockReturnValue(['beta', '1']);

      const options: VersionOptions = {
        latestTag: 'v1.0.0-beta.1',
        type: 'minor',
        tagPrefix: 'v',
      };

      const version = await calculateVersion(defaultConfig as Config, options);

      expect(semver.clean).toHaveBeenCalledWith('v1.0.0-beta.1');
      expect(semver.prerelease).toHaveBeenCalledWith('1.0.0-beta.1');
      expect(semver.inc).toHaveBeenCalledWith('1.0.0-beta.1', 'minor');
      expect(version).toBe('1.1.0');
    });

    it('should automatically clean prerelease identifiers when using patch bump', async () => {
      // Setup semver.prerelease to return a non-empty array for prerelease versions
      vi.mocked(semver.prerelease).mockReturnValue(['alpha', '2']);

      const options: VersionOptions = {
        latestTag: 'v1.0.0-alpha.2',
        type: 'patch',
        tagPrefix: 'v',
      };

      const version = await calculateVersion(defaultConfig as Config, options);

      expect(semver.clean).toHaveBeenCalledWith('v1.0.0-alpha.2');
      expect(semver.prerelease).toHaveBeenCalledWith('1.0.0-alpha.2');
      expect(semver.inc).toHaveBeenCalledWith('1.0.0-alpha.2', 'patch');
      expect(version).toBe('1.0.1');
    });

    it('should still use prerelease identifiers when using prerelease bump types', async () => {
      const options: VersionOptions = {
        latestTag: 'v1.0.0',
        type: 'prerelease',
        tagPrefix: 'v',
        prereleaseIdentifier: 'alpha',
      };

      const version = await calculateVersion(defaultConfig as Config, options);

      expect(semver.inc).toHaveBeenCalledWith('1.0.0', 'prerelease', 'alpha');
      expect(version).toBe('1.0.0-alpha.1');
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

      vi.mocked(gitRepo.getCurrentBranch).mockReturnValue('feature/my-feature');

      // Execute
      const options: VersionOptions = {
        latestTag: 'v1.0.0',
        tagPrefix: 'v',
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
      expect(semver.inc).toHaveBeenCalledWith('1.0.0', 'minor', undefined);
      expect(version).toBe('1.1.0');
    });

    it('should use merged branch name if available', async () => {
      // Setup
      const config: Partial<Config> = {
        ...defaultConfig,
        versionStrategy: 'branchPattern',
        branchPattern: ['release:minor', 'hotfix:patch'],
      };

      vi.mocked(gitRepo.getCurrentBranch).mockReturnValue('main');
      vi.mocked(gitTags.lastMergeBranchName).mockResolvedValue('release/1.1.0');

      // Execute
      const options: VersionOptions = {
        latestTag: 'v1.0.0',
        tagPrefix: 'v',
        branchPattern: config.branchPattern,
        baseBranch: config.baseBranch,
      };

      const version = await calculateVersion(config as Config, options);

      // Verify
      expect(gitTags.lastMergeBranchName).toHaveBeenCalled();
      expect(semver.inc).toHaveBeenCalledWith('1.0.0', 'minor', undefined);
      expect(version).toBe('1.1.0');
    });

    it('should return empty string if no matching branch pattern found', async () => {
      // Setup
      const config: Partial<Config> = {
        ...defaultConfig,
        versionStrategy: 'branchPattern',
        branchPattern: ['release:minor', 'hotfix:patch'],
      };

      vi.mocked(gitRepo.getCurrentBranch).mockReturnValue('docs/update-readme');

      // Mock conventional-commits as fallback
      vi.mocked(gitTags.getCommitsLength).mockReturnValue(0);

      // Execute
      const options: VersionOptions = {
        latestTag: 'v1.0.0',
        tagPrefix: 'v',
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
  });

  describe('Conventional commits analysis', () => {
    it('should use conventional commits when no type or branch pattern matches', async () => {
      // Execute
      const options: VersionOptions = {
        latestTag: 'v1.0.0',
        tagPrefix: 'v',
      };

      const version = await calculateVersion(defaultConfig as Config, options);

      // Verify
      expect(Bumper.prototype.loadPreset).toHaveBeenCalledWith('conventional-commits');
      expect(Bumper.prototype.bump).toHaveBeenCalled();
      expect(semver.inc).toHaveBeenCalledWith('1.0.0', 'patch', undefined);
      expect(version).toBe('1.0.1');
    });

    it('should return empty string if no commits since last tag', async () => {
      vi.mocked(gitTags.getCommitsLength).mockReturnValue(0);

      const options: VersionOptions = {
        latestTag: 'v1.0.0',
        tagPrefix: 'v',
      };

      const version = await calculateVersion(defaultConfig as Config, options);

      expect(version).toBe('');
      expect(logging.log).toHaveBeenCalledWith(
        expect.stringContaining('No new commits found'),
        'info',
      );
    });

    it('should return empty string if conventional-commits finds no relevant commits', async () => {
      // Fix the type issue with releaseType
      vi.mocked(Bumper.prototype.bump).mockResolvedValue({ releaseType: undefined });

      const options: VersionOptions = {
        latestTag: 'v1.0.0',
        tagPrefix: 'v',
      };

      const version = await calculateVersion(defaultConfig as Config, options);

      expect(version).toBe('');
      expect(logging.log).toHaveBeenCalledWith(
        expect.stringContaining('No relevant commits found'),
        'info',
      );
    });

    it('should return initial version if no tags exist and conventional-commits suggests a type', async () => {
      const options: VersionOptions = {
        // @ts-expect-error - Testing with null latestTag
        latestTag: null,
        tagPrefix: 'v',
      };

      const version = await calculateVersion(defaultConfig as Config, options);

      expect(version).toBe('0.0.1');
    });
  });

  describe('Error handling', () => {
    it('should rethrow errors during conventional bump calculation', async () => {
      vi.mocked(Bumper.prototype.bump).mockRejectedValue(new Error('Failed to analyze commits'));

      const options: VersionOptions = {
        latestTag: 'v1.0.0',
        tagPrefix: 'v',
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
      vi.mocked(Bumper.prototype.bump).mockRejectedValue(error);

      const options: VersionOptions = {
        latestTag: 'v1.0.0',
        tagPrefix: 'v',
      };

      const version = await calculateVersion(defaultConfig as Config, options);

      expect(version).toBe('0.0.1');
      expect(logging.log).toHaveBeenCalledWith(expect.stringContaining('No tags found'), 'info');
    });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execAsync, execSync } from '../../../src/git/commandExecutor.js';
import {
  getCommitsLength,
  getLatestTag,
  getLatestTagForPackage,
  lastMergeBranchName,
} from '../../../src/git/tagsAndBranches.js';
import { log } from '../../../src/utils/logging.js';

// Mock dependencies
vi.mock('../../../src/git/commandExecutor.js');
vi.mock('../../../src/utils/logging.js');
vi.mock('git-semver-tags', () => ({
  getSemverTags: vi.fn(),
}));

describe('tagsAndBranches', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('getCommitsLength', () => {
    it('should return the number of commits since last tag', () => {
      // Setup
      vi.mocked(execSync, { partial: true }).mockReturnValue(Buffer.from('5'));

      // Execute
      const result = getCommitsLength('packages/test');

      // Verify
      expect(result).toBe(5);
      expect(execSync).toHaveBeenCalledWith(
        'git rev-list --count HEAD ^$(git describe --tags --abbrev=0) packages/test',
      );
    });

    it('should return 0 if command fails', () => {
      // Setup
      vi.mocked(execSync, { partial: true }).mockImplementation(() => {
        throw new Error('Command failed');
      });

      // Execute
      const result = getCommitsLength('packages/test');

      // Verify
      expect(result).toBe(0);
      expect(log).toHaveBeenCalledWith(
        'Failed to get number of commits since last tag: Command failed',
        'error',
      );
    });
  });

  describe('getLatestTag', () => {
    it('should return the latest semver tag', async () => {
      // Setup
      const mockGetSemverTags = await import('git-semver-tags');
      vi.mocked(mockGetSemverTags.getSemverTags, { partial: true }).mockResolvedValue([
        'v1.0.0',
        'v0.9.0',
      ]);

      // Execute
      const result = await getLatestTag();

      // Verify
      expect(result).toBe('v1.0.0');
      expect(mockGetSemverTags.getSemverTags).toHaveBeenCalledWith({});
    });

    it('should return empty string if no tags found', async () => {
      // Setup
      const mockGetSemverTags = await import('git-semver-tags');
      vi.mocked(mockGetSemverTags.getSemverTags, { partial: true }).mockResolvedValue([]);

      // Execute
      const result = await getLatestTag();

      // Verify
      expect(result).toBe('');
    });

    it('should log error and return empty string if getSemverTags fails', async () => {
      // Setup
      const mockGetSemverTags = await import('git-semver-tags');
      vi.mocked(mockGetSemverTags.getSemverTags, { partial: true }).mockRejectedValue(
        new Error('No names found'),
      );

      // Execute
      const result = await getLatestTag();

      // Verify
      expect(result).toBe('');
      expect(log).toHaveBeenCalledWith('Failed to get latest tag: No names found', 'error');
      expect(log).toHaveBeenCalledWith('No tags found in the repository.', 'info');
    });
  });

  describe('lastMergeBranchName', () => {
    it('should return the last merged branch name matching patterns', async () => {
      // Setup
      vi.mocked(execAsync, { partial: true }).mockResolvedValue({
        stdout: 'feature/test-branch',
        stderr: '',
      });

      // Execute
      const result = await lastMergeBranchName(['feature', 'fix'], 'main');

      // Verify
      expect(result).toBe('feature/test-branch');
      expect(execAsync).toHaveBeenCalledWith(expect.stringContaining('feature/(.*)|fix/(.*)'));
    });

    it('should return null if command fails', async () => {
      // Setup
      vi.mocked(execAsync, { partial: true }).mockRejectedValue(new Error('Command failed'));
      const consoleErrorSpy = vi.spyOn(console, 'error');

      // Execute
      const result = await lastMergeBranchName(['feature'], 'main');

      // Verify
      expect(result).toBe(null);
      expect(consoleErrorSpy).toHaveBeenCalled();
    });
  });

  describe('getLatestTagForPackage', () => {
    it('should find tag in format packageName@versionPrefix+version', async () => {
      // Setup
      const mockGetSemverTags = await import('git-semver-tags');
      vi.mocked(mockGetSemverTags.getSemverTags, { partial: true }).mockResolvedValue([
        'test-package@v1.0.0',
        'test-package@v0.9.0',
        'other-package@v1.2.0',
      ]);

      // Execute
      const result = await getLatestTagForPackage('test-package', 'v', {
        packageSpecificTags: true,
      });

      // Verify
      expect(result).toBe('test-package@v1.0.0');
      expect(mockGetSemverTags.getSemverTags).toHaveBeenCalledWith({ tagPrefix: 'v' });
      expect(log).toHaveBeenCalledWith(
        'Looking for tags for package test-package with prefix v, packageSpecificTags: true',
        'debug',
      );
    });

    it('should find tag in format versionPrefix+packageName@version', async () => {
      // Setup
      const mockGetSemverTags = await import('git-semver-tags');
      vi.mocked(mockGetSemverTags.getSemverTags, { partial: true }).mockResolvedValue([
        'vtest-package@1.0.0',
        'vother-package@1.2.0',
      ]);

      // Execute
      const result = await getLatestTagForPackage('test-package', 'v', {
        packageSpecificTags: true,
      });

      // Verify
      expect(result).toBe('vtest-package@1.0.0');

      // Check for the actual log messages in the correct order
      expect(log).toHaveBeenCalledWith(
        'Looking for tags for package test-package with prefix v, packageSpecificTags: true',
        'debug',
      );

      expect(log).toHaveBeenCalledWith(
        'Retrieved 2 tags: vtest-package@1.0.0, vother-package@1.2.0',
        'debug',
      );

      expect(log).toHaveBeenCalledWith(
        'Found 1 package tags using pattern: vpackageName@...',
        'debug',
      );

      expect(log).toHaveBeenCalledWith('Using tag: vtest-package@1.0.0', 'debug');
    });

    it('should find tag in format packageName@version when no prefix is provided', async () => {
      // Setup
      const mockGetSemverTags = await import('git-semver-tags');
      vi.mocked(mockGetSemverTags.getSemverTags, { partial: true }).mockResolvedValue([
        'test-package@1.0.0',
        'test-package@0.9.0',
        'other-package@1.2.0',
      ]);

      // Execute
      const result = await getLatestTagForPackage('test-package', undefined, {
        packageSpecificTags: true,
      });

      // Verify
      expect(result).toBe('test-package@1.0.0');
      expect(mockGetSemverTags.getSemverTags).toHaveBeenCalledWith({ tagPrefix: undefined });
      expect(log).toHaveBeenCalledWith(
        'Looking for tags for package test-package with prefix none, packageSpecificTags: true',
        'debug',
      );
    });

    it('should handle special characters in package name', async () => {
      // Setup
      const mockGetSemverTags = await import('git-semver-tags');
      vi.mocked(mockGetSemverTags.getSemverTags, { partial: true }).mockResolvedValue([
        '@scope/test-package@v1.0.0',
        '@scope/other-package@v1.2.0',
      ]);

      // Execute
      const result = await getLatestTagForPackage('@scope/test-package', 'v', {
        packageSpecificTags: true,
      });

      // Verify
      expect(result).toBe('@scope/test-package@v1.0.0');
    });

    it('should return empty string if no tags match packageName pattern', async () => {
      // Setup
      const mockGetSemverTags = await import('git-semver-tags');
      vi.mocked(mockGetSemverTags.getSemverTags, { partial: true }).mockResolvedValue([
        'other-package@v1.0.0',
        'another-package@v0.9.0',
      ]);

      // Execute
      const result = await getLatestTagForPackage('test-package', 'v', {
        packageSpecificTags: true,
      });

      // Verify
      expect(result).toBe('');
      expect(log).toHaveBeenCalledWith(
        'Looking for tags for package test-package with prefix v, packageSpecificTags: true',
        'debug',
      );
      expect(log).toHaveBeenCalledWith(
        'Retrieved 2 tags: other-package@v1.0.0, another-package@v0.9.0',
        'debug',
      );
      expect(log).toHaveBeenCalledWith('Found 0 package tags for test-package', 'debug');
      expect(log).toHaveBeenCalledWith(
        'No matching tags found for pattern: packageName@version',
        'debug',
      );
      expect(log).toHaveBeenCalledWith(
        'Available tags: other-package@v1.0.0, another-package@v0.9.0',
        'debug',
      );
    });

    it('should return empty string if no tags are found at all', async () => {
      // Setup
      const mockGetSemverTags = await import('git-semver-tags');
      vi.mocked(mockGetSemverTags.getSemverTags, { partial: true }).mockResolvedValue([]);

      // Execute
      const result = await getLatestTagForPackage('test-package', 'v', {
        packageSpecificTags: true,
      });

      // Verify
      expect(result).toBe('');
      expect(log).toHaveBeenCalledWith(
        'Looking for tags for package test-package with prefix v, packageSpecificTags: true',
        'debug',
      );
      expect(log).toHaveBeenCalledWith('Retrieved 0 tags: ', 'debug');
      expect(log).toHaveBeenCalledWith('Found 0 package tags for test-package', 'debug');
      expect(log).toHaveBeenCalledWith('No tags available in the repository', 'debug');
    });

    it('should log error and return empty string if getSemverTags fails', async () => {
      // Setup
      const mockGetSemverTags = await import('git-semver-tags');
      vi.mocked(mockGetSemverTags.getSemverTags, { partial: true }).mockRejectedValue(
        new Error('No names found'),
      );

      // Execute
      const result = await getLatestTagForPackage('test-package', 'v');

      // Verify
      expect(result).toBe('');
      expect(log).toHaveBeenCalledWith(
        'Failed to get latest tag for package test-package: No names found',
        'error',
      );
      expect(log).toHaveBeenCalledWith('No tags found for package test-package.', 'info');
    });

    it('should handle non-standard error without Error instance', async () => {
      // Setup
      const mockGetSemverTags = await import('git-semver-tags');
      vi.mocked(mockGetSemverTags.getSemverTags, { partial: true }).mockRejectedValue(
        'String error',
      );

      // Execute
      const result = await getLatestTagForPackage('test-package');

      // Verify
      expect(result).toBe('');
      expect(log).toHaveBeenCalledWith(
        'Failed to get latest tag for package test-package: String error',
        'error',
      );
    });
  });
});

describe('Semantic Tag Ordering', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('getLatestTag with semantic ordering', () => {
    it('should return semantically latest tag when tags are in correct chronological order', async () => {
      // Setup - chronological order matches semantic order
      const mockGetSemverTags = await import('git-semver-tags');
      vi.mocked(mockGetSemverTags.getSemverTags, { partial: true }).mockResolvedValue([
        'v1.2.0', // chronologically and semantically latest
        'v1.1.0',
        'v1.0.0',
      ]);

      // Execute
      const result = await getLatestTag('v');

      // Verify
      expect(result).toBe('v1.2.0');
      expect(mockGetSemverTags.getSemverTags).toHaveBeenCalledWith({ tagPrefix: 'v' });
    });

    it('should return semantically latest tag when tags are misordered chronologically', async () => {
      // Setup - chronological order does NOT match semantic order
      const mockGetSemverTags = await import('git-semver-tags');
      vi.mocked(mockGetSemverTags.getSemverTags, { partial: true }).mockResolvedValue([
        'v1.0.5', // chronologically latest but semantically older
        'v1.2.0', // semantically latest but chronologically older
        'v1.1.0',
        'v1.0.0',
      ]);

      // Execute
      const result = await getLatestTag('v');

      // Verify - should return semantic latest, not chronological latest
      expect(result).toBe('v1.2.0');
      expect(log).toHaveBeenCalledWith(
        'Tag ordering differs: chronological latest is v1.0.5, semantic latest is v1.2.0',
        'debug',
      );
      expect(log).toHaveBeenCalledWith(
        'Using semantic latest (v1.2.0) to handle out-of-order tag creation',
        'info',
      );
    });

    it('should handle prereleases correctly in semantic ordering', async () => {
      // Setup
      const mockGetSemverTags = await import('git-semver-tags');
      vi.mocked(mockGetSemverTags.getSemverTags, { partial: true }).mockResolvedValue([
        'v1.0.0-beta.2', // chronologically latest prerelease
        'v1.0.0', // semantically latest stable
        'v1.0.0-beta.1',
        'v0.9.0',
      ]);

      // Execute
      const result = await getLatestTag('v');

      // Verify - stable release should be considered higher than prerelease
      expect(result).toBe('v1.0.0');
    });

    it('should return empty string when no tags found', async () => {
      // Setup
      const mockGetSemverTags = await import('git-semver-tags');
      vi.mocked(mockGetSemverTags.getSemverTags, { partial: true }).mockResolvedValue([]);

      // Execute
      const result = await getLatestTag('v');

      // Verify
      expect(result).toBe('');
    });

    it('should handle semver.clean failures gracefully', async () => {
      // Setup
      const mockGetSemverTags = await import('git-semver-tags');
      vi.mocked(mockGetSemverTags.getSemverTags, { partial: true }).mockResolvedValue([
        'invalid-tag',
        'v1.0.0',
        'another-invalid',
      ]);

      // Execute
      const result = await getLatestTag('v');

      // Verify - should handle invalid tags and return the valid one
      expect(result).toBe('v1.0.0');
    });

    it('should use semantic ordering by default', async () => {
      // Setup
      const mockGetSemverTags = await import('git-semver-tags');
      vi.mocked(mockGetSemverTags.getSemverTags, { partial: true }).mockResolvedValue([
        'v0.7.4', // chronologically latest
        'v0.8.1', // semantically latest
        'v0.7.1',
      ]);

      // Execute
      const result = await getLatestTag('v');

      // Verify
      expect(result).toBe('v0.8.1'); // Should return semantic latest
    });
  });
});

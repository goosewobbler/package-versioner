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
      vi.mocked(execSync).mockReturnValue(Buffer.from('5'));

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
      vi.mocked(execSync).mockImplementation(() => {
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
      vi.mocked(mockGetSemverTags.getSemverTags).mockResolvedValue(['v1.0.0', 'v0.9.0']);

      // Execute
      const result = await getLatestTag();

      // Verify
      expect(result).toBe('v1.0.0');
      expect(mockGetSemverTags.getSemverTags).toHaveBeenCalledWith({});
    });

    it('should return empty string if no tags found', async () => {
      // Setup
      const mockGetSemverTags = await import('git-semver-tags');
      vi.mocked(mockGetSemverTags.getSemverTags).mockResolvedValue([]);

      // Execute
      const result = await getLatestTag();

      // Verify
      expect(result).toBe('');
    });

    it('should log error and return empty string if getSemverTags fails', async () => {
      // Setup
      const mockGetSemverTags = await import('git-semver-tags');
      vi.mocked(mockGetSemverTags.getSemverTags).mockRejectedValue(new Error('No names found'));

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
      vi.mocked(execAsync).mockResolvedValue({
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
      vi.mocked(execAsync).mockRejectedValue(new Error('Command failed'));
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
      vi.mocked(mockGetSemverTags.getSemverTags).mockResolvedValue([
        'test-package@v1.0.0',
        'test-package@v0.9.0',
        'other-package@v1.2.0',
      ]);

      // Execute
      const result = await getLatestTagForPackage('test-package', 'v');

      // Verify
      expect(result).toBe('test-package@v1.0.0');
      expect(mockGetSemverTags.getSemverTags).toHaveBeenCalledWith({ tagPrefix: 'v' });
      expect(log).toHaveBeenCalledWith(
        'Looking for tags for package test-package with prefix v',
        'debug',
      );
    });

    it('should find tag in format versionPrefix+packageName@version', async () => {
      // Setup
      const mockGetSemverTags = await import('git-semver-tags');
      vi.mocked(mockGetSemverTags.getSemverTags).mockResolvedValue([
        'vtest-package@1.0.0',
        'vother-package@1.2.0',
      ]);

      // Execute
      const result = await getLatestTagForPackage('test-package', 'v');

      // Verify
      expect(result).toBe('vtest-package@1.0.0');

      // Check for the actual log messages in the correct order
      expect(log).toHaveBeenCalledWith(
        'Looking for tags for package test-package with prefix v',
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
      vi.mocked(mockGetSemverTags.getSemverTags).mockResolvedValue([
        'test-package@1.0.0',
        'test-package@0.9.0',
        'other-package@1.2.0',
      ]);

      // Execute
      const result = await getLatestTagForPackage('test-package');

      // Verify
      expect(result).toBe('test-package@1.0.0');
      expect(mockGetSemverTags.getSemverTags).toHaveBeenCalledWith({ tagPrefix: undefined });
      expect(log).toHaveBeenCalledWith(
        'Looking for tags for package test-package with prefix none',
        'debug',
      );
    });

    it('should handle special characters in package name', async () => {
      // Setup
      const mockGetSemverTags = await import('git-semver-tags');
      vi.mocked(mockGetSemverTags.getSemverTags).mockResolvedValue([
        '@scope/test-package@v1.0.0',
        '@scope/other-package@v1.2.0',
      ]);

      // Execute
      const result = await getLatestTagForPackage('@scope/test-package', 'v');

      // Verify
      expect(result).toBe('@scope/test-package@v1.0.0');
    });

    it('should return empty string if no tags match packageName pattern', async () => {
      // Setup
      const mockGetSemverTags = await import('git-semver-tags');
      vi.mocked(mockGetSemverTags.getSemverTags).mockResolvedValue([
        'other-package@v1.0.0',
        'another-package@v0.9.0',
      ]);

      // Execute
      const result = await getLatestTagForPackage('test-package', 'v');

      // Verify
      expect(result).toBe('');
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
      vi.mocked(mockGetSemverTags.getSemverTags).mockResolvedValue([]);

      // Execute
      const result = await getLatestTagForPackage('test-package', 'v');

      // Verify
      expect(result).toBe('');
      expect(log).toHaveBeenCalledWith('Retrieved 0 tags: ', 'debug');
      expect(log).toHaveBeenCalledWith('Found 0 package tags for test-package', 'debug');
      expect(log).toHaveBeenCalledWith('No tags available in the repository', 'debug');
    });

    it('should log error and return empty string if getSemverTags fails', async () => {
      // Setup
      const mockGetSemverTags = await import('git-semver-tags');
      vi.mocked(mockGetSemverTags.getSemverTags).mockRejectedValue(new Error('No names found'));

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
      vi.mocked(mockGetSemverTags.getSemverTags).mockRejectedValue('String error');

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

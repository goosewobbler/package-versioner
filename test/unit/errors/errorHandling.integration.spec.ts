import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BasePackageVersionerError } from '../../../src/errors/baseError.js';
import { createGitError, GitError, GitErrorCode } from '../../../src/errors/gitError.js';
import {
  createVersionError,
  VersionError,
  VersionErrorCode,
} from '../../../src/errors/versionError.js';

// Mock the logging function
vi.mock('../../../src/utils/logging.js', () => ({
  log: vi.fn(),
}));

describe('Error Handling Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Streamlined error handling pattern', () => {
    it('should handle any package-versioner error with single type guard', () => {
      const gitError = createGitError(GitErrorCode.TAG_ALREADY_EXISTS);
      const versionError = createVersionError(VersionErrorCode.CONFIG_REQUIRED);
      const regularError = new Error('Regular error');

      // Test the streamlined pattern that replaces instanceof checks
      expect(BasePackageVersionerError.isPackageVersionerError(gitError)).toBe(true);
      expect(BasePackageVersionerError.isPackageVersionerError(versionError)).toBe(true);
      expect(BasePackageVersionerError.isPackageVersionerError(regularError)).toBe(false);
    });

    it('should demonstrate the old vs new error handling pattern', async () => {
      const { log } = vi.mocked(await import('../../../src/utils/logging.js'));
      const gitError = createGitError(GitErrorCode.TAG_ALREADY_EXISTS);
      const versionError = createVersionError(VersionErrorCode.PACKAGES_NOT_FOUND);

      // New streamlined pattern - single check handles all package-versioner errors
      const errors = [gitError, versionError, new Error('Other error')];

      errors.forEach((error) => {
        if (BasePackageVersionerError.isPackageVersionerError(error)) {
          error.logError(); // Centralized, consistent error logging
        } else {
          // Handle non-package-versioner errors
          console.log('Non-package-versioner error:', error.message);
        }
      });

      // Verify that both package-versioner errors were logged with suggestions
      expect(log).toHaveBeenCalledWith('Git tag already exists', 'error');
      expect(log).toHaveBeenCalledWith('Failed to get packages information', 'error');
      expect(log).toHaveBeenCalledWith('\nSuggested solutions:', 'info');
    });

    it('should maintain backward compatibility with existing error types', () => {
      const gitError = new GitError('Git error', 'GIT_CODE');
      const versionError = new VersionError('Version error', 'VERSION_CODE');

      // These should still work as before
      expect(gitError instanceof GitError).toBe(true);
      expect(versionError instanceof VersionError).toBe(true);

      // But now they also work with the unified type guard
      expect(BasePackageVersionerError.isPackageVersionerError(gitError)).toBe(true);
      expect(BasePackageVersionerError.isPackageVersionerError(versionError)).toBe(true);
    });

    it('should provide consistent error logging behavior across error types', async () => {
      const { log } = vi.mocked(await import('../../../src/utils/logging.js'));

      const gitError = createGitError(GitErrorCode.NOT_GIT_REPO);
      const versionError = createVersionError(VersionErrorCode.INVALID_CONFIG);

      gitError.logError();
      versionError.logError();

      // Both should log in the same format: error message + suggestions
      expect(log).toHaveBeenCalledWith('Not a git repository', 'error');
      expect(log).toHaveBeenCalledWith('\nSuggested solutions:', 'info');
      expect(log).toHaveBeenCalledWith('Invalid configuration', 'error');

      // Should have numbered suggestion calls (NOT_GIT_REPO has 2, INVALID_CONFIG has 3)
      const suggestionCalls = log.mock.calls.filter((call) => call[0].toString().match(/^\d+\. /));
      expect(suggestionCalls).toHaveLength(5); // 2 + 3 suggestions
    });
  });

  describe('Error suggestion system', () => {
    it('should provide contextually relevant suggestions for different error types', () => {
      const tagError = createGitError(GitErrorCode.TAG_ALREADY_EXISTS);
      const repoError = createGitError(GitErrorCode.NOT_GIT_REPO);
      const configError = createVersionError(VersionErrorCode.CONFIG_REQUIRED);
      const packageError = createVersionError(VersionErrorCode.PACKAGES_NOT_FOUND);

      // TAG_ALREADY_EXISTS should have tag-specific suggestions
      expect(tagError.suggestions).toEqual([
        'Delete the existing tag: git tag -d <tag-name>',
        'Use a different version by incrementing manually',
        'Check if this version was already released',
      ]);

      // NOT_GIT_REPO should have repository setup suggestions
      expect(repoError.suggestions).toEqual([
        'Initialize git repository with: git init',
        'Ensure you are in the correct directory',
      ]);

      // CONFIG_REQUIRED should have configuration setup suggestions
      expect(configError.suggestions).toEqual([
        'Create a version.config.json file in your project root',
        'Check the documentation for configuration examples',
      ]);

      // PACKAGES_NOT_FOUND should have package discovery suggestions
      expect(packageError.suggestions).toEqual([
        'Ensure package.json or Cargo.toml files exist in your project',
        'Check workspace configuration (pnpm-workspace.yaml, etc.)',
        'Verify file permissions and paths',
      ]);
    });

    it('should handle errors without suggestions gracefully', async () => {
      const { log } = vi.mocked(await import('../../../src/utils/logging.js'));
      const simpleGitError = createGitError(GitErrorCode.GIT_ERROR);

      simpleGitError.logError();

      // Should only log the error message, no suggestions
      expect(log).toHaveBeenCalledWith('Git operation failed', 'error');
      expect(log).toHaveBeenCalledTimes(1);
    });
  });

  describe('Type safety and inheritance', () => {
    it('should maintain proper inheritance chain', () => {
      const gitError = createGitError(GitErrorCode.TAG_ALREADY_EXISTS);
      const versionError = createVersionError(VersionErrorCode.CONFIG_REQUIRED);

      // Check full inheritance chain
      expect(gitError instanceof Error).toBe(true);
      expect(gitError instanceof BasePackageVersionerError).toBe(true);
      expect(gitError instanceof GitError).toBe(true);

      expect(versionError instanceof Error).toBe(true);
      expect(versionError instanceof BasePackageVersionerError).toBe(true);
      expect(versionError instanceof VersionError).toBe(true);
    });

    it('should have proper error names for debugging', () => {
      const gitError = new GitError('Test', 'CODE');
      const versionError = new VersionError('Test', 'CODE');

      expect(gitError.name).toBe('GitError');
      expect(versionError.name).toBe('VersionError');
    });

    it('should preserve error stack traces', () => {
      const gitError = createGitError(GitErrorCode.GIT_ERROR);
      const versionError = createVersionError(VersionErrorCode.CONFIG_REQUIRED);

      expect(gitError.stack).toBeDefined();
      expect(versionError.stack).toBeDefined();
      expect(gitError.stack).toContain('GitError');
      expect(versionError.stack).toContain('VersionError');
    });
  });

  describe('Performance and efficiency', () => {
    it('should efficiently identify error types with single type guard call', () => {
      const errors = [
        createGitError(GitErrorCode.TAG_ALREADY_EXISTS),
        createVersionError(VersionErrorCode.CONFIG_REQUIRED),
        new Error('Regular error'),
        'not an error',
        null,
        undefined,
      ];

      // Single method call replaces multiple instanceof checks
      const packageVersionerErrors = errors.filter(
        BasePackageVersionerError.isPackageVersionerError,
      );

      expect(packageVersionerErrors).toHaveLength(2);
      expect(packageVersionerErrors[0]).toBeInstanceOf(GitError);
      expect(packageVersionerErrors[1]).toBeInstanceOf(VersionError);
    });
  });
});

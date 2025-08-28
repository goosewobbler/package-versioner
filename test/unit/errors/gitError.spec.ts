import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BasePackageVersionerError } from '../../../src/errors/baseError.js';
import { createGitError, GitError, GitErrorCode } from '../../../src/errors/gitError.js';

// Mock the logging function
vi.mock('../../../src/utils/logging.js', () => ({
  log: vi.fn(),
}));

describe('GitError', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GitError class', () => {
    it('should extend BasePackageVersionerError', () => {
      const error = new GitError('Git error message', 'GIT_CODE');

      expect(error instanceof BasePackageVersionerError).toBe(true);
      expect(error instanceof GitError).toBe(true);
      expect(error.message).toBe('Git error message');
      expect(error.code).toBe('GIT_CODE');
    });

    it('should inherit logError functionality from base class', async () => {
      const { log } = vi.mocked(await import('../../../src/utils/logging.js'));
      const error = new GitError('Git error', 'GIT_CODE', ['Suggestion 1']);

      error.logError();

      expect(log).toHaveBeenCalledWith('Git error', 'error');
      expect(log).toHaveBeenCalledWith('\nSuggested solutions:', 'info');
      expect(log).toHaveBeenCalledWith('1. Suggestion 1', 'info');
    });
  });

  describe('createGitError factory function', () => {
    it('should create GitError with NOT_GIT_REPO code and suggestions', () => {
      const error = createGitError(GitErrorCode.NOT_GIT_REPO);

      expect(error).toBeInstanceOf(GitError);
      expect(error.code).toBe(GitErrorCode.NOT_GIT_REPO);
      expect(error.message).toBe('Not a git repository');
      expect(error.suggestions).toEqual([
        'Initialize git repository with: git init',
        'Ensure you are in the correct directory',
      ]);
    });

    it('should create GitError with TAG_ALREADY_EXISTS code and helpful suggestions', () => {
      const error = createGitError(GitErrorCode.TAG_ALREADY_EXISTS, 'Tag v1.0.0 already exists');

      expect(error).toBeInstanceOf(GitError);
      expect(error.code).toBe(GitErrorCode.TAG_ALREADY_EXISTS);
      expect(error.message).toBe('Git tag already exists: Tag v1.0.0 already exists');
      expect(error.suggestions).toEqual([
        'Delete the existing tag: git tag -d <tag-name>',
        'Use a different version by incrementing manually',
        'Check if this version was already released',
      ]);
    });

    it('should create GitError without suggestions for codes that do not have them', () => {
      const error = createGitError(GitErrorCode.GIT_ERROR);

      expect(error).toBeInstanceOf(GitError);
      expect(error.code).toBe(GitErrorCode.GIT_ERROR);
      expect(error.message).toBe('Git operation failed');
      expect(error.suggestions).toBeUndefined();
    });

    it('should handle details parameter correctly', () => {
      const error = createGitError(
        GitErrorCode.GIT_PROCESS_ERROR,
        'Command failed with exit code 1',
      );

      expect(error.message).toBe('Failed to create new version: Command failed with exit code 1');
      expect(error.code).toBe(GitErrorCode.GIT_PROCESS_ERROR);
    });

    it('should create error without details when not provided', () => {
      const error = createGitError(GitErrorCode.NO_COMMIT_MESSAGE);

      expect(error.message).toBe('Commit message is required');
      expect(error.code).toBe(GitErrorCode.NO_COMMIT_MESSAGE);
    });

    it('should work with all GitErrorCode enum values', () => {
      const allCodes = [
        GitErrorCode.NOT_GIT_REPO,
        GitErrorCode.GIT_PROCESS_ERROR,
        GitErrorCode.NO_FILES,
        GitErrorCode.NO_COMMIT_MESSAGE,
        GitErrorCode.GIT_ERROR,
        GitErrorCode.TAG_ALREADY_EXISTS,
      ];

      allCodes.forEach((code) => {
        const error = createGitError(code);
        expect(error).toBeInstanceOf(GitError);
        expect(error.code).toBe(code);
        expect(error.message).toBeTruthy();
      });
    });
  });

  describe('Suggestions integration', () => {
    it('should log TAG_ALREADY_EXISTS error with suggestions', async () => {
      const { log } = vi.mocked(await import('../../../src/utils/logging.js'));
      const error = createGitError(GitErrorCode.TAG_ALREADY_EXISTS);

      error.logError();

      expect(log).toHaveBeenCalledWith('Git tag already exists', 'error');
      expect(log).toHaveBeenCalledWith('\nSuggested solutions:', 'info');
      expect(log).toHaveBeenCalledWith('1. Delete the existing tag: git tag -d <tag-name>', 'info');
      expect(log).toHaveBeenCalledWith(
        '2. Use a different version by incrementing manually',
        'info',
      );
      expect(log).toHaveBeenCalledWith('3. Check if this version was already released', 'info');
    });

    it('should log NOT_GIT_REPO error with suggestions', async () => {
      const { log } = vi.mocked(await import('../../../src/utils/logging.js'));
      const error = createGitError(GitErrorCode.NOT_GIT_REPO);

      error.logError();

      expect(log).toHaveBeenCalledWith('Not a git repository', 'error');
      expect(log).toHaveBeenCalledWith('\nSuggested solutions:', 'info');
      expect(log).toHaveBeenCalledWith('1. Initialize git repository with: git init', 'info');
      expect(log).toHaveBeenCalledWith('2. Ensure you are in the correct directory', 'info');
    });

    it('should not log suggestions for error codes without them', async () => {
      const { log } = vi.mocked(await import('../../../src/utils/logging.js'));
      const error = createGitError(GitErrorCode.GIT_ERROR);

      error.logError();

      expect(log).toHaveBeenCalledWith('Git operation failed', 'error');
      expect(log).toHaveBeenCalledTimes(1); // Only the error message, no suggestions
    });
  });
});

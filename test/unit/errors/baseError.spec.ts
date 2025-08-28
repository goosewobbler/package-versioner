import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BasePackageVersionerError } from '../../../src/errors/baseError.js';

// Create a concrete test class since BasePackageVersionerError is abstract
class TestPackageVersionerError extends BasePackageVersionerError {}

// Mock the logging function
vi.mock('../../../src/utils/logging.js', () => ({
  log: vi.fn(),
}));

describe('BasePackageVersionerError', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Constructor and Basic Properties', () => {
    it('should create error with message and code', () => {
      const error = new TestPackageVersionerError('Test error message', 'TEST_CODE');

      expect(error.message).toBe('Test error message');
      expect(error.code).toBe('TEST_CODE');
      expect(error.name).toBe('TestPackageVersionerError');
      expect(error.suggestions).toBeUndefined();
    });

    it('should create error with suggestions', () => {
      const suggestions = ['First suggestion', 'Second suggestion'];
      const error = new TestPackageVersionerError('Test error', 'TEST_CODE', suggestions);

      expect(error.suggestions).toEqual(suggestions);
    });

    it('should extend Error properly', () => {
      const error = new TestPackageVersionerError('Test error', 'TEST_CODE');

      expect(error instanceof Error).toBe(true);
      expect(error instanceof BasePackageVersionerError).toBe(true);
    });
  });

  describe('logError method', () => {
    it('should log error message without suggestions', async () => {
      const { log } = vi.mocked(await import('../../../src/utils/logging.js'));
      const error = new TestPackageVersionerError('Test error message', 'TEST_CODE');

      error.logError();

      expect(log).toHaveBeenCalledWith('Test error message', 'error');
      expect(log).toHaveBeenCalledTimes(1);
    });

    it('should log error message with suggestions', async () => {
      const { log } = vi.mocked(await import('../../../src/utils/logging.js'));
      const suggestions = ['First suggestion', 'Second suggestion', 'Third suggestion'];
      const error = new TestPackageVersionerError('Test error message', 'TEST_CODE', suggestions);

      error.logError();

      expect(log).toHaveBeenCalledWith('Test error message', 'error');
      expect(log).toHaveBeenCalledWith('\nSuggested solutions:', 'info');
      expect(log).toHaveBeenCalledWith('1. First suggestion', 'info');
      expect(log).toHaveBeenCalledWith('2. Second suggestion', 'info');
      expect(log).toHaveBeenCalledWith('3. Third suggestion', 'info');
      expect(log).toHaveBeenCalledTimes(5);
    });

    it('should not log suggestions if array is empty', async () => {
      const { log } = vi.mocked(await import('../../../src/utils/logging.js'));
      const error = new TestPackageVersionerError('Test error message', 'TEST_CODE', []);

      error.logError();

      expect(log).toHaveBeenCalledWith('Test error message', 'error');
      expect(log).toHaveBeenCalledTimes(1);
    });

    it('should handle single suggestion correctly', async () => {
      const { log } = vi.mocked(await import('../../../src/utils/logging.js'));
      const error = new TestPackageVersionerError('Test error', 'TEST_CODE', ['Only suggestion']);

      error.logError();

      expect(log).toHaveBeenCalledWith('Test error', 'error');
      expect(log).toHaveBeenCalledWith('\nSuggested solutions:', 'info');
      expect(log).toHaveBeenCalledWith('1. Only suggestion', 'info');
      expect(log).toHaveBeenCalledTimes(3);
    });
  });

  describe('isPackageVersionerError type guard', () => {
    it('should return true for BasePackageVersionerError instances', () => {
      const error = new TestPackageVersionerError('Test error', 'TEST_CODE');

      expect(BasePackageVersionerError.isPackageVersionerError(error)).toBe(true);
    });

    it('should return false for regular Error instances', () => {
      const error = new Error('Regular error');

      expect(BasePackageVersionerError.isPackageVersionerError(error)).toBe(false);
    });

    it('should return false for non-error values', () => {
      expect(BasePackageVersionerError.isPackageVersionerError('string')).toBe(false);
      expect(BasePackageVersionerError.isPackageVersionerError(42)).toBe(false);
      expect(BasePackageVersionerError.isPackageVersionerError(null)).toBe(false);
      expect(BasePackageVersionerError.isPackageVersionerError(undefined)).toBe(false);
      expect(BasePackageVersionerError.isPackageVersionerError({})).toBe(false);
    });

    it('should return true for subclasses of BasePackageVersionerError', () => {
      class SpecificError extends BasePackageVersionerError {}
      const error = new SpecificError('Specific error', 'SPECIFIC_CODE');

      expect(BasePackageVersionerError.isPackageVersionerError(error)).toBe(true);
    });
  });

  describe('Integration with GitError and VersionError', () => {
    it('should work correctly with GitError instances', async () => {
      const { GitError } = await import('../../../src/errors/gitError.js');
      const gitError = new GitError('Git error message', 'GIT_ERROR_CODE');

      expect(BasePackageVersionerError.isPackageVersionerError(gitError)).toBe(true);
      expect(gitError instanceof BasePackageVersionerError).toBe(true);
    });

    it('should work correctly with VersionError instances', async () => {
      const { VersionError } = await import('../../../src/errors/versionError.js');
      const versionError = new VersionError('Version error message', 'VERSION_ERROR_CODE');

      expect(BasePackageVersionerError.isPackageVersionerError(versionError)).toBe(true);
      expect(versionError instanceof BasePackageVersionerError).toBe(true);
    });
  });
});

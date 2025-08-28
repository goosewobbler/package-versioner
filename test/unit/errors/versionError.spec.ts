import { describe, expect, it, vi } from 'vitest';
import { BasePackageVersionerError } from '../../../src/errors/baseError.js';
import {
  createVersionError,
  VersionError,
  VersionErrorCode,
} from '../../../src/errors/versionError.js';

// Mock the logging function
vi.mock('../../../src/utils/logging.js', () => ({
  log: vi.fn(),
}));

describe('VersionError', () => {
  describe('VersionError class', () => {
    it('should extend BasePackageVersionerError', () => {
      const error = new VersionError('Version error message', 'VERSION_CODE');

      expect(error instanceof BasePackageVersionerError).toBe(true);
      expect(error instanceof VersionError).toBe(true);
      expect(error.message).toBe('Version error message');
      expect(error.code).toBe('VERSION_CODE');
    });

    it('should inherit logError functionality from base class', async () => {
      const { log } = vi.mocked(await import('../../../src/utils/logging.js'));
      const error = new VersionError('Version error', 'VERSION_CODE', ['Fix suggestion']);

      error.logError();

      expect(log).toHaveBeenCalledWith('Version error', 'error');
      expect(log).toHaveBeenCalledWith('\nSuggested solutions:', 'info');
      expect(log).toHaveBeenCalledWith('1. Fix suggestion', 'info');
    });
  });

  describe('createVersionError factory function', () => {
    it('should create VersionError with CONFIG_REQUIRED code and suggestions', () => {
      const error = createVersionError(VersionErrorCode.CONFIG_REQUIRED);

      expect(error).toBeInstanceOf(VersionError);
      expect(error.code).toBe(VersionErrorCode.CONFIG_REQUIRED);
      expect(error.message).toBe('Configuration is required');
      expect(error.suggestions).toEqual([
        'Create a version.config.json file in your project root',
        'Check the documentation for configuration examples',
      ]);
    });

    it('should create VersionError with PACKAGES_NOT_FOUND code and helpful suggestions', () => {
      const error = createVersionError(
        VersionErrorCode.PACKAGES_NOT_FOUND,
        'No package.json found',
      );

      expect(error).toBeInstanceOf(VersionError);
      expect(error.code).toBe(VersionErrorCode.PACKAGES_NOT_FOUND);
      expect(error.message).toBe('Failed to get packages information: No package.json found');
      expect(error.suggestions).toEqual([
        'Ensure package.json or Cargo.toml files exist in your project',
        'Check workspace configuration (pnpm-workspace.yaml, etc.)',
        'Verify file permissions and paths',
      ]);
    });

    it('should create VersionError with WORKSPACE_ERROR code and suggestions', () => {
      const error = createVersionError(VersionErrorCode.WORKSPACE_ERROR);

      expect(error).toBeInstanceOf(VersionError);
      expect(error.code).toBe(VersionErrorCode.WORKSPACE_ERROR);
      expect(error.message).toBe('Failed to get workspace packages');
      expect(error.suggestions).toEqual([
        'Verify workspace configuration files are valid',
        'Check that workspace packages are accessible',
        'Ensure proper monorepo structure',
      ]);
    });

    it('should create VersionError with INVALID_CONFIG code and suggestions', () => {
      const error = createVersionError(VersionErrorCode.INVALID_CONFIG);

      expect(error).toBeInstanceOf(VersionError);
      expect(error.code).toBe(VersionErrorCode.INVALID_CONFIG);
      expect(error.message).toBe('Invalid configuration');
      expect(error.suggestions).toEqual([
        'Validate version.config.json syntax',
        'Check configuration against schema',
        'Review documentation for valid configuration options',
      ]);
    });

    it('should create VersionError with PACKAGE_NOT_FOUND code and suggestions', () => {
      const error = createVersionError(
        VersionErrorCode.PACKAGE_NOT_FOUND,
        '@scope/missing-package',
      );

      expect(error).toBeInstanceOf(VersionError);
      expect(error.code).toBe(VersionErrorCode.PACKAGE_NOT_FOUND);
      expect(error.message).toBe('Package not found: @scope/missing-package');
      expect(error.suggestions).toEqual([
        'Verify package name spelling and case',
        'Check if package exists in workspace',
        'Review packages configuration in version.config.json',
      ]);
    });

    it('should create VersionError with VERSION_CALCULATION_ERROR code and suggestions', () => {
      const error = createVersionError(VersionErrorCode.VERSION_CALCULATION_ERROR);

      expect(error).toBeInstanceOf(VersionError);
      expect(error.code).toBe(VersionErrorCode.VERSION_CALCULATION_ERROR);
      expect(error.message).toBe('Failed to calculate version');
      expect(error.suggestions).toEqual([
        'Ensure git repository has commits',
        'Check conventional commit message format',
        'Verify git tags are properly formatted',
      ]);
    });

    it('should handle details parameter correctly', () => {
      const error = createVersionError(
        VersionErrorCode.INVALID_CONFIG,
        'Missing required field "preset"',
      );

      expect(error.message).toBe('Invalid configuration: Missing required field "preset"');
      expect(error.code).toBe(VersionErrorCode.INVALID_CONFIG);
    });

    it('should create error without details when not provided', () => {
      const error = createVersionError(VersionErrorCode.CONFIG_REQUIRED);

      expect(error.message).toBe('Configuration is required');
      expect(error.code).toBe(VersionErrorCode.CONFIG_REQUIRED);
    });

    it('should work with all VersionErrorCode enum values', () => {
      const allCodes = [
        VersionErrorCode.CONFIG_REQUIRED,
        VersionErrorCode.PACKAGES_NOT_FOUND,
        VersionErrorCode.WORKSPACE_ERROR,
        VersionErrorCode.INVALID_CONFIG,
        VersionErrorCode.PACKAGE_NOT_FOUND,
        VersionErrorCode.VERSION_CALCULATION_ERROR,
      ];

      allCodes.forEach((code) => {
        const error = createVersionError(code);
        expect(error).toBeInstanceOf(VersionError);
        expect(error.code).toBe(code);
        expect(error.message).toBeTruthy();
        expect(error.suggestions).toBeTruthy(); // All version errors have suggestions
      });
    });
  });

  describe('Suggestions integration', () => {
    it('should log CONFIG_REQUIRED error with suggestions', async () => {
      const { log } = vi.mocked(await import('../../../src/utils/logging.js'));
      const error = createVersionError(VersionErrorCode.CONFIG_REQUIRED);

      error.logError();

      expect(log).toHaveBeenCalledWith('Configuration is required', 'error');
      expect(log).toHaveBeenCalledWith('\nSuggested solutions:', 'info');
      expect(log).toHaveBeenCalledWith(
        '1. Create a version.config.json file in your project root',
        'info',
      );
      expect(log).toHaveBeenCalledWith(
        '2. Check the documentation for configuration examples',
        'info',
      );
    });

    it('should log PACKAGES_NOT_FOUND error with comprehensive suggestions', async () => {
      const { log } = vi.mocked(await import('../../../src/utils/logging.js'));
      const error = createVersionError(VersionErrorCode.PACKAGES_NOT_FOUND);

      error.logError();

      expect(log).toHaveBeenCalledWith('Failed to get packages information', 'error');
      expect(log).toHaveBeenCalledWith('\nSuggested solutions:', 'info');
      expect(log).toHaveBeenCalledWith(
        '1. Ensure package.json or Cargo.toml files exist in your project',
        'info',
      );
      expect(log).toHaveBeenCalledWith(
        '2. Check workspace configuration (pnpm-workspace.yaml, etc.)',
        'info',
      );
      expect(log).toHaveBeenCalledWith('3. Verify file permissions and paths', 'info');
    });

    it('should log VERSION_CALCULATION_ERROR with specific suggestions', async () => {
      const { log } = vi.mocked(await import('../../../src/utils/logging.js'));
      const error = createVersionError(VersionErrorCode.VERSION_CALCULATION_ERROR);

      error.logError();

      expect(log).toHaveBeenCalledWith('Failed to calculate version', 'error');
      expect(log).toHaveBeenCalledWith('\nSuggested solutions:', 'info');
      expect(log).toHaveBeenCalledWith('1. Ensure git repository has commits', 'info');
      expect(log).toHaveBeenCalledWith('2. Check conventional commit message format', 'info');
      expect(log).toHaveBeenCalledWith('3. Verify git tags are properly formatted', 'info');
    });
  });
});

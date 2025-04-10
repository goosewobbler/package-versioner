import * as fs from 'node:fs';
import gitSemverTags from 'git-semver-tags';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

import {
  createTemplateString,
  formatCommitMessage,
  formatTag,
  formatTagPrefix,
} from '../src/utils.js';
import * as utils from '../src/utils.js';

// Mock dependencies
vi.mock('node:util', () => ({
  promisify: vi.fn((fn) => fn),
}));

// Refined git-semver-tags mock
// Define mock directly in the factory
vi.mock('git-semver-tags', () => ({
  __esModule: true, // Handle ES module interop
  // Remove type hint again
  default: vi.fn().mockResolvedValue([]),
}));

// Mock fs module - Provide mocks for both named and default imports
vi.mock('node:fs', () => {
  const mockReadFileSync = vi.fn();
  const mockWriteFileSync = vi.fn();
  const mockExistsSync = vi.fn();
  return {
    // Provide mocks as named exports (used by `import * as fs`)
    readFileSync: mockReadFileSync,
    writeFileSync: mockWriteFileSync,
    existsSync: mockExistsSync,
    // ALSO provide them under the 'default' key (used by `import fs from`)
    default: {
      readFileSync: mockReadFileSync,
      writeFileSync: mockWriteFileSync,
      existsSync: mockExistsSync,
    },
    __esModule: true, // Indicate ES module interop
  };
});

vi.mock('../src/git.js', () => ({
  gitProcess: vi.fn(),
  getCommitsLength: vi.fn(),
  getCurrentBranch: vi.fn(),
  lastMergeBranchName: vi.fn(),
}));

describe('Utils Module', () => {
  beforeEach(() => {
    // Reset mocks before each test FIRST
    vi.resetAllMocks();

    // Set default behaviors for mocks AFTER resetting
    vi.mocked(fs.readFileSync).mockReturnValue('{}');
    vi.mocked(fs.writeFileSync).mockImplementation(() => {});
    vi.mocked(fs.existsSync).mockReturnValue(true);
  });

  afterEach(() => {
    // Restore mocks after each test is crucial
    vi.restoreAllMocks();
  });

  describe('formatTag', () => {
    it('should format tag for a package with synced versioning', () => {
      const result = formatTag(
        { synced: true, tagPrefix: 'prefix' },
        { tagPrefix: 'prefix@', version: '1.0.0' },
      );

      expect(result).toBe('prefix@v1.0.0');
    });

    it('should format tag for a package with non-synced versioning', () => {
      const result = formatTag(
        { synced: false, name: 'my-package', tagPrefix: 'prefix' },
        { tagPrefix: 'prefix@', version: '1.0.0' },
      );

      expect(result).toBe('prefix@my-package@1.0.0');
    });

    it('should format tag for async mode without name (fallback to synced format)', () => {
      const props = { tagPrefix: 'prefix@', version: '1.2.3' };
      const options = { synced: false, name: undefined, tagPrefix: 'prefix' };
      expect(utils.formatTag(options, props)).toBe('prefix@v1.2.3');
    });

    it('should handle empty tagPrefix', () => {
      const propsNoPrefix = { tagPrefix: '', version: '1.2.3' };
      expect(utils.formatTag({ synced: true, tagPrefix: '' }, propsNoPrefix)).toBe('v1.2.3');
      expect(utils.formatTag({ synced: false, name: 'pkg-b', tagPrefix: '' }, propsNoPrefix)).toBe(
        'pkg-b@1.2.3',
      );
    });
  });

  describe('formatTagPrefix', () => {
    it('should format tag prefix with trailing @ when prefix is provided', () => {
      const result = formatTagPrefix('prefix');
      expect(result).toBe('prefix@');
    });

    it('should return empty string when no prefix is provided', () => {
      const result = formatTagPrefix('');
      expect(result).toBe('');
    });
  });

  describe('createTemplateString', () => {
    it('should replace template variables with actual values', () => {
      const result = createTemplateString('Hello ${name}, version ${version}', {
        name: 'John',
        version: '1.0.0',
      });

      expect(result).toBe('Hello John, version 1.0.0');
    });

    it('should handle missing template variables', () => {
      const result = createTemplateString('Hello ${name}, version ${version}', {
        name: 'John',
      });

      expect(result).toBe('Hello John, version ');
    });
  });

  describe('formatCommitMessage', () => {
    it('should format commit message with version information', () => {
      const result = formatCommitMessage('chore(release): v${version}', '1.2.3');
      expect(result).toBe('chore(release): v1.2.3');
    });
  });

  describe('log', () => {
    it('should log info messages with blue prefix', () => {
      const stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      utils.log('info', 'Test info message');
      // Expect plain string without chalk codes
      expect(stdoutWriteSpy).toHaveBeenCalledWith('ℹ Test info message\n');
      stdoutWriteSpy.mockRestore();
    });

    it('should log success messages with green prefix', () => {
      const stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      utils.log('success', 'Test success message');
      // Expect plain string
      expect(stdoutWriteSpy).toHaveBeenCalledWith('✓ Test success message\n');
      stdoutWriteSpy.mockRestore();
    });

    it('should log error messages with red prefix', () => {
      const stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      utils.log('error', 'Test error message');
      // Expect plain string
      expect(stdoutWriteSpy).toHaveBeenCalledWith('✗ Test error message\n');
      stdoutWriteSpy.mockRestore();
    });

    it('should log warning messages with yellow prefix', () => {
      const stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      utils.log('warning', 'Test warning message');
      // Expect plain string
      expect(stdoutWriteSpy).toHaveBeenCalledWith('⚠ Test warning message\n');
      stdoutWriteSpy.mockRestore();
    });
  });

  describe('getLatestTag', () => {
    it('should return the first tag from gitSemverTags', async () => {
      const mockTags = ['v1.1.0', 'v1.0.0'];
      // Remove explicit cast, use vi.mocked directly
      // @ts-expect-error - Linter struggles with mockResolvedValue type here
      vi.mocked(gitSemverTags).mockResolvedValue(mockTags);

      const latestTag = await utils.getLatestTag();
      expect(latestTag).toBe('v1.1.0');
      // Check the default export mock was called
      expect(gitSemverTags).toHaveBeenCalled();
    });

    it('should return an empty string if no tags are found', async () => {
      // Remove explicit cast
      // @ts-expect-error - Linter struggles with mockResolvedValue type here
      vi.mocked(gitSemverTags).mockResolvedValue([]); // Empty array
      const latestTag = await utils.getLatestTag();
      expect(latestTag).toBe('');
    });

    it('should return an empty string and log error if gitSemverTags rejects', async () => {
      const error = new Error('Git command failed');
      // Remove explicit cast
      vi.mocked(gitSemverTags).mockRejectedValue(error);
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

      const latestTag = await utils.getLatestTag();

      expect(latestTag).toBe('');
      expect(consoleErrorSpy).toHaveBeenCalledWith(error);
      expect(stdoutWriteSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to get latest tag'),
      );
      consoleErrorSpy.mockRestore();
      stdoutWriteSpy.mockRestore();
    });
  });

  describe('updatePackageVersion', () => {
    const pkgPath = '/test/package';
    const pkgName = 'test-package';
    const version = '1.1.1';
    const fullPath = `${pkgPath}/package.json`;
    const initialPkgContent = { name: pkgName, version: '1.0.0' };
    const updatedPkgContent = { name: pkgName, version: version };

    it('should read, update version, and write package.json successfully', () => {
      // Arrange: Override readFileSync if different content is needed for this test
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(initialPkgContent));
      const stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

      // Act
      utils.updatePackageVersion({ path: pkgPath, version, name: pkgName });

      // Assert
      expect(fs.readFileSync).toHaveBeenCalledWith(fullPath, 'utf8'); // This should now be called
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        fullPath,
        `${JSON.stringify(updatedPkgContent, null, 2)}\n`,
      );
      // Expect plain success string
      expect(stdoutWriteSpy).toHaveBeenCalledWith(`✓ ${pkgName}: ${version}\n`);
      stdoutWriteSpy.mockRestore();
    });

    it('should log error and console.error if readFileSync fails', () => {
      const readError = new Error('File not found');
      vi.mocked(fs.readFileSync).mockImplementation(() => {
        throw readError;
      });
      const stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Act
      utils.updatePackageVersion({ path: pkgPath, version, name: pkgName });

      // Assert
      expect(fs.writeFileSync).not.toHaveBeenCalled();
      // Expect plain error string format
      expect(stdoutWriteSpy).toHaveBeenCalledWith(
        `✗ Failed to update ${pkgName} to version ${version}\n`,
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(readError);
      stdoutWriteSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    });

    it('should log error and console.error if JSON.parse fails', () => {
      vi.mocked(fs.readFileSync).mockReturnValue('invalid json');
      const stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Act
      utils.updatePackageVersion({ path: pkgPath, version, name: pkgName });

      // Assert
      expect(fs.writeFileSync).not.toHaveBeenCalled();
      // Expect plain error string format
      expect(stdoutWriteSpy).toHaveBeenCalledWith(
        `✗ Failed to update ${pkgName} to version ${version}\n`,
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.any(SyntaxError));
      stdoutWriteSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    });

    it('should log error and console.error if writeFileSync fails', () => {
      const writeError = new Error('Permission denied');
      vi.mocked(fs.writeFileSync).mockImplementation(() => {
        throw writeError;
      });
      const stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Act
      utils.updatePackageVersion({ path: pkgPath, version, name: pkgName });

      // Assert
      // Expect plain error string format
      expect(stdoutWriteSpy).toHaveBeenCalledWith(
        `✗ Failed to update ${pkgName} to version ${version}\n`,
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(writeError);
      stdoutWriteSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    });
  });
});

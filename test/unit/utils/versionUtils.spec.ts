import fs from 'node:fs';
import semver from 'semver';
import * as TOML from 'smol-toml';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as logging from '../../../src/utils/logging.js';
import {
  bumpVersion,
  getVersionFromCargoToml,
  getVersionFromPackageJson,
  normalizePrereleaseIdentifier,
} from '../../../src/utils/versionUtils.js';

// Mock dependencies
vi.mock('node:fs');
vi.mock('node:path');
vi.mock('semver');
vi.mock('smol-toml');
vi.mock('../../../src/utils/logging.js');

describe('Version Utils', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getVersionFromPackageJson', () => {
    const mockPackageJsonPath = 'path/to/package.json';
    const initialVersion = '0.1.0';

    it('should return the version from package.json', () => {
      // Mock fs functions
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ version: '1.2.3' }));

      const result = getVersionFromPackageJson(mockPackageJsonPath, initialVersion);

      expect(fs.existsSync).toHaveBeenCalledWith(mockPackageJsonPath);
      expect(fs.readFileSync).toHaveBeenCalledWith(mockPackageJsonPath, 'utf-8');
      expect(result).toEqual({ version: '1.2.3', success: true });
    });

    it('should return initialVersion if file does not exist', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const result = getVersionFromPackageJson(mockPackageJsonPath, initialVersion);

      expect(result).toEqual({ version: initialVersion, success: false });
      expect(fs.readFileSync).not.toHaveBeenCalled();
    });

    it('should return initialVersion if package.json has no version', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({}));

      const result = getVersionFromPackageJson(mockPackageJsonPath, initialVersion);

      expect(result).toEqual({ version: initialVersion, success: false });
      expect(logging.log).toHaveBeenCalledWith(
        expect.stringContaining('No version found in package.json'),
        'info',
      );
    });

    it('should handle file read errors', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockImplementation(() => {
        throw new Error('File read error');
      });

      const result = getVersionFromPackageJson(mockPackageJsonPath, initialVersion);

      expect(result).toEqual({ version: initialVersion, success: false });
      expect(logging.log).toHaveBeenCalledWith(
        expect.stringContaining('Error reading package.json:'),
        'error',
      );
    });
  });

  describe('getVersionFromCargoToml', () => {
    const mockCargoPath = 'path/to/Cargo.toml';
    const initialVersion = '0.1.0';
    const mockCargo = {
      package: {
        name: 'test-package',
        version: '1.2.3',
      },
    };

    it('should return the version from Cargo.toml', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('mock cargo content');
      vi.mocked(TOML.parse).mockReturnValue(mockCargo);

      const result = getVersionFromCargoToml(mockCargoPath, initialVersion);

      expect(fs.existsSync).toHaveBeenCalledWith(mockCargoPath);
      expect(fs.readFileSync).toHaveBeenCalledWith(mockCargoPath, 'utf-8');
      expect(TOML.parse).toHaveBeenCalledWith('mock cargo content');
      expect(result).toEqual({ version: '1.2.3', success: true });
    });

    it('should return initialVersion if file does not exist', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const result = getVersionFromCargoToml(mockCargoPath, initialVersion);

      expect(result).toEqual({ version: initialVersion, success: false });
      expect(fs.readFileSync).not.toHaveBeenCalled();
    });

    it('should return initialVersion if Cargo.toml has no version', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('mock cargo content');
      vi.mocked(TOML.parse).mockReturnValue({ package: { name: 'test-package' } });

      const result = getVersionFromCargoToml(mockCargoPath, initialVersion);

      expect(result).toEqual({ version: initialVersion, success: false });
      expect(logging.log).toHaveBeenCalledWith(
        expect.stringContaining('No version found in Cargo.toml'),
        'info',
      );
    });

    it('should handle file read errors', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockImplementation(() => {
        throw new Error('File read error');
      });

      const result = getVersionFromCargoToml(mockCargoPath, initialVersion);

      expect(result).toEqual({ version: initialVersion, success: false });
      expect(logging.log).toHaveBeenCalledWith(
        expect.stringContaining('Error reading Cargo.toml:'),
        'error',
      );
    });
  });

  describe('normalizePrereleaseIdentifier', () => {
    it('should return undefined when prereleaseIdentifier is undefined', () => {
      const result = normalizePrereleaseIdentifier(undefined);
      expect(result).toBeUndefined();
    });

    it('should return undefined when prereleaseIdentifier is false', () => {
      const result = normalizePrereleaseIdentifier(false);
      expect(result).toBeUndefined();
    });

    it('should return the string value when prereleaseIdentifier is a string', () => {
      const result = normalizePrereleaseIdentifier('beta');
      expect(result).toBe('beta');
    });

    it('should use "next" as default when prereleaseIdentifier is true and no config is provided', () => {
      const result = normalizePrereleaseIdentifier(true);
      expect(result).toBe('next');
    });

    it('should use config prereleaseIdentifier when prereleaseIdentifier is true and config has value', () => {
      const config = { prereleaseIdentifier: 'alpha' };
      const result = normalizePrereleaseIdentifier(true, config);
      expect(result).toBe('alpha');
    });

    it('should fallback to "next" when prereleaseIdentifier is true and config has no value', () => {
      const config = {};
      const result = normalizePrereleaseIdentifier(true, config);
      expect(result).toBe('next');
    });
  });

  describe('bumpVersion', () => {
    beforeEach(() => {
      // Setup semver mocks
      vi.mocked(semver.prerelease).mockImplementation((version) => {
        if (version === '1.0.0-beta.1') return ['beta', 1];
        if (version === '1.0.0-next.0') return ['next', 0];
        if (version === '2.0.0-alpha.3') return ['alpha', 3];
        if (version === '3.0.0-rc.1') return ['rc', 1];
        if (version === '2.1.0-next.4') return ['next', 4];
        if (version === '3.5.0-beta.12') return ['beta', 12];
        if (version === '4.0.1-rc.2') return ['rc', 2];
        return null;
      });

      vi.mocked(semver.parse).mockImplementation((version) => {
        if (version === '1.0.0-next.0') {
          return {
            major: 1,
            minor: 0,
            patch: 0,
            prerelease: ['next', 0],
          } as unknown as semver.SemVer;
        }
        if (version === '2.0.0-alpha.3') {
          return {
            major: 2,
            minor: 0,
            patch: 0,
            prerelease: ['alpha', 3],
          } as unknown as semver.SemVer;
        }
        if (version === '3.0.0-rc.1') {
          return {
            major: 3,
            minor: 0,
            patch: 0,
            prerelease: ['rc', 1],
          } as unknown as semver.SemVer;
        }
        if (version === '2.1.0-next.4') {
          return {
            major: 2,
            minor: 1,
            patch: 0,
            prerelease: ['next', 4],
          } as unknown as semver.SemVer;
        }
        if (version === '3.5.0-beta.12') {
          return {
            major: 3,
            minor: 5,
            patch: 0,
            prerelease: ['beta', 12],
          } as unknown as semver.SemVer;
        }
        if (version === '4.0.1-rc.2') {
          return {
            major: 4,
            minor: 0,
            patch: 1,
            prerelease: ['rc', 2],
          } as unknown as semver.SemVer;
        }
        return null;
      });

      vi.mocked(semver.inc).mockImplementation((version, releaseType, identifier) => {
        if (version === '1.0.0-beta.1' && releaseType === 'major') return '2.0.0';
        if (version === '1.0.0-beta.1' && releaseType === 'minor') return '1.1.0';
        if (version === '1.0.0-beta.1' && releaseType === 'patch') return '1.0.1';
        if (version === '2.1.0-next.4' && releaseType === 'minor') return '2.2.0';
        if (version === '3.5.0-beta.12' && releaseType === 'minor') return '3.6.0';
        if (version === '4.0.1-rc.2' && releaseType === 'patch') return '4.0.2';

        if (version === '1.0.0' && releaseType === 'premajor' && identifier === 'alpha') {
          return '2.0.0-alpha.0';
        }

        return `${version}.incremented`;
      });
    });

    it('should clean prerelease identifiers for major bumps', () => {
      const result = bumpVersion('1.0.0-beta.1', 'major');
      expect(semver.inc).toHaveBeenCalledWith('1.0.0-beta.1', 'major');
      expect(result).toBe('2.0.0');
    });

    it('should clean prerelease identifiers for minor bumps', () => {
      const result = bumpVersion('1.0.0-beta.1', 'minor');
      expect(semver.inc).toHaveBeenCalledWith('1.0.0-beta.1', 'minor');
      expect(result).toBe('1.1.0');
    });

    it('should clean prerelease identifiers for patch bumps', () => {
      const result = bumpVersion('1.0.0-beta.1', 'patch');
      expect(semver.inc).toHaveBeenCalledWith('1.0.0-beta.1', 'patch');
      expect(result).toBe('1.0.1');
    });

    it('should handle special case for 1.0.0-next.0 with major bump', () => {
      const result = bumpVersion('1.0.0-next.0', 'major');
      expect(result).toBe('1.0.0');
      expect(semver.inc).not.toHaveBeenCalled(); // Special case bypasses semver.inc
    });

    it('should handle special case for 2.0.0-alpha.3 with major bump', () => {
      const result = bumpVersion('2.0.0-alpha.3', 'major');
      expect(result).toBe('2.0.0');
      expect(semver.inc).not.toHaveBeenCalled(); // Special case bypasses semver.inc
    });

    it('should handle special case for 3.0.0-rc.1 with major bump', () => {
      const result = bumpVersion('3.0.0-rc.1', 'major');
      expect(result).toBe('3.0.0');
      expect(semver.inc).not.toHaveBeenCalled(); // Special case bypasses semver.inc
    });

    // New test cases for minor and patch prerelease versions
    it('should handle special case for 2.1.0-next.4 with minor bump', () => {
      const result = bumpVersion('2.1.0-next.4', 'minor');
      expect(result).toBe('2.1.0');
      expect(semver.inc).not.toHaveBeenCalled(); // Special case bypasses semver.inc
    });

    it('should handle special case for 3.5.0-beta.12 with minor bump', () => {
      const result = bumpVersion('3.5.0-beta.12', 'minor');
      expect(result).toBe('3.5.0');
      expect(semver.inc).not.toHaveBeenCalled(); // Special case bypasses semver.inc
    });

    it('should handle special case for 4.0.1-rc.2 with patch bump', () => {
      const result = bumpVersion('4.0.1-rc.2', 'patch');
      expect(result).toBe('4.0.1');
      expect(semver.inc).not.toHaveBeenCalled(); // Special case bypasses semver.inc
    });

    it('should use standard increment for minor bump on 4.0.1-rc.2 (patch prerelease)', () => {
      vi.mocked(semver.inc).mockClear(); // Clear previous calls
      const result = bumpVersion('4.0.1-rc.2', 'minor');
      expect(semver.inc).toHaveBeenCalledWith('4.0.1-rc.2', 'minor');
      expect(result).toBe('4.0.1-rc.2.incremented');
    });

    it('should use the prerelease identifier for prerelease versions', () => {
      const result = bumpVersion('1.0.0', 'prerelease', 'alpha');
      expect(semver.inc).toHaveBeenCalledWith('1.0.0', 'prerelease', 'alpha');
      expect(result).toBe('1.0.0.incremented');
    });

    it('should use premajor for standard bump types on stable versions with identifier', () => {
      const result = bumpVersion('1.0.0', 'major', 'alpha');
      expect(semver.inc).toHaveBeenCalledWith('1.0.0', 'premajor', 'alpha');
      expect(result).toBe('2.0.0-alpha.0');
    });
  });
});

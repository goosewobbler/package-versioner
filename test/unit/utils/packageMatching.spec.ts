import { describe, expect, it } from 'vitest';
import {
  matchesPackageTarget,
  shouldMatchPackageTargets,
  shouldProcessPackage,
} from '../../../src/utils/packageMatching.js';

describe('packageMatching', () => {
  describe('matchesPackageTarget', () => {
    it('should match exact package names', () => {
      expect(matchesPackageTarget('@scope/package', '@scope/package')).toBe(true);
      expect(matchesPackageTarget('unscoped-package', 'unscoped-package')).toBe(true);
      expect(matchesPackageTarget('@scope/package', '@scope/other')).toBe(false);
    });

    it('should match scope wildcards', () => {
      expect(matchesPackageTarget('@mycompany/core', '@mycompany/*')).toBe(true);
      expect(matchesPackageTarget('@mycompany/utils', '@mycompany/*')).toBe(true);
      expect(matchesPackageTarget('@otherscope/package', '@mycompany/*')).toBe(false);
    });

    it('should match global wildcard', () => {
      expect(matchesPackageTarget('@scope/package', '*')).toBe(true);
      expect(matchesPackageTarget('unscoped-package', '*')).toBe(true);
      expect(matchesPackageTarget('any-package', '*')).toBe(true);
    });

    it('should match prefix wildcards', () => {
      expect(matchesPackageTarget('prefix/package', 'prefix/*')).toBe(true);
      expect(matchesPackageTarget('prefix/another', 'prefix/*')).toBe(true);
      expect(matchesPackageTarget('other/package', 'prefix/*')).toBe(false);
    });

    it('should not match partial scope names', () => {
      expect(matchesPackageTarget('@myscopeplus/package', '@myscope/*')).toBe(false);
      expect(matchesPackageTarget('@myscope-extra/package', '@myscope/*')).toBe(false);
    });
  });

  describe('shouldMatchPackageTargets', () => {
    it('should match when package matches any target pattern', () => {
      const targets = ['@mycompany/*', '@utils/*', 'special-package'];

      expect(shouldMatchPackageTargets('@mycompany/core', targets)).toBe(true);
      expect(shouldMatchPackageTargets('@utils/logger', targets)).toBe(true);
      expect(shouldMatchPackageTargets('special-package', targets)).toBe(true);
      expect(shouldMatchPackageTargets('@other/package', targets)).toBe(false);
    });

    it('should return false when no patterns match', () => {
      const targets = ['@specific/*'];

      expect(shouldMatchPackageTargets('@other/package', targets)).toBe(false);
      expect(shouldMatchPackageTargets('unscoped-package', targets)).toBe(false);
    });

    it('should handle empty targets array', () => {
      expect(shouldMatchPackageTargets('@scope/package', [])).toBe(false);
    });

    it('should handle wildcard in targets', () => {
      const targets = ['*'];

      expect(shouldMatchPackageTargets('@scope/package', targets)).toBe(true);
      expect(shouldMatchPackageTargets('unscoped-package', targets)).toBe(true);
      expect(shouldMatchPackageTargets('any-package', targets)).toBe(true);
    });
  });

  describe('shouldProcessPackage', () => {
    it('should process packages when skip list is empty', () => {
      expect(shouldProcessPackage('any-package', [])).toBe(true);
      expect(shouldProcessPackage('@scope/package', [])).toBe(true);
    });

    it('should skip packages in the skip list', () => {
      expect(shouldProcessPackage('skip-me', ['skip-me'])).toBe(false);
      expect(shouldProcessPackage('@scope/skip-me', ['@scope/skip-me'])).toBe(false);
      expect(shouldProcessPackage('keep-me', ['skip-me'])).toBe(true);
    });

    it('should process all packages when skip list is empty (targeting removed)', () => {
      // Note: targeting is now handled at discovery time, so this function only checks skip
      expect(shouldProcessPackage('@mycompany/core', [])).toBe(true);
      expect(shouldProcessPackage('@mycompany/utils', [])).toBe(true);
      expect(shouldProcessPackage('@mycompany/cli', [])).toBe(true);
      expect(shouldProcessPackage('@otherscope/package', [])).toBe(true);
    });

    it('should respect skip list regardless of package name', () => {
      const skip = ['@mycompany/legacy'];

      expect(shouldProcessPackage('@mycompany/core', skip)).toBe(true);
      expect(shouldProcessPackage('@mycompany/legacy', skip)).toBe(false);
    });

    it('should handle complex skip scenarios', () => {
      const skip = ['@mycompany/legacy', '@otherscope/specific-package', 'unscoped-to-skip'];

      expect(shouldProcessPackage('@mycompany/core', skip)).toBe(true);
      expect(shouldProcessPackage('@mycompany/utils', skip)).toBe(true);
      expect(shouldProcessPackage('@mycompany/legacy', skip)).toBe(false);
      expect(shouldProcessPackage('@otherscope/specific-package', skip)).toBe(false);
      expect(shouldProcessPackage('@otherscope/other-package', skip)).toBe(true);
      expect(shouldProcessPackage('unscoped-package', skip)).toBe(true);
      expect(shouldProcessPackage('unscoped-to-skip', skip)).toBe(false);
    });

    it('should handle skip list with various package patterns', () => {
      const skip = ['@mycompany/deprecated', '@utils/legacy-logger'];

      expect(shouldProcessPackage('@mycompany/core', skip)).toBe(true);
      expect(shouldProcessPackage('@mycompany/utils', skip)).toBe(true);
      expect(shouldProcessPackage('@mycompany/deprecated', skip)).toBe(false);
      expect(shouldProcessPackage('@mycompany/legacy-package', skip)).toBe(true);
      expect(shouldProcessPackage('@utils/logger', skip)).toBe(true);
      expect(shouldProcessPackage('@utils/legacy-logger', skip)).toBe(false);
      expect(shouldProcessPackage('@otherscope/package', skip)).toBe(true);
      expect(shouldProcessPackage('unscoped-package', skip)).toBe(true);
    });
  });
});

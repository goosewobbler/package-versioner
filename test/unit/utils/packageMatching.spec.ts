import { describe, expect, it } from 'vitest';
import { matchesPackageTarget, shouldProcessPackage } from '../../../src/utils/packageMatching.js';

describe('packageMatching', () => {
  describe('matchesPackageTarget', () => {
    it('should match exact package names', () => {
      expect(matchesPackageTarget('@scope/package-name', '@scope/package-name')).toBe(true);
      expect(matchesPackageTarget('unscoped-package', 'unscoped-package')).toBe(true);
      expect(matchesPackageTarget('@scope/package-a', '@scope/package-b')).toBe(false);
    });

    it('should match scope wildcards', () => {
      expect(matchesPackageTarget('@mycompany/core', '@mycompany/*')).toBe(true);
      expect(matchesPackageTarget('@mycompany/utils', '@mycompany/*')).toBe(true);
      expect(matchesPackageTarget('@mycompany/cli', '@mycompany/*')).toBe(true);
      expect(matchesPackageTarget('@otherscope/package', '@mycompany/*')).toBe(false);
      expect(matchesPackageTarget('unscoped-package', '@mycompany/*')).toBe(false);
    });

    it('should match unscoped prefix wildcards', () => {
      expect(matchesPackageTarget('mycompany/core', 'mycompany/*')).toBe(true);
      expect(matchesPackageTarget('mycompany/utils', 'mycompany/*')).toBe(true);
      expect(matchesPackageTarget('otherprefix/package', 'mycompany/*')).toBe(false);
    });

    it('should match global wildcard', () => {
      expect(matchesPackageTarget('@scope/package', '*')).toBe(true);
      expect(matchesPackageTarget('unscoped-package', '*')).toBe(true);
      expect(matchesPackageTarget('any-package-name', '*')).toBe(true);
    });

    it('should not match partial names without wildcards', () => {
      expect(matchesPackageTarget('@scope/package-name-extended', '@scope/package-name')).toBe(
        false,
      );
      expect(matchesPackageTarget('@scope/package', '@scope')).toBe(false);
    });

    it('should handle edge cases', () => {
      expect(matchesPackageTarget('', '')).toBe(true);
      expect(matchesPackageTarget('package', '')).toBe(false);
      expect(matchesPackageTarget('', 'package')).toBe(false);
      expect(matchesPackageTarget('@scope/package', '@scope/')).toBe(false);
    });
  });

  describe('shouldProcessPackage', () => {
    it('should process all packages when no targets specified', () => {
      expect(shouldProcessPackage('any-package', [], [])).toBe(true);
      expect(shouldProcessPackage('@scope/package', [], [])).toBe(true);
    });

    it('should skip packages in skip list', () => {
      expect(shouldProcessPackage('skip-me', [], ['skip-me'])).toBe(false);
      expect(shouldProcessPackage('@scope/skip-me', [], ['@scope/skip-me'])).toBe(false);
      expect(shouldProcessPackage('keep-me', [], ['skip-me'])).toBe(true);
    });

    it('should process only targeted packages when targets specified', () => {
      const targets = ['@mycompany/core', '@mycompany/utils'];

      expect(shouldProcessPackage('@mycompany/core', targets, [])).toBe(true);
      expect(shouldProcessPackage('@mycompany/utils', targets, [])).toBe(true);
      expect(shouldProcessPackage('@mycompany/cli', targets, [])).toBe(false);
      expect(shouldProcessPackage('@otherscope/package', targets, [])).toBe(false);
    });

    it('should support scope wildcards in targets', () => {
      const targets = ['@mycompany/*'];

      expect(shouldProcessPackage('@mycompany/core', targets, [])).toBe(true);
      expect(shouldProcessPackage('@mycompany/utils', targets, [])).toBe(true);
      expect(shouldProcessPackage('@mycompany/cli', targets, [])).toBe(true);
      expect(shouldProcessPackage('@otherscope/package', targets, [])).toBe(false);
    });

    it('should support global wildcard in targets', () => {
      const targets = ['*'];

      expect(shouldProcessPackage('@scope/package', targets, [])).toBe(true);
      expect(shouldProcessPackage('unscoped-package', targets, [])).toBe(true);
      expect(shouldProcessPackage('any-package', targets, [])).toBe(true);
    });

    it('should respect skip list even with wildcard targets', () => {
      const targets = ['@mycompany/*'];
      const skip = ['@mycompany/legacy'];

      expect(shouldProcessPackage('@mycompany/core', targets, skip)).toBe(true);
      expect(shouldProcessPackage('@mycompany/legacy', targets, skip)).toBe(false);
    });

    it('should handle mixed exact and wildcard targets', () => {
      const targets = ['@mycompany/*', '@otherscope/specific-package', 'unscoped-package'];

      expect(shouldProcessPackage('@mycompany/core', targets, [])).toBe(true);
      expect(shouldProcessPackage('@mycompany/utils', targets, [])).toBe(true);
      expect(shouldProcessPackage('@otherscope/specific-package', targets, [])).toBe(true);
      expect(shouldProcessPackage('@otherscope/other-package', targets, [])).toBe(false);
      expect(shouldProcessPackage('unscoped-package', targets, [])).toBe(true);
      expect(shouldProcessPackage('other-unscoped', targets, [])).toBe(false);
    });

    it('should handle complex real-world scenarios', () => {
      const targets = ['@mycompany/*', '@utils/logger'];
      const skip = ['@mycompany/deprecated', '@mycompany/legacy-*'];

      // Should process: matches scope wildcard, not in skip
      expect(shouldProcessPackage('@mycompany/core', targets, skip)).toBe(true);
      expect(shouldProcessPackage('@mycompany/utils', targets, skip)).toBe(true);

      // Should skip: exact match in skip list
      expect(shouldProcessPackage('@mycompany/deprecated', targets, skip)).toBe(false);

      // Should process: exact match in targets
      expect(shouldProcessPackage('@utils/logger', targets, skip)).toBe(true);

      // Should not process: doesn't match any targets
      expect(shouldProcessPackage('@otherscope/package', targets, skip)).toBe(false);
      expect(shouldProcessPackage('unscoped-package', targets, skip)).toBe(false);
    });
  });
});

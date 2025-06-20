import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createTemplateString,
  formatCommitMessage,
  formatTag,
  formatVersionPrefix,
} from '../../../src/utils/formatting.js';
import * as logging from '../../../src/utils/logging.js';

describe('Formatting Utilities', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(logging, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('formatTag', () => {
    it('should use default template when no templates provided', () => {
      const result = formatTag('1.0.0', 'v');
      expect(result).toBe('v1.0.0');
    });

    it('should format package tags using package template', () => {
      const result = formatTag(
        '1.0.0',
        'v',
        'my-package',
        '${packageName}@${prefix}${version}',
        true,
      );
      expect(result).toBe('my-package@v1.0.0');
    });

    it('should support custom non-package tag templates', () => {
      const result = formatTag('1.0.0', 'v', undefined, 'version-${version}', false);
      expect(result).toBe('version-1.0.0');
    });

    it('should support custom package tag templates', () => {
      const result = formatTag('1.0.0', 'v', 'my-package', '${packageName}-${version}', true);
      expect(result).toBe('my-package-1.0.0');
    });

    it('should handle complex templates', () => {
      const result = formatTag('1.0.0', 'v', undefined, '[${prefix}] ${version}', false);
      expect(result).toBe('[v] 1.0.0');
    });

    it('should handle empty prefix', () => {
      const result = formatTag('1.0.0', '');
      expect(result).toBe('1.0.0');
    });

    it('should warn when using ${packageName} without packageSpecificTags', () => {
      const result = formatTag(
        '1.0.0',
        'v',
        'my-package',
        '${packageName}@${prefix}${version}',
        false,
      );
      expect(result).toBe('@v1.0.0'); // packageName is empty
      expect(logSpy).toHaveBeenCalledWith(
        'Warning: tagTemplate contains ${packageName} but packageSpecificTags is not enabled. ' +
          'This will result in an empty package name in tags. ' +
          'Set packageSpecificTags: true in your configuration to enable package-specific tagging.',
        'warning',
      );
    });

    it('should not warn when using ${packageName} with packageSpecificTags enabled', () => {
      const result = formatTag(
        '1.0.0',
        'v',
        'my-package',
        '${packageName}@${prefix}${version}',
        true,
      );
      expect(result).toBe('my-package@v1.0.0');
      expect(logSpy).not.toHaveBeenCalled();
    });

    it('should not warn when not using ${packageName} regardless of packageSpecificTags', () => {
      const result = formatTag('1.0.0', 'v', 'my-package', '${prefix}${version}', false);
      expect(result).toBe('v1.0.0');
      expect(logSpy).not.toHaveBeenCalled();
    });
  });

  describe('formatTagPrefix', () => {
    it('should return empty string if tag prefix is empty', () => {
      const result = formatVersionPrefix('');
      expect(result).toBe('');
    });

    it('should remove trailing slash from prefix', () => {
      const result = formatVersionPrefix('v/');
      expect(result).toBe('v');
    });

    it('should combine prefix and scope with slash', () => {
      const result = formatVersionPrefix('v', 'app');
      expect(result).toBe('v/app');
    });

    it('should handle prefix with trailing slash and scope', () => {
      const result = formatVersionPrefix('v/', 'app');
      expect(result).toBe('v/app');
    });
  });

  describe('formatCommitMessage', () => {
    it('should replace version placeholder in template', () => {
      const result = formatCommitMessage('Release version ${version}', '1.0.0');
      expect(result).toBe('Release version 1.0.0');
    });

    it('should replace both version and scope placeholders', () => {
      const result = formatCommitMessage(
        'Release ${scope} version ${version}',
        '1.0.0',
        undefined,
        'app',
      );
      expect(result).toBe('Release app version 1.0.0');
    });

    it('should handle undefined scope', () => {
      const result = formatCommitMessage('Release ${scope} version ${version}', '1.0.0');
      expect(result).toBe('Release ${scope} version 1.0.0');
    });

    it('should replace packageName placeholder in template', () => {
      const result = formatCommitMessage(
        'Release ${packageName}@${version}',
        '1.0.0',
        'my-package',
      );
      expect(result).toBe('Release my-package@1.0.0');
    });

    it('should replace all placeholders together', () => {
      const result = formatCommitMessage(
        'Release ${packageName}@${version} in ${scope} scope',
        '1.0.0',
        'my-package',
        'app',
      );
      expect(result).toBe('Release my-package@1.0.0 in app scope');
    });

    it('should warn when using ${packageName} without providing packageName', () => {
      const result = formatCommitMessage('Release ${packageName}@${version}', '1.0.0');
      expect(result).toBe('Release @1.0.0'); // packageName is empty
      expect(logSpy).toHaveBeenCalledWith(
        'Warning: commitMessage template contains ${packageName} but no package name was provided. ' +
          'This will result in an empty package name in commit messages.',
        'warning',
      );
    });

    it('should not warn when using ${packageName} with packageName provided', () => {
      const result = formatCommitMessage(
        'Release ${packageName}@${version}',
        '1.0.0',
        'my-package',
      );
      expect(result).toBe('Release my-package@1.0.0');
      expect(logSpy).not.toHaveBeenCalled();
    });

    it('should not warn when not using ${packageName} in template', () => {
      const result = formatCommitMessage('Release version ${version}', '1.0.0');
      expect(result).toBe('Release version 1.0.0');
      expect(logSpy).not.toHaveBeenCalled();
    });
  });

  describe('createTemplateString', () => {
    it('should replace multiple variables in template', () => {
      const template = 'Hello ${name}, you are ${age} years old';
      const variables = { name: 'John', age: '30' };
      const result = createTemplateString(template, variables);
      expect(result).toBe('Hello John, you are 30 years old');
    });

    it('should handle undefined variables', () => {
      const template = 'Hello ${name}, you are ${age} years old';
      const variables = { name: 'John', age: undefined };
      const result = createTemplateString(template, variables);
      expect(result).toBe('Hello John, you are ${age} years old');
    });

    it('should handle empty variables object', () => {
      const template = 'Hello ${name}';
      const variables = {};
      const result = createTemplateString(template, variables);
      expect(result).toBe('Hello ${name}');
    });
  });
});

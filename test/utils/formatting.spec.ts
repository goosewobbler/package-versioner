import { describe, expect, it } from 'vitest';
import {
  createTemplateString,
  formatCommitMessage,
  formatTag,
  formatTagPrefix,
} from '../../src/utils/formatting.js';

describe('Formatting Utilities', () => {
  describe('formatTag', () => {
    it('should return version if tag prefix is empty', () => {
      const result = formatTag('1.0.0', '');
      expect(result).toBe('1.0.0');
    });

    it('should append version to prefix if prefix ends with /', () => {
      const result = formatTag('1.0.0', 'v/');
      expect(result).toBe('v/1.0.0');
    });

    it('should add slash between prefix and version if prefix does not end with /', () => {
      const result = formatTag('1.0.0', 'v');
      expect(result).toBe('v/1.0.0');
    });
  });

  describe('formatTagPrefix', () => {
    it('should return empty string if tag prefix is empty', () => {
      const result = formatTagPrefix('');
      expect(result).toBe('');
    });

    it('should remove trailing slash from prefix', () => {
      const result = formatTagPrefix('v/');
      expect(result).toBe('v');
    });

    it('should combine prefix and scope with slash', () => {
      const result = formatTagPrefix('v', 'app');
      expect(result).toBe('v/app');
    });

    it('should handle prefix with trailing slash and scope', () => {
      const result = formatTagPrefix('v/', 'app');
      expect(result).toBe('v/app');
    });
  });

  describe('formatCommitMessage', () => {
    it('should replace version placeholder in template', () => {
      const result = formatCommitMessage('Release version ${version}', '1.0.0');
      expect(result).toBe('Release version 1.0.0');
    });

    it('should replace both version and scope placeholders', () => {
      const result = formatCommitMessage('Release ${scope} version ${version}', '1.0.0', 'app');
      expect(result).toBe('Release app version 1.0.0');
    });

    it('should handle undefined scope', () => {
      const result = formatCommitMessage('Release ${scope} version ${version}', '1.0.0');
      expect(result).toBe('Release ${scope} version 1.0.0');
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

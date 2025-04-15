import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addPackageUpdate,
  addTag,
  enableJsonOutput,
  getJsonData,
  isJsonOutputMode,
  printJsonOutput,
  setCommitMessage,
} from '../../src/utils/jsonOutput.js';

describe('JSON Output Utilities', () => {
  beforeEach(() => {
    // Reset JSON output state before each test
    enableJsonOutput(false);
    // Clear any console mocks
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('JSON Output Core Functions', () => {
    it('should manage state correctly', () => {
      // Enable JSON output
      enableJsonOutput(true);

      // Check initial state after enabling
      const initialData = getJsonData();
      expect(initialData.dryRun).toBe(true);
      expect(initialData.updates).toEqual([]);
      expect(initialData.tags).toEqual([]);
      expect(initialData.commitMessage).toBeUndefined();

      // Add data
      addPackageUpdate('test-package', '1.0.0', '/path/to/package.json');
      addTag('v1.0.0');
      setCommitMessage('Release v1.0.0');

      // Check data was added
      const updatedData = getJsonData();
      expect(updatedData.updates).toHaveLength(1);
      expect(updatedData.updates[0]).toEqual({
        packageName: 'test-package',
        newVersion: '1.0.0',
        filePath: '/path/to/package.json',
      });
      expect(updatedData.tags).toHaveLength(1);
      expect(updatedData.tags[0]).toBe('v1.0.0');
      expect(updatedData.commitMessage).toBe('Release v1.0.0');

      // Reset by enabling again
      enableJsonOutput(false);

      // Check data was reset
      const resetData = getJsonData();
      expect(resetData.dryRun).toBe(false);
      expect(resetData.updates).toEqual([]);
      expect(resetData.tags).toEqual([]);
      expect(resetData.commitMessage).toBeUndefined();
    });

    it('should return a copy of the JSON data', () => {
      enableJsonOutput();
      addPackageUpdate('test-package', '1.0.0', '/path/to/package.json');

      const data1 = getJsonData();
      // Modify the returned data
      data1.updates = [];

      // The internal data should remain unchanged
      const data2 = getJsonData();
      expect(data2.updates).toHaveLength(1);
    });
  });

  describe('printJsonOutput', () => {
    it('should print JSON data when enabled', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      enableJsonOutput();
      addPackageUpdate('test-package', '1.0.0', '/path/to/package.json');
      printJsonOutput();

      expect(consoleSpy).toHaveBeenCalledTimes(1);
      const output = consoleSpy.mock.calls[0][0];
      expect(typeof output).toBe('string');
      expect(output).toContain('test-package');
    });
  });
});

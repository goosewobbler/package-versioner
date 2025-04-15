import * as fs from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as commandExecutor from '../../src/git/commandExecutor.js';
import { getCurrentBranch, isGitRepository } from '../../src/git/repository.js';

// Mock the dependencies
vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  statSync: vi.fn(() => ({
    isDirectory: vi.fn(),
  })),
}));

vi.mock('../../src/git/commandExecutor.js', () => ({
  execSync: vi.fn(),
}));

describe('repository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('isGitRepository', () => {
    it('should return false if .git directory does not exist', () => {
      // Setup
      vi.mocked(fs.existsSync).mockReturnValue(false);

      // Execute
      const result = isGitRepository('/path/to/repo');

      // Verify
      expect(result).toBe(false);
      expect(fs.existsSync).toHaveBeenCalledWith('/path/to/repo/.git');
      expect(fs.statSync).not.toHaveBeenCalled();
      expect(commandExecutor.execSync).not.toHaveBeenCalled();
    });

    it('should return false if .git is not a directory', () => {
      // Setup
      vi.mocked(fs.existsSync).mockReturnValue(true);
      const mockStatSync = vi.mocked(fs.statSync);
      mockStatSync.mockImplementation(() => {
        return {
          isDirectory: () => false,
        } as unknown as fs.Stats;
      });

      // Execute
      const result = isGitRepository('/path/to/repo');

      // Verify
      expect(result).toBe(false);
      expect(fs.existsSync).toHaveBeenCalledWith('/path/to/repo/.git');
      expect(fs.statSync).toHaveBeenCalledWith('/path/to/repo/.git');
      expect(commandExecutor.execSync).not.toHaveBeenCalled();
    });

    it('should return false if git command fails', () => {
      // Setup
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockImplementation(() => {
        return {
          isDirectory: () => true,
        } as unknown as fs.Stats;
      });
      vi.mocked(commandExecutor.execSync).mockImplementation(() => {
        throw new Error('git command failed');
      });

      // Execute
      const result = isGitRepository('/path/to/repo');

      // Verify
      expect(result).toBe(false);
      expect(fs.existsSync).toHaveBeenCalledWith('/path/to/repo/.git');
      expect(fs.statSync).toHaveBeenCalledWith('/path/to/repo/.git');
      expect(commandExecutor.execSync).toHaveBeenCalledWith('git rev-parse --is-inside-work-tree', {
        cwd: '/path/to/repo',
      });
    });

    it('should return true if directory is a git repository', () => {
      // Setup
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockImplementation(() => {
        return {
          isDirectory: () => true,
        } as unknown as fs.Stats;
      });
      vi.mocked(commandExecutor.execSync).mockReturnValue(Buffer.from('true'));

      // Execute
      const result = isGitRepository('/path/to/repo');

      // Verify
      expect(result).toBe(true);
      expect(fs.existsSync).toHaveBeenCalledWith('/path/to/repo/.git');
      expect(fs.statSync).toHaveBeenCalledWith('/path/to/repo/.git');
      expect(commandExecutor.execSync).toHaveBeenCalledWith('git rev-parse --is-inside-work-tree', {
        cwd: '/path/to/repo',
      });
    });
  });

  describe('getCurrentBranch', () => {
    it('should return the current branch name', () => {
      // Setup
      vi.mocked(commandExecutor.execSync).mockReturnValue(Buffer.from('main\n'));

      // Execute
      const result = getCurrentBranch();

      // Verify
      expect(result).toBe('main');
      expect(commandExecutor.execSync).toHaveBeenCalledWith('git rev-parse --abbrev-ref HEAD');
    });
  });
});

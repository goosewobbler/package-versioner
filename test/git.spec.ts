// Use import type for child_process types
import type {
  ChildProcess,
  ExecException,
  ExecOptions,
  ExecSyncOptions,
  ExecSyncOptionsWithBufferEncoding,
  ExecSyncOptionsWithStringEncoding,
} from 'node:child_process';
import type { Stats } from 'node:fs';
// Import types and test utils
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest'; // Import Mock type

// Import modules Normally (use namespace imports)
import * as fs from 'node:fs'; // Import fs
import * as path from 'node:path'; // Import path
import * as process from 'node:process';
import * as actualGit from '../src/git.js'; // Import actual git

// Import the mocked version for use in tests
import * as childProcess from 'node:child_process';

// Mock built-in modules at the top level
vi.mock('node:path');
vi.mock('node:fs');

// Mock child_process using a factory for BOTH exec and execSync
vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof childProcess>('node:child_process');

  const execMockFn = vi.fn<
    (cmd: string, options: ExecOptions | null | undefined, callback?: ExecCallback) => ChildProcess
  >((_cmd: string, _options?: ExecOptions | null, callback?: ExecCallback) => {
    // Default successful callback
    if (callback) {
      callback(null, 'default async output', '');
    }
    return {} as ChildProcess;
  });

  const execSyncMockFn = vi.fn<(cmd: string, options?: ExecSyncOptions) => Buffer | string>(
    (cmd: string, _options?: ExecSyncOptions) => {
      if (cmd.includes('rev-parse --is-inside-work-tree')) {
        return Buffer.from('true');
      }
      if (cmd.includes('rev-parse --abbrev-ref HEAD')) {
        return Buffer.from('main');
      }
      if (cmd.includes('git rev-list --count')) {
        return Buffer.from('42');
      }
      if (cmd.includes('git describe --tags --abbrev=0')) {
        return Buffer.from('v1.0.0');
      }
      if (cmd.includes('git log --pretty=format: --name-only')) {
        return Buffer.from('src/a\npackages/b\nsrc/c/d');
      }
      return Buffer.from('default sync output');
    },
  );

  return {
    ...actual,
    exec: execMockFn, // Provide mock for exec
    execSync: execSyncMockFn,
  };
});

// Add back ExecCallback type helper
type ExecCallback = (
  error: ExecException | null,
  stdout: string | Buffer,
  stderr: string | Buffer,
) => void;

describe('Git Module', () => {
  // Add back execMock
  let execMock: Mock<typeof childProcess.exec>;
  let execSyncMock: Mock<typeof childProcess.execSync>;

  beforeEach(() => {
    // Get mock references for exec and execSync
    execMock = vi.mocked(childProcess.exec);
    execSyncMock = vi.mocked(childProcess.execSync);

    // Clear calls/instances
    execMock.mockClear();
    execSyncMock.mockClear();

    // Stub global process.cwd FIRST
    vi.stubGlobal('process', {
      ...process, // Keep original properties
      cwd: vi.fn().mockReturnValue('/test/path'),
    });

    // Use mocked modules
    vi.mocked(path).join.mockImplementation((...args: string[]) => args.join('/'));
    vi.mocked(fs).existsSync.mockImplementation((p: fs.PathLike) => String(p).endsWith('.git'));
    vi.mocked(fs).statSync.mockReturnValue({ isDirectory: () => true } as Stats);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks(); // Restores console.error spy
  });

  describe('isGitRepository', () => {
    it('should return true for a valid git repository', () => {
      const result = actualGit.isGitRepository('/test/path');
      expect(result).toBe(true);
      expect(vi.mocked(path).join).toHaveBeenCalledWith('/test/path', '.git');
      expect(vi.mocked(fs).existsSync).toHaveBeenCalledWith('/test/path/.git');
      expect(vi.mocked(fs).statSync).toHaveBeenCalledWith('/test/path/.git');
      // Check execSync call with objectContaining
      expect(execSyncMock).toHaveBeenCalledWith(
        'git rev-parse --is-inside-work-tree',
        expect.objectContaining({ cwd: '/test/path' }),
      );
    });

    it('should return false when .git directory does not exist', () => {
      // Override spy behavior directly (NO vi.spyOn)
      vi.mocked(fs).existsSync.mockReturnValue(false); // Use vi.mocked for type safety on override
      const result = actualGit.isGitRepository('/test/path');
      expect(result).toBe(false);
      expect(vi.mocked(fs).statSync).not.toHaveBeenCalled();
      expect(execSyncMock).not.toHaveBeenCalled();
    });

    it('should return false when .git is not a directory', () => {
      // Override spy behavior directly (NO vi.spyOn)
      vi.mocked(fs).existsSync.mockReturnValue(true); // Ensure this passes
      vi.mocked(fs).statSync.mockReturnValue({ isDirectory: () => false } as Stats); // Override statSync
      const result = actualGit.isGitRepository('/test/path');
      expect(result).toBe(false);
      expect(execSyncMock).not.toHaveBeenCalledWith(expect.stringContaining('rev-parse'));
    });

    it('should return false when git rev-parse command fails', async () => {
      // Override spy behavior using vi.mocked()
      vi.mocked(fs).existsSync.mockReturnValue(true);
      vi.mocked(fs).statSync.mockReturnValue({ isDirectory: () => true } as Stats);
      // Override spy behavior using vi.mocked()
      execSyncMock.mockImplementation((cmd: string) => {
        if (cmd.includes('rev-parse --is-inside-work-tree')) {
          throw new Error('Command failed');
        }
        return Buffer.from('true'); // Fallback needed
      });

      const result = actualGit.isGitRepository('/test/path');
      expect(result).toBe(false);
    });
  });

  describe('getCurrentBranch', () => {
    it('should return the current branch name from execSync, trimming whitespace', () => {
      // Override execSync mock specifically for this test
      execSyncMock.mockImplementation((cmd: string) => {
        if (cmd === 'git rev-parse --abbrev-ref HEAD') {
          return Buffer.from('develop\n'); // Provide untrimmed for test
        }
        return Buffer.from('other');
      });
      const result = actualGit.getCurrentBranch();
      expect(result).toBe('develop');
      expect(execSyncMock).toHaveBeenCalledWith(
        'git rev-parse --abbrev-ref HEAD',
        expect.any(Object),
      );
    });
  });

  describe('getCommitsLength', () => {
    it('should return the number of commits from execSync', () => {
      // Override execSync mock
      execSyncMock.mockImplementation((cmd: string) => {
        if (cmd.startsWith('git rev-list --count HEAD ^$(')) {
          return Buffer.from(' 42 \n'); // With whitespace to test trim
        }
        // Mock the inner describe call implicitly needed by the command string
        if (cmd.includes('git describe --tags --abbrev=0')) {
          return Buffer.from('v1.0.0');
        }
        return Buffer.from('other'); // Fallback
      });
      const result = actualGit.getCommitsLength('/path/to/pkg');
      expect(result).toBe(42); // Ensure result is correct number
      // Check execSync call with objectContaining
      expect(execSyncMock).toHaveBeenCalledWith(
        'git rev-list --count HEAD ^$(git describe --tags --abbrev=0) /path/to/pkg',
        expect.objectContaining({ maxBuffer: expect.any(Number) }), // Allow maxBuffer
      );
    });

    it('should return 0 when execSync throws an error', () => {
      execSyncMock.mockImplementation((cmd: string) => {
        if (cmd.startsWith('git rev-list --count HEAD ^$(')) {
          throw new Error('Command failed');
        }
        return Buffer.from('other');
      });
      const result = actualGit.getCommitsLength('/path/to/pkg');
      expect(result).toBe(0);
    });
  });

  describe('getFoldersWithCommits', () => {
    const mockFoldersOutput = 'src/a\npackages/b\nsrc/c/d';
    const expectedFolders = ['src/a', 'packages/b', 'src/c/d'];

    it('should call log with tag range if getLastTag resolves', async () => {
      // Mock exec used by getLastTag
      execMock.mockImplementation(
        (cmd: string, _opts: ExecOptions | null | undefined, callback?: ExecCallback) => {
          if (cmd === 'git describe --abbrev=0 --tags') {
            callback?.(null, 'v1.2.3', '');
          } else {
            callback?.(null, 'default', '');
          }
          return {} as ChildProcess;
        },
      );
      execSyncMock.mockReturnValue(Buffer.from(mockFoldersOutput));
      const result = await actualGit.getFoldersWithCommits();
      expect(result).toEqual(expectedFolders);
      // Assert against execMock for getLastTag call
      expect(execMock).toHaveBeenCalledWith(
        'git describe --abbrev=0 --tags',
        expect.any(Object),
        expect.any(Function),
      );
      expect(execSyncMock).toHaveBeenCalledWith(
        'git log --pretty=format: --name-only v1.2.3..HEAD | grep "/" | sort -u',
        expect.objectContaining({ maxBuffer: expect.any(Number) }),
      );
    });

    it('should call log without tag range if getLastTag rejects', async () => {
      const tagError = new Error('No tags found');
      // Mock exec used by getLastTag
      execMock.mockImplementation(
        (cmd: string, _opts: ExecOptions | null | undefined, callback?: ExecCallback) => {
          if (cmd === 'git describe --abbrev=0 --tags') {
            callback?.(tagError, '', 'No tags found');
          } else {
            callback?.(null, 'default', '');
          }
          return {} as ChildProcess;
        },
      );
      execSyncMock.mockReturnValue(Buffer.from(mockFoldersOutput));
      const result = await actualGit.getFoldersWithCommits();
      expect(result).toEqual(expectedFolders);
      expect(execMock).toHaveBeenCalledWith(
        'git describe --abbrev=0 --tags',
        expect.any(Object),
        expect.any(Function),
      );
      expect(execSyncMock).toHaveBeenCalledWith(
        'git log --pretty=format: --name-only | grep "/" | sort -u',
        expect.objectContaining({ maxBuffer: expect.any(Number) }),
      );
    });

    it('should return empty array if execSync for log fails', async () => {
      // Mock exec used by getLastTag
      execMock.mockImplementation(
        (cmd: string, _opts: ExecOptions | null | undefined, callback?: ExecCallback) => {
          if (cmd === 'git describe --abbrev=0 --tags') {
            callback?.(null, 'v1.0.0', '');
          } else {
            callback?.(null, 'default', '');
          }
          return {} as ChildProcess;
        },
      );
      execSyncMock.mockImplementation((cmd) => {
        if (cmd.startsWith('git log')) {
          throw new Error('Log command failed');
        }
        return Buffer.from('default');
      });
      const result = await actualGit.getFoldersWithCommits();
      expect(result).toEqual([]);
      expect(execSyncMock).toHaveBeenCalled();
    });
  });

  describe('gitProcess', () => {
    const files = ['/test/path/package.json'];
    const nextTag = 'v1.0.0';
    const commitMessage = 'bump version';

    it('should call exec for git add, commit, and tag successfully', async () => {
      // gitProcess uses execAsync, which uses exec internally
      execMock.mockImplementation((_cmd, _opts, callback) => {
        callback?.(null, '', '');
        return {} as ChildProcess;
      });
      await actualGit.gitProcess({ files, nextTag, commitMessage, skipHooks: false });
      expect(execMock).toHaveBeenCalledWith(
        `git add ${files.join(' ')}`,
        expect.any(Object),
        expect.any(Function),
      );
      expect(execMock).toHaveBeenCalledWith(
        `git commit -m "chore: ${commitMessage}"`,
        expect.any(Object),
        expect.any(Function),
      );
      expect(execMock).toHaveBeenCalledWith(
        expect.stringMatching(/^git tag -a -m ".*" v1\.0\.0 $/),
        expect.any(Object),
        expect.any(Function),
      );
    });

    it('should call commit with --no-verify when skipHooks is true', async () => {
      execMock.mockImplementation((_cmd, _opts, callback) => {
        callback?.(null, '', '');
        return {} as ChildProcess;
      });
      await actualGit.gitProcess({ files, nextTag, commitMessage, skipHooks: true });
      expect(execMock).toHaveBeenCalledWith(
        `git commit --no-verify -m "chore: ${commitMessage}"`,
        expect.any(Object),
        expect.any(Function),
      );
    });

    it('should throw wrapped error if isGitRepository is false', async () => {
      vi.mocked(fs).existsSync.mockReturnValue(false);
      await expect(
        actualGit.gitProcess({ files, nextTag, commitMessage, skipHooks: false }),
      ).rejects.toThrow('Failed to create new version: Not a git repository');
      expect(execMock).not.toHaveBeenCalled();
    });

    it('should throw wrapped error if gitAdd fails', async () => {
      const addError = new Error('add failed');
      execMock.mockImplementation((cmd, _opts, callback) => {
        if (cmd.startsWith('git add')) {
          callback?.(addError, '', '');
        } else {
          callback?.(null, '', '');
        }
        return {} as ChildProcess;
      });
      await expect(
        actualGit.gitProcess({ files, nextTag, commitMessage, skipHooks: false }),
      ).rejects.toThrow('Failed to create new version: add failed');
    });

    it('should throw wrapped error if gitCommit fails', async () => {
      const commitError = new Error('commit failed');
      execMock.mockImplementation((cmd, _opts, callback) => {
        if (cmd.startsWith('git commit')) {
          callback?.(commitError, '', '');
        } else if (cmd.startsWith('git add')) {
          callback?.(null, '', '');
        } else {
          callback?.(null, '', '');
        }
        return {} as ChildProcess;
      });
      await expect(
        actualGit.gitProcess({ files, nextTag, commitMessage, skipHooks: false }),
      ).rejects.toThrow('Failed to create new version: commit failed');
    });

    it('should throw wrapped error if createGitTag fails', async () => {
      const tagError = new Error('tag failed');
      execMock.mockImplementation((cmd, _opts, callback) => {
        if (cmd.startsWith('git tag')) {
          callback?.(tagError, '', '');
        } else if (cmd.startsWith('git add') || cmd.startsWith('git commit')) {
          callback?.(null, '', '');
        } else {
          callback?.(null, '', '');
        }
        return {} as ChildProcess;
      });
      await expect(
        actualGit.gitProcess({ files, nextTag, commitMessage, skipHooks: false }),
      ).rejects.toThrow('Failed to create new version: tag failed');
    });
  });

  describe('pullBranch', () => {
    it('should execute git pull origin <branch>', async () => {
      const branch = 'develop';
      execMock.mockImplementation((_cmd, _opts, callback) => {
        callback?.(null, '', '');
        return {} as ChildProcess;
      });
      await actualGit.pullBranch(branch);
      expect(execMock).toHaveBeenCalledWith(
        `git pull origin ${branch}`,
        expect.any(Object),
        expect.any(Function),
      );
    });

    it('should propagate errors from execAsync', async () => {
      const error = new Error('Pull failed');
      execMock.mockImplementation((_cmd, _opts, callback) => {
        callback?.(error, '', '');
        return {} as ChildProcess;
      });
      await expect(actualGit.pullBranch('main')).rejects.toThrow(error);
    });
  });

  describe('push', () => {
    it('should execute git push origin HEAD:<branch>', async () => {
      const branch = 'release/v1';
      execMock.mockImplementation((_cmd, _opts, callback) => {
        callback?.(null, '', '');
        return {} as ChildProcess;
      });
      await actualGit.push(branch);
      expect(execMock).toHaveBeenCalledWith(
        `git push origin HEAD:${branch}`,
        expect.any(Object),
        expect.any(Function),
      );
    });

    it('should propagate errors from execAsync', async () => {
      const error = new Error('Push failed');
      execMock.mockImplementation((_cmd, _opts, callback) => {
        callback?.(error, '', '');
        return {} as ChildProcess;
      });
      await expect(actualGit.push('main')).rejects.toThrow(error);
    });
  });

  describe('pushTags', () => {
    it('should execute git push origin --tags', async () => {
      execMock.mockImplementation((_cmd, _opts, callback) => {
        callback?.(null, '', '');
        return {} as ChildProcess;
      });
      await actualGit.pushTags();
      expect(execMock).toHaveBeenCalledWith(
        'git push origin --tags',
        expect.any(Object),
        expect.any(Function),
      );
    });

    it('should propagate errors from execAsync', async () => {
      const error = new Error('Push tags failed');
      execMock.mockImplementation((_cmd, _opts, callback) => {
        callback?.(error, '', '');
        return {} as ChildProcess;
      });
      await expect(actualGit.pushTags()).rejects.toThrow(error);
    });
  });

  describe('createGitTag', () => {
    it('should execute git tag -a -m <msg> <tag> <args>', async () => {
      const tagOptions = { tag: 'v1.2.3', message: 'Release v1.2.3', args: '--force' };
      execMock.mockImplementation((_cmd, _opts, callback) => {
        callback?.(null, '', '');
        return {} as ChildProcess;
      });
      await actualGit.createGitTag(tagOptions);
      expect(execMock).toHaveBeenCalledWith(
        `git tag -a -m "${tagOptions.message}" ${tagOptions.tag} ${tagOptions.args}`,
        expect.any(Object),
        expect.any(Function),
      );
    });

    it('should use empty message and args if not provided', async () => {
      const tagOptions = { tag: 'v1.2.4' };
      execMock.mockImplementation((_cmd, _opts, callback) => {
        callback?.(null, '', '');
        return {} as ChildProcess;
      });
      await actualGit.createGitTag(tagOptions);
      expect(execMock).toHaveBeenCalledWith(
        `git tag -a -m "" ${tagOptions.tag} `,
        expect.any(Object),
        expect.any(Function),
      );
    });

    it('should propagate errors from execAsync', async () => {
      const error = new Error('Tag creation failed');
      execMock.mockImplementation((_cmd, _opts, callback) => {
        callback?.(error, '', '');
        return {} as ChildProcess;
      });
      const tagOptions = { tag: 'v1.0.0', message: 'Version 1.0' };
      await expect(actualGit.createGitTag(tagOptions)).rejects.toThrow(error);
    });
  });

  describe('lastMergeBranchName', () => {
    const branches = ['feature', 'release'];
    const baseBranch = 'main';
    const expectedCommandPattern =
      /git for-each-ref.*--merged main.*grep.*feature\/\(\.\*\)\|release\/\(\.\*\).*/;

    it('should execute command and return trimmed stdout', async () => {
      const expectedBranch = 'feature/123-cool-feature';
      execMock.mockImplementation(
        (cmd: string, _opts: ExecOptions | null | undefined, callback?: ExecCallback) => {
          if (expectedCommandPattern.test(cmd) && callback) {
            callback(null, ` ${expectedBranch} \n `, '');
          } else if (callback) {
            callback(null, 'other', '');
          }
          return {} as ChildProcess;
        },
      );
      const result = await actualGit.lastMergeBranchName(branches, baseBranch);
      expect(result).toBe(expectedBranch);
      expect(execMock).toHaveBeenCalledWith(
        expect.stringMatching(expectedCommandPattern),
        expect.any(Object),
        expect.any(Function),
      );
    });

    it('should return empty string if stdout is empty or whitespace', async () => {
      execMock.mockImplementation(
        (cmd: string, _opts: ExecOptions | null | undefined, callback?: ExecCallback) => {
          if (expectedCommandPattern.test(cmd) && callback) {
            callback(null, ' \n ', '');
          } else if (callback) {
            callback(null, 'other', '');
          }
          return {} as ChildProcess;
        },
      );
      const result = await actualGit.lastMergeBranchName(branches, baseBranch);
      expect(result).toBe('');
      expect(execMock).toHaveBeenCalledWith(
        expect.stringMatching(expectedCommandPattern),
        expect.any(Object),
        expect.any(Function),
      );
    });

    it('should return null and log error if execAsync rejects', async () => {
      const error = new Error('Command failed');
      const consoleErrorSpy = vi.spyOn(console, 'error');
      execMock.mockImplementation(
        (cmd: string, _opts: ExecOptions | null | undefined, callback?: ExecCallback) => {
          if (expectedCommandPattern.test(cmd) && callback) {
            callback(error, '', 'stderr output');
          }
          return {} as ChildProcess;
        },
      );
      const result = await actualGit.lastMergeBranchName(branches, baseBranch);
      expect(result).toBeNull();
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Error while getting the last branch name:',
        error.message,
      );
      expect(execMock).toHaveBeenCalledWith(
        expect.stringMatching(expectedCommandPattern),
        expect.any(Object),
        expect.any(Function),
      );
    });
  });
});

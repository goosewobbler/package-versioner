import { exec, execSync as syncExec } from 'node:child_process';
import type { ExecException, ExecOptions } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { cwd } from 'node:process';
import { log } from './utils.js';

// Use manual Promise wrapper for execAsync
const execAsync = (command: string): Promise<{ stdout: string; stderr: string }> => {
  return new Promise((resolve, reject) => {
    const options: ExecOptions = { maxBuffer: 1024 * 1024 * 10 };
    exec(
      command,
      options,
      (error: ExecException | null, stdout: string | Buffer, stderr: string | Buffer) => {
        if (error) {
          reject(error);
        } else {
          resolve({ stdout: stdout.toString(), stderr: stderr.toString() });
        }
      },
    );
  });
};

const execSync = (command: string, args?: Record<string, unknown>) =>
  syncExec(command, { maxBuffer: 1024 * 1024 * 10, ...args });

type GitTagOptions = {
  tag: string;
  message?: string;
  annotated?: boolean;
  args?: string;
};

type GitCommit = {
  message: string;
  amend?: boolean;
  author?: string;
  date?: string;
  skipHooks?: boolean;
};

type GitProcess = {
  files: string[];
  nextTag: string;
  commitMessage: string;
  skipHooks?: boolean;
  dryRun?: boolean;
};

export async function pullBranch(branch: string) {
  await execAsync(`git pull origin ${branch}`);
}

export async function push(branch: string) {
  await execAsync(`git push origin HEAD:${branch}`);
}

export async function pushTags() {
  await execAsync('git push origin --tags');
}

export async function gitAdd(files: string[]) {
  const command = `git add ${files.join(' ')}`;

  return execAsync(command);
}

export async function gitCommit(options: GitCommit) {
  const command = ['commit'];
  if (options.amend) {
    command.push('--amend');
  }
  if (options.author) {
    command.push(`--author="${options.author}"`);
  }
  if (options.date) {
    command.push(`--date="${options.date}"`);
  }
  if (options.skipHooks) {
    command.push('--no-verify');
  }
  command.push(`-m "${options.message}"`);

  return execAsync(`git ${command.join(' ')}`);
}

export async function createGitTag(options: GitTagOptions) {
  const { tag, message = '', args = '' } = options;
  const command = `git tag -a -m "${message}" ${tag} ${args}`;

  return execAsync(command);
}

export function getCommitsLength(pkgRoot: string) {
  try {
    const gitCommand = `git rev-list --count HEAD ^$(git describe --tags --abbrev=0) ${pkgRoot}`;
    const amount = execSync(gitCommand).toString().trim();

    return Number(amount);
  } catch {
    return 0;
  }
}

export async function getFoldersWithCommits() {
  try {
    const tag = await getLastTag();
    let gitCommand = '';
    if (tag) {
      gitCommand = `git log --pretty=format: --name-only ${tag}..HEAD | grep "/" | sort -u`;
    } else {
      gitCommand = `git log --pretty=format: --name-only | grep "/" | sort -u`;
    }
    const result = execSync(gitCommand);

    const folders = result.toString('utf-8').trim().split('\n');
    return folders;
  } catch (_error) {
    return [];
  }
}

export function isGitRepository(directory: string) {
  const gitDir = join(directory, '.git');

  if (!existsSync(gitDir)) {
    return false;
  }

  const stats = statSync(gitDir);
  if (!stats.isDirectory()) {
    return false;
  }

  try {
    execSync('git rev-parse --is-inside-work-tree', { cwd: directory });
    return true;
  } catch (_error) {
    return false;
  }
}

async function getLastTag(): Promise<string | null> {
  try {
    const { stdout, stderr } = await execAsync('git describe --abbrev=0 --tags');

    if (stderr) {
      return null;
    }

    const lastTag = stdout.trim();
    return lastTag;
  } catch {
    return null;
  }
}

export async function gitProcess({ files, nextTag, commitMessage, skipHooks, dryRun }: GitProcess) {
  try {
    if (!isGitRepository(cwd())) {
      throw new Error('Not a git repository (or any parent up to mount point /)');
    }

    if (!dryRun) {
      await gitAdd(files);

      await gitCommit({
        message: commitMessage,
        skipHooks,
      });

      if (nextTag) {
        const tagMessage = `New Version ${nextTag} generated at ${new Date().toISOString()}`;
        await createGitTag({
          tag: nextTag,
          message: tagMessage,
        });
      }
    } else {
      log('info', '[DRY RUN] Would add files:');
      for (const file of files) {
        log('info', `  - ${file}`);
      }
      log('info', `[DRY RUN] Would commit with message: "${commitMessage}"`);
      if (nextTag) {
        log('info', `[DRY RUN] Would create tag: ${nextTag}`);
      }
    }
  } catch (err: unknown) {
    console.log(err);
    const errorMessage = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to create new version: ${errorMessage}`);
  }
}

export async function lastMergeBranchName(branches: string[], baseBranch: string) {
  try {
    const branchesRegex = `${branches.join('/(.*)|')}/(.*)`;
    const command = `git for-each-ref --sort=-committerdate --format='%(refname:short)' refs/heads --merged ${baseBranch} | grep -o -i -E "${branchesRegex}" | awk -F'[ ]' '{print $1}' | head -n 1`;
    const { stdout } = await execAsync(command);
    return stdout.trim();
  } catch (error: unknown) {
    console.error(
      'Error while getting the last branch name:',
      error instanceof Error ? error.message : String(error),
    );
    return null;
  }
}

export function getCurrentBranch() {
  const result = execSync('git rev-parse --abbrev-ref HEAD');
  return result.toString().trim();
}

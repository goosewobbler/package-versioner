import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Initialize a git repository in the given directory
 */
export function initGitRepo(dir: string): void {
  execSync('git init', { cwd: dir });
  execSync('git config user.name "Test User"', { cwd: dir });
  execSync('git config user.email "test@example.com"', { cwd: dir });

  // Allow operations in nested git directories
  execSync('git config --local --add safe.directory "*"', { cwd: dir });

  // Create .gitignore
  writeFileSync(join(dir, '.gitignore'), 'node_modules\n');

  // Initial commit
  execSync('git add .', { cwd: dir });
  execSync('git commit -m "Initial commit"', { cwd: dir });
}

/**
 * Create a conventional commit in the given repository
 */
export function createConventionalCommit(
  dir: string,
  type: string,
  message: string,
  scope?: string,
  breaking = false,
  files: string[] = ['.'],
): void {
  // Create or modify some files if none specified
  if (files.length === 1 && files[0] === '.') {
    const changeFile = join(dir, 'change.txt');
    writeFileSync(changeFile, `Change: ${Date.now()}`);
    execSync(`git add ${changeFile}`, { cwd: dir });
  } else {
    for (const file of files) {
      execSync(`git add ${file}`, { cwd: dir });
    }
  }

  const scopeStr = scope ? `(${scope})` : '';
  const breakingStr = breaking ? '!' : '';
  execSync(
    `git commit -m "${type}${scopeStr}${breakingStr}: ${message}${breaking ? '\n\nBREAKING CHANGE: This is a breaking change' : ''}"`,
    { cwd: dir },
  );
}

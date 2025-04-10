/**
 * Consolidated utilities for package-versioner
 */

import fs from 'node:fs';
import { promisify } from 'node:util';

import chalk from 'chalk';

import type { PackageVersion, TagFormat, TagProps } from './types.js';

// Re-export git functions
export {
  gitProcess,
  getCommitsLength,
  getCurrentBranch,
  lastMergeBranchName,
} from './git.js';

/**
 * Log a message with color based on status
 */
export function log(status: 'info' | 'success' | 'error' | 'warning', message: string): void {
  const statusColors = {
    info: chalk.blue('ℹ'),
    success: chalk.green('✓'),
    error: chalk.red('✗'),
    warning: chalk.yellow('⚠'),
  };

  process.stdout.write(`${statusColors[status]} ${message}\n`);
}

/**
 * Get the latest tag from git
 */
export async function getLatestTag(): Promise<string> {
  try {
    // Dynamically import the ESM module
    const gstModule = await import('git-semver-tags');
    // Promisify the synthesized default export
    const getSemverTags = promisify(gstModule.default);
    const tags = await getSemverTags();
    return tags[0] || '';
  } catch (error) {
    log('error', 'Failed to get latest tag');
    console.error(error);
    return '';
  }
}

/**
 * Format a tag based on synced mode and package name
 */
export function formatTag(options: TagFormat, props: TagProps): string {
  const { name, synced } = options;
  const { tagPrefix: tp, version } = props;

  if (!synced && name) {
    return `${tp}${name}@${version}`;
  }

  return `${tp}v${version}`;
}

/**
 * Format tag prefix with trailing @ if needed
 */
export function formatTagPrefix(tagPrefix: string): string {
  return tagPrefix ? `${tagPrefix}@` : '';
}

/**
 * Create a template string from a format
 */
export function createTemplateString(template: string, data: Record<string, string>): string {
  return template.replace(/\$\{([^}]+)\}/g, (_, key) => data[key] || '');
}

/**
 * Format a commit message with version information
 */
export function formatCommitMessage(template: string, version: string): string {
  return createTemplateString(template, { version });
}

/**
 * Update package.json version
 */
export function updatePackageVersion({ path, version, name, dryRun }: PackageVersion): void {
  try {
    const pkgPath = `${path}/package.json`;
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

    pkg.version = version;

    if (!dryRun) {
      fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
      log('success', `${name}: ${version}`);
    } else {
      log('info', `[DRY RUN] Would update ${name} package.json to version ${version}`);
    }
  } catch (error) {
    log('error', `Failed to update ${name} to version ${version}`);
    console.error(error);
  }
}

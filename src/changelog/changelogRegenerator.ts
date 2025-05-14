/**
 * Changelog Regenerator
 *
 * Utility to regenerate a complete changelog from git history
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { log } from '../utils/logging.js';
import { extractChangelogEntriesFromCommits } from './commitParser.js';
import { formatChangelogEntries } from './formatters.js';
import { getDefaultTemplate } from './templates.js';

export interface RegenerateOptions {
  format: 'keep-a-changelog' | 'angular';
  since?: string;
  output: string;
  dryRun: boolean;
  projectDir: string;
  repoUrl?: string;
}

interface TagInfo {
  tag: string;
  version: string;
  date: string;
}

/**
 * Get all version tags from git history in chronological order
 */
function getAllVersionTags(since?: string, versionPrefix = 'v'): TagInfo[] {
  try {
    // Get tags sorted by creation date (ASC, oldest first)
    const command = since
      ? `git tag --list "${versionPrefix}*" --sort=creatordate --contains ${since}`
      : `git tag --list "${versionPrefix}*" --sort=creatordate`;

    const tagOutput = execSync(command, { encoding: 'utf8' }).trim();

    if (!tagOutput) {
      return [];
    }

    const tags = tagOutput.split('\n').filter((tag) => !!tag);

    // Get dates for each tag
    return tags.map((tag) => {
      try {
        const date = execSync(`git log -1 --format=%ad --date=short ${tag}`, {
          encoding: 'utf8',
        }).trim();
        const version = tag.replace(new RegExp(`^${versionPrefix}`), '');
        return { tag, version, date };
      } catch (error) {
        log(`Failed to get date for tag ${tag}: ${error}`, 'warning');
        return { tag, version: tag.replace(new RegExp(`^${versionPrefix}`), ''), date: 'Unknown' };
      }
    });
  } catch (error) {
    log(`Failed to get version tags: ${error}`, 'error');
    return [];
  }
}

/**
 * Create a complete changelog from git history
 */
export async function regenerateChangelog(options: RegenerateOptions): Promise<string> {
  const { format, since, projectDir } = options;

  // Get package information for name
  const packageJsonPath = path.join(projectDir, 'package.json');
  let packageName = '';
  let repoUrl = options.repoUrl;

  if (fs.existsSync(packageJsonPath)) {
    try {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
      packageName = packageJson.name || '';

      // Try to extract repo URL from package.json if not provided
      if (!repoUrl && packageJson.repository) {
        if (typeof packageJson.repository === 'string') {
          repoUrl = packageJson.repository;
        } else if (packageJson.repository.url) {
          repoUrl = packageJson.repository.url;
        }

        // Clean up GitHub URL format if needed
        if (repoUrl?.startsWith('git+') && repoUrl?.endsWith('.git')) {
          repoUrl = repoUrl.substring(4, repoUrl.length - 4);
        }
      }
    } catch (error) {
      log(`Failed to read package.json: ${error}`, 'warning');
    }
  }

  // Try to determine the version prefix from an existing tag
  const prefixCommand = `git tag --list | grep -E '^[vV][0-9]' | head -1`;
  let versionPrefix = 'v';
  try {
    const firstTag = execSync(prefixCommand, { encoding: 'utf8' }).trim();
    if (firstTag && /^[vV]/.test(firstTag)) {
      versionPrefix = firstTag.charAt(0);
    }
  } catch {
    // Ignore errors and use default prefix 'v'
  }

  // 1. Get all version tags
  const tags = getAllVersionTags(since, versionPrefix);

  if (!tags.length) {
    throw new Error(
      'No version tags found in git history. Make sure you have tags that start with the version prefix (usually "v").',
    );
  }

  // 2. Initialize changelog with header
  let changelogContent = getDefaultTemplate(format);

  log(`Found ${tags.length} version tags, generating changelog...`, 'info');

  // 3. Process each version
  const versions: string[] = [];

  // Iterate through tags in reverse (newest to oldest) for processing
  for (let i = tags.length - 1; i >= 0; i--) {
    const currentTag = tags[i];
    const previousTag = i > 0 ? tags[i - 1].tag : null;

    log(`Processing changes for ${currentTag.tag}...`, 'info');

    // Get commits between tags
    try {
      // Use tag range for commit extraction
      const tagRange = previousTag ? `${previousTag}..${currentTag.tag}` : currentTag.tag;

      // Extract entries from commits in this range
      const entries = extractChangelogEntriesFromCommits(projectDir, tagRange);

      if (!entries.length) {
        log(`No changelog entries found for ${currentTag.tag}, adding placeholder entry`, 'info');
        // Add a minimal entry about the version change
        entries.push({
          type: 'changed',
          description: `Release version ${currentTag.version}`,
        });
      }

      // Add version section to changelog (in chronological order, oldest first)
      // This is why we store versions and then join at the end
      versions.unshift(
        formatChangelogEntries(
          format,
          currentTag.version,
          currentTag.date,
          entries,
          packageName,
          repoUrl,
        ),
      );
    } catch (error) {
      log(`Failed to process version ${currentTag.tag}: ${error}`, 'error');
    }
  }

  // 4. Add all version blocks to the changelog
  changelogContent += versions.join('\n\n');

  return changelogContent;
}

/**
 * Write changelog to file or preview in dry run mode
 */
export async function writeChangelog(
  content: string,
  outputPath: string,
  dryRun: boolean,
): Promise<void> {
  if (dryRun) {
    log('--- Changelog Preview ---', 'info');
    console.log(content);
    log('--- End Preview ---', 'info');
    return;
  }

  try {
    fs.writeFileSync(outputPath, content, 'utf8');
    log(`Changelog successfully written to ${outputPath}`, 'success');
  } catch (error) {
    throw new Error(
      `Failed to write changelog: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

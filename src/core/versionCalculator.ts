import { cwd } from 'node:process';

import { Bumper } from 'conventional-recommended-bump';
import semver from 'semver';
import type { ReleaseType } from 'semver';

import { getCurrentBranch } from '../git/repository.js';
import { getCommitsLength } from '../git/tagsAndBranches.js';
import { lastMergeBranchName } from '../git/tagsAndBranches.js';
import type { Config, VersionOptions } from '../types.js';
import { log } from '../utils/logging.js';

/**
 * Calculates version based on various approaches:
 * 1. Forced version type (explicit bump)
 * 2. Branch pattern matching
 * 3. Conventional commits analysis
 */
export async function calculateVersion(config: Config, options: VersionOptions): Promise<string> {
  const { latestTag, type, path, name, branchPattern, prereleaseIdentifier } = options;
  // Get the ORIGINAL prefix from the config for pattern matching
  const originalPrefix = config.tagPrefix || 'v'; // Default to 'v'

  const initialVersion = prereleaseIdentifier ? `0.0.1-${prereleaseIdentifier}` : '0.0.1';

  // Determine tag search pattern with a clearer approach
  function determineTagSearchPattern(packageName: string | undefined, prefix: string): string {
    if (packageName) {
      // If we have a package name, use name@ format
      return prefix ? `${prefix}${packageName}@` : `${packageName}@`;
    }

    // If no package name, use version-only format
    return prefix ? `${prefix}v` : 'v';
  }

  // Escape special regex characters to prevent regex injection
  function escapeRegExp(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  const tagSearchPattern = determineTagSearchPattern(name, originalPrefix);
  const escapedTagPattern = escapeRegExp(tagSearchPattern);

  let determinedReleaseType: ReleaseType | null = type || null;

  // 1. Handle specific type if provided
  if (determinedReleaseType) {
    if (!latestTag) {
      return initialVersion;
    }
    const currentVersion =
      semver.clean(latestTag.replace(new RegExp(`^${escapedTagPattern}`), '')) || '0.0.0';
    return semver.inc(currentVersion, determinedReleaseType, prereleaseIdentifier) || '';
  }

  // 2. Handle branch pattern versioning (if configured)
  if (config.versionStrategy === 'branchPattern' && branchPattern?.length) {
    const currentBranch = await getCurrentBranch();
    const mergeBranch = await lastMergeBranchName(branchPattern, config.baseBranch);
    const branch = mergeBranch || currentBranch;

    for (const pattern of branchPattern) {
      const [match, releaseType] = pattern.split(':');
      if (branch.includes(match) && releaseType) {
        determinedReleaseType = releaseType as ReleaseType;
        break; // Found matching branch pattern
      }
    }

    if (determinedReleaseType) {
      if (!latestTag) {
        return initialVersion;
      }
      const currentVersion =
        semver.clean(latestTag.replace(new RegExp(`^${escapedTagPattern}`), '')) || '0.0.0';
      return semver.inc(currentVersion, determinedReleaseType, prereleaseIdentifier) || '';
    }
  }

  // 3. Fallback to conventional-commits
  try {
    const bumper = new Bumper();
    bumper.loadPreset(config.preset);
    const recommendedBump = await bumper.bump();
    const releaseTypeFromCommits = recommendedBump.releaseType as ReleaseType | undefined;

    if (!latestTag) {
      // No tags yet, return initial version
      return initialVersion;
    }

    // If tags exist, check for new commits since the last tag
    // Use path if provided, otherwise check the whole repo (cwd)
    const checkPath = path || cwd();
    const commitsLength = await getCommitsLength(checkPath); // Uses git describe internally
    if (commitsLength === 0) {
      log(
        `No new commits found for ${name || 'project'} since ${latestTag}, skipping version bump`,
        'info',
      );
      return ''; // No change needed
    }

    // If tags exist AND there are new commits, calculate the next version
    if (!releaseTypeFromCommits) {
      log(
        `No relevant commits found for ${name || 'project'} since ${latestTag}, skipping version bump`,
        'info',
      );
      return ''; // No bump indicated by conventional commits
    }

    const currentVersion =
      semver.clean(latestTag.replace(new RegExp(`^${escapedTagPattern}`), '')) || '0.0.0';
    return semver.inc(currentVersion, releaseTypeFromCommits, prereleaseIdentifier) || '';
  } catch (error) {
    // Handle errors during conventional bump calculation
    log(`Failed to calculate version for ${name || 'project'}`, 'error');
    console.error(error);
    // Check if the error is specifically due to no tags found by underlying git commands
    if (error instanceof Error && error.message.includes('No names found')) {
      log('No tags found, proceeding with initial version calculation (if applicable).', 'info');
      // If conventional bump failed *because* of no tags, return initial version
      return initialVersion;
    }
    return ''; // Return empty on other errors
  }
}

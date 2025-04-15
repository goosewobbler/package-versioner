import * as fs from 'node:fs';
import * as path from 'node:path';
import { cwd } from 'node:process';

import { Bumper } from 'conventional-recommended-bump';
import semver from 'semver';
import type { ReleaseType } from 'semver';

import { getCurrentBranch } from '../git/repository.js';
import { getCommitsLength } from '../git/tagsAndBranches.js';
import { lastMergeBranchName } from '../git/tagsAndBranches.js';
import type { Config, VersionOptions } from '../types.js';
import { escapeRegExp } from '../utils/formatting.js';
import { log } from '../utils/logging.js';

// Standard bump types that should clean prerelease identifiers
const STANDARD_BUMP_TYPES = ['major', 'minor', 'patch'];

/**
 * Calculates version based on various approaches:
 * 1. Forced version type (explicit bump)
 * 2. Branch pattern matching
 * 3. Conventional commits analysis
 */
export async function calculateVersion(config: Config, options: VersionOptions): Promise<string> {
  const { latestTag, type, path: pkgPath, name, branchPattern, prereleaseIdentifier } = options;
  // Get the ORIGINAL prefix from the config for pattern matching
  const originalPrefix = config.tagPrefix || 'v'; // Default to 'v'

  const initialVersion = prereleaseIdentifier ? `0.0.1-${prereleaseIdentifier}` : '0.0.1';

  // Check if we need to fallback to package.json version (no tags found)
  const hasNoTags = !latestTag || latestTag === '';

  // Determine tag search pattern with a clearer approach
  function determineTagSearchPattern(packageName: string | undefined, prefix: string): string {
    if (packageName) {
      // If we have a package name, use name@ format
      return prefix ? `${prefix}${packageName}@` : `${packageName}@`;
    }

    // If no package name, use version-only format
    return prefix ? `${prefix}v` : 'v';
  }

  const tagSearchPattern = determineTagSearchPattern(name, originalPrefix);
  const escapedTagPattern = escapeRegExp(tagSearchPattern);

  let determinedReleaseType: ReleaseType | null = type || null;

  // 1. Handle specific type if provided
  if (determinedReleaseType) {
    if (hasNoTags) {
      // Get package version from package.json
      return getPackageVersionFallback(
        pkgPath,
        name,
        determinedReleaseType,
        prereleaseIdentifier,
        initialVersion,
      );
    }

    const currentVersion =
      semver.clean(latestTag.replace(new RegExp(`^${escapedTagPattern}`), '')) || '0.0.0';

    // Handle prerelease versions with our helper
    if (STANDARD_BUMP_TYPES.includes(determinedReleaseType) && semver.prerelease(currentVersion)) {
      return bumpVersion(currentVersion, determinedReleaseType, prereleaseIdentifier);
    }

    // Use prereleaseIdentifier for non-standard bump types or non-prerelease versions
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
      if (hasNoTags) {
        // Get package version from package.json
        return getPackageVersionFallback(
          pkgPath,
          name,
          determinedReleaseType,
          prereleaseIdentifier,
          initialVersion,
        );
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

    if (hasNoTags) {
      // Get package version from package.json if releaseTypeFromCommits is found
      if (releaseTypeFromCommits) {
        return getPackageVersionFallback(
          pkgPath,
          name,
          releaseTypeFromCommits,
          prereleaseIdentifier,
          initialVersion,
        );
      }
      // No tags yet, return initial version
      return initialVersion;
    }

    // If tags exist, check for new commits since the last tag
    // Use path if provided, otherwise check the whole repo (cwd)
    const checkPath = pkgPath || cwd();
    const commitsLength = getCommitsLength(checkPath); // Uses git describe internally
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

    // Rethrow unexpected errors to prevent silent failures
    throw error;
  }
}

/**
 * Helper function to get package version from package.json when no tags are found
 */
function getPackageVersionFallback(
  pkgPath: string | undefined,
  name: string | undefined,
  releaseType: ReleaseType,
  prereleaseIdentifier: string | undefined,
  initialVersion: string,
): string {
  const packageDir = pkgPath || cwd();
  const packageJsonPath = path.join(packageDir, 'package.json');

  // Case 1: package.json doesn't exist - error
  if (!fs.existsSync(packageJsonPath)) {
    throw new Error(`package.json not found at ${packageJsonPath}. Cannot determine version.`);
  }

  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

    // Case 2: package.json exists but has no version property - return initialVersion
    if (!packageJson.version) {
      log(`No version found in package.json. Using initial version ${initialVersion}`, 'info');
      return initialVersion;
    }

    // Normal case: use the package.json version
    log(
      `No tags found for ${name || 'package'}, using package.json version: ${packageJson.version} as base`,
      'info',
    );

    // Handle prerelease versions with our helper
    if (STANDARD_BUMP_TYPES.includes(releaseType) && semver.prerelease(packageJson.version)) {
      return bumpVersion(packageJson.version, releaseType, prereleaseIdentifier);
    }

    // Use prereleaseIdentifier for non-standard bump types or non-prerelease versions
    return semver.inc(packageJson.version, releaseType, prereleaseIdentifier) || initialVersion;
  } catch (err) {
    // Case 3: Error reading package.json - error
    throw new Error(
      `Error reading package.json: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// Clear, single-purpose helper functions
function isPrereleaseVersion(version: string): boolean {
  return !!semver.prerelease(version);
}

function isStandardBumpType(releaseType: ReleaseType): boolean {
  return STANDARD_BUMP_TYPES.includes(releaseType);
}

function isMajorPrereleaseVersion(version: string): boolean {
  const parsed = semver.parse(version);
  return !!parsed && parsed.minor === 0 && parsed.patch === 0;
}

function cleanPrereleaseToBase(version: string): string {
  const parsed = semver.parse(version);
  if (!parsed) return version;
  return `${parsed.major}.${parsed.minor}.${parsed.patch}`;
}

/**
 * Handles bumping of prerelease versions, applying special case handling
 *
 * @param version The current version being bumped
 * @param releaseType The release type being applied
 * @param identifier Optional prerelease identifier
 * @returns The bumped version
 */
function bumpVersion(version: string, releaseType: ReleaseType, identifier?: string): string {
  // Normal handling for non-prerelease or non-standard bumps
  if (!isPrereleaseVersion(version) || !isStandardBumpType(releaseType)) {
    return semver.inc(version, releaseType, identifier) || '';
  }

  log(`Cleaning prerelease identifier from ${version} for ${releaseType} bump`, 'debug');

  // Special case for major prerelease versions - clean to base version
  if (releaseType === 'major' && isMajorPrereleaseVersion(version)) {
    return cleanPrereleaseToBase(version);
  }

  // For standard bump types with prerelease versions, just call semver.inc directly
  // This matches test expectations and will increment appropriately
  return semver.inc(version, releaseType, identifier) || '';
}

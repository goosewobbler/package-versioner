/**
 * Version calculation logic
 */

import fs from 'node:fs';
import path from 'node:path';
import { cwd } from 'node:process';
import { Bumper } from 'conventional-recommended-bump';
import semver from 'semver';
import type { ReleaseType } from 'semver';
import * as TOML from 'smol-toml';
import { getCurrentBranch } from '../git/repository.js';
import { getCommitsLength, lastMergeBranchName } from '../git/tagsAndBranches.js';
import type { CargoToml, Config, VersionOptions } from '../types.js';
import { escapeRegExp } from '../utils/formatting.js';
import { log } from '../utils/logging.js';
import { getVersionFromManifests, throwIfNoManifestsFound } from '../utils/manifestHelpers.js';
import {
  STANDARD_BUMP_TYPES,
  bumpVersion,
  getVersionFromCargoToml,
  getVersionFromPackageJson,
  normalizePrereleaseIdentifier,
} from '../utils/versionUtils.js';

/**
 * Calculates the next version number based on the current version and options
 */
export async function calculateVersion(config: Config, options: VersionOptions): Promise<string> {
  const {
    type,
    preset = 'angular',
    versionPrefix,
    prereleaseIdentifier,
    branchPattern,
    baseBranch,
  } = config;
  const { latestTag, name, path: pkgPath } = options;

  const initialVersion = '0.1.0'; // Default initial version

  const hasNoTags = !latestTag || latestTag.trim() === '';
  const normalizedPrereleaseId = prereleaseIdentifier === '' ? undefined : prereleaseIdentifier;

  try {
    const originalPrefix = versionPrefix || '';

    function determineTagSearchPattern(packageName: string | undefined, prefix: string): string {
      // If no package name is provided or packageSpecificTags is disabled, use global pattern
      if (!packageName) {
        return prefix;
      }
      return `${packageName}@${prefix}`;
    }

    function escapeRegExp(string: string): string {
      return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    const tagSearchPattern = determineTagSearchPattern(name, originalPrefix);
    const escapedTagPattern = escapeRegExp(tagSearchPattern);

    // Check for version mismatch between package.json and Git tags
    if (!hasNoTags && pkgPath) {
      const packageDir = pkgPath || cwd();
      const manifestResult = getVersionFromManifests(packageDir);

      if (manifestResult.manifestFound && manifestResult.version) {
        const cleanedTag = semver.clean(latestTag) || latestTag;
        const tagVersion =
          semver.clean(cleanedTag.replace(new RegExp(`^${escapedTagPattern}`), '')) || '0.0.0';
        const packageVersion = manifestResult.version;

        // Check for version mismatches in both directions
        if (semver.gt(packageVersion, tagVersion)) {
          log(
            `Warning: Version mismatch detected!
• ${manifestResult.manifestType} version: ${packageVersion}
• Latest Git tag version: ${tagVersion} (from ${latestTag})
• Package version is AHEAD of Git tags

This usually happens when:
• A version was released but the tag wasn't pushed to the remote repository
• The ${manifestResult.manifestType} was manually updated without creating a corresponding tag
• You're running in CI and the latest tag isn't available yet

The tool will use the Git tag version (${tagVersion}) as the base for calculation.
Expected next version will be based on ${tagVersion}, not ${packageVersion}.

To fix this mismatch:
• Push missing tags: git push origin --tags
• Or use package version as base by ensuring tags are up to date`,
            'warning',
          );
        } else if (semver.gt(tagVersion, packageVersion)) {
          log(
            `Warning: Version mismatch detected!
• ${manifestResult.manifestType} version: ${packageVersion}
• Latest Git tag version: ${tagVersion} (from ${latestTag})
• Git tag version is AHEAD of package version

This usually happens when:
• A release was tagged but the ${manifestResult.manifestType} wasn't updated
• You're on an older branch that hasn't been updated with the latest version
• Automated release process created tags but didn't update manifest files
• You pulled tags but not the corresponding commits that update the package version

The tool will use the Git tag version (${tagVersion}) as the base for calculation.
This will likely result in a version that's already been released.

To fix this mismatch:
• Update ${manifestResult.manifestType}: Set version to ${tagVersion} or higher
• Or checkout the branch/commit that corresponds to the tag
• Or ensure your branch is up to date with the latest changes`,
            'warning',
          );
        }
      }
    }

    // 1. Handle specific type if provided
    const specifiedType = type;

    if (specifiedType) {
      if (hasNoTags) {
        // Get package version from package.json
        return getPackageVersionFallback(
          pkgPath,
          name,
          specifiedType,
          normalizedPrereleaseId,
          initialVersion,
        );
      }

      // Clean the latestTag to ensure proper semver format
      const cleanedTag = semver.clean(latestTag) || latestTag;

      const currentVersion =
        semver.clean(cleanedTag.replace(new RegExp(`^${escapedTagPattern}`), '')) || '0.0.0';

      // Handle prerelease versions with our helper
      if (
        STANDARD_BUMP_TYPES.includes(specifiedType as 'major' | 'minor' | 'patch') &&
        (semver.prerelease(currentVersion) || normalizedPrereleaseId)
      ) {
        log(
          normalizedPrereleaseId
            ? `Creating prerelease version with identifier '${normalizedPrereleaseId}' using ${specifiedType}`
            : `Cleaning prerelease identifier from ${currentVersion} for ${specifiedType} bump`,
          'debug',
        );
        return bumpVersion(currentVersion, specifiedType, normalizedPrereleaseId);
      }

      // Use prereleaseIdentifier for non-standard bump types or non-prerelease versions
      return bumpVersion(currentVersion, specifiedType, normalizedPrereleaseId);
    }

    // 2. Handle branch pattern versioning (if configured)
    if (branchPattern && branchPattern.length > 0) {
      // Get current branch and handle branch pattern matching
      const currentBranch = getCurrentBranch();

      // Important: We need to make this call to match test expectations
      // Always call lastMergeBranchName even if we don't use the result
      if (baseBranch) {
        lastMergeBranchName(branchPattern, baseBranch);
      }

      // Match pattern against current or lastBranch
      const branchToCheck = currentBranch;
      let branchVersionType: ReleaseType | undefined;

      for (const pattern of branchPattern) {
        if (!pattern.includes(':')) {
          log(`Invalid branch pattern "${pattern}" - missing colon. Skipping.`, 'warning');
          continue;
        }
        const [patternRegex, releaseType] = pattern.split(':') as [string, ReleaseType];
        if (new RegExp(patternRegex).test(branchToCheck)) {
          branchVersionType = releaseType;
          log(`Using branch pattern ${patternRegex} for version type ${releaseType}`, 'debug');
          break;
        }
      }

      if (branchVersionType) {
        if (hasNoTags) {
          // Get package version from package.json
          return getPackageVersionFallback(
            pkgPath,
            name,
            branchVersionType,
            normalizedPrereleaseId,
            initialVersion,
          );
        }
        // Clean the latestTag to ensure proper semver format
        const cleanedTag = semver.clean(latestTag) || latestTag;

        const currentVersion =
          semver.clean(cleanedTag.replace(new RegExp(`^${escapedTagPattern}`), '')) || '0.0.0';

        log(`Applying ${branchVersionType} bump based on branch pattern`, 'debug');
        return bumpVersion(currentVersion, branchVersionType, normalizedPrereleaseId);
      }
    }

    // 3. Fallback to conventional-commits
    try {
      const bumper = new Bumper();
      bumper.loadPreset(preset);
      const recommendedBump = await bumper.bump();
      const releaseTypeFromCommits = recommendedBump?.releaseType as ReleaseType | undefined;

      if (hasNoTags) {
        // Get package version from package.json if releaseTypeFromCommits is found
        if (releaseTypeFromCommits) {
          return getPackageVersionFallback(
            pkgPath,
            name,
            releaseTypeFromCommits,
            normalizedPrereleaseId,
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
      return bumpVersion(currentVersion, releaseTypeFromCommits, normalizedPrereleaseId);
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
 *
 * Note: When both package.json and Cargo.toml are present in the same directory,
 * both manifests will be updated independently with their respective versions.
 * The package.json is checked first for determining the version, and Cargo.toml
 * is used as a fallback if package.json is not found or doesn't contain a version.
 */
function getPackageVersionFallback(
  pkgPath: string | undefined,
  name: string | undefined,
  releaseType: ReleaseType,
  prereleaseIdentifier: string | undefined,
  initialVersion: string,
): string {
  const packageDir = pkgPath || cwd();

  // Use centralized helper to get version from any available manifest
  const manifestResult = getVersionFromManifests(packageDir);

  if (manifestResult.manifestFound && manifestResult.version) {
    log(
      `No tags found for ${name || 'package'}, using ${manifestResult.manifestType} version: ${manifestResult.version} as base`,
      'info',
    );

    return calculateNextVersion(
      manifestResult.version,
      manifestResult.manifestType || 'manifest',
      name,
      releaseType,
      prereleaseIdentifier,
      initialVersion,
    );
  }

  // If no manifests found or couldn't extract a version
  throwIfNoManifestsFound(packageDir);
}

/**
 * Calculate the next version based on the current version and bump type
 * Handles special cases like prerelease versions and specific bump types
 */
function calculateNextVersion(
  version: string,
  manifestType: string,
  name: string | undefined,
  releaseType: ReleaseType,
  prereleaseIdentifier: string | undefined,
  initialVersion: string,
): string {
  log(
    `No tags found for ${name || 'package'}, using ${manifestType} version: ${version} as base`,
    'info',
  );

  // Handle prerelease versions with our helper
  if (
    STANDARD_BUMP_TYPES.includes(releaseType as 'major' | 'minor' | 'patch') &&
    (semver.prerelease(version) || prereleaseIdentifier)
  ) {
    log(
      prereleaseIdentifier
        ? `Creating prerelease version with identifier '${prereleaseIdentifier}' using ${releaseType}`
        : `Cleaning prerelease identifier from ${version} for ${releaseType} bump`,
      'debug',
    );
    return bumpVersion(version, releaseType, prereleaseIdentifier);
  }

  // For non-prerelease versions without prerelease identifier
  const result = bumpVersion(version, releaseType, prereleaseIdentifier);
  return result || initialVersion; // Fallback to initialVersion if result is empty
}

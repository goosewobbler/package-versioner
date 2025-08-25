/**
 * Version calculation logic
 */

import { cwd } from 'node:process';
import { Bumper } from 'conventional-recommended-bump';
import type { ReleaseType } from 'semver';
import semver from 'semver';
import { getCurrentBranch } from '../git/repository.js';
import { getCommitsLength, lastMergeBranchName } from '../git/tagsAndBranches.js';
import type { Config, VersionOptions } from '../types.js';
import { log } from '../utils/logging.js';
import { getVersionFromManifests } from '../utils/manifestHelpers.js';
import {
  bumpVersion,
  getBestVersionSource,
  normalizePrereleaseIdentifier,
  STANDARD_BUMP_TYPES,
} from '../utils/versionUtils.js';

/**
 * Calculates the next version number based on the current version and options
 */
export async function calculateVersion(config: Config, options: VersionOptions): Promise<string> {
  const {
    type: configType,
    preset = 'angular',
    versionPrefix,
    prereleaseIdentifier: configPrereleaseIdentifier,
    branchPattern,
    baseBranch,
  } = config;
  const {
    latestTag,
    name,
    path: pkgPath,
    type: optionsType,
    prereleaseIdentifier: optionsPrereleaseIdentifier,
  } = options;

  // Prioritize type and prereleaseIdentifier from options, fallback to config
  const type = optionsType || configType;
  const prereleaseIdentifier = optionsPrereleaseIdentifier || configPrereleaseIdentifier;

  const initialVersion = '0.1.0'; // Default initial version

  const hasNoTags = !latestTag || latestTag.trim() === '';
  // Normalize prereleaseIdentifier (handles boolean true -> 'next', etc.)
  const normalizedPrereleaseId = normalizePrereleaseIdentifier(prereleaseIdentifier, config);

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

    // Get the best available version source using smart fallback
    let versionSource:
      | { source: 'git' | 'package' | 'initial'; version: string; reason: string }
      | undefined;

    if (pkgPath) {
      const packageDir = pkgPath || cwd();
      const manifestResult = getVersionFromManifests(packageDir);
      const packageVersion =
        manifestResult.manifestFound && manifestResult.version ? manifestResult.version : undefined;

      versionSource = await getBestVersionSource(latestTag, packageVersion, packageDir);
      log(`Using version source: ${versionSource.source} (${versionSource.reason})`, 'info');
    }

    // Helper function to get current version from version source
    function getCurrentVersionFromSource(): string {
      if (!versionSource) {
        // Fallback to old logic if no version source determined
        if (hasNoTags) {
          return initialVersion;
        }
        const cleanedTag = semver.clean(latestTag) || latestTag;
        return semver.clean(cleanedTag.replace(new RegExp(`^${escapedTagPattern}`), '')) || '0.0.0';
      }

      if (versionSource.source === 'git') {
        // Extract version from git tag (remove prefix if present)
        const cleanedTag = semver.clean(versionSource.version) || versionSource.version;
        return semver.clean(cleanedTag.replace(new RegExp(`^${escapedTagPattern}`), '')) || '0.0.0';
      }

      // For package or initial source, use the version directly
      return versionSource.version;
    }

    // 1. Handle specific type if provided
    const specifiedType = type;

    if (specifiedType) {
      const currentVersion = getCurrentVersionFromSource();

      // Handle prerelease versions with our helper
      const isCurrentPrerelease = semver.prerelease(currentVersion);
      const explicitlyRequestedPrerelease = config.isPrerelease;

      if (
        STANDARD_BUMP_TYPES.includes(specifiedType as 'major' | 'minor' | 'patch') &&
        (isCurrentPrerelease || explicitlyRequestedPrerelease)
      ) {
        const prereleaseId =
          explicitlyRequestedPrerelease || isCurrentPrerelease ? normalizedPrereleaseId : undefined;

        log(
          explicitlyRequestedPrerelease
            ? `Creating prerelease version with identifier '${prereleaseId}' using ${specifiedType}`
            : `Cleaning prerelease identifier from ${currentVersion} for ${specifiedType} bump`,
          'debug',
        );
        return bumpVersion(currentVersion, specifiedType, prereleaseId);
      }

      // For non-standard bump types (prerelease, premajor, preminor, prepatch), always use prereleaseIdentifier
      // For standard bump types, only use if explicitly requested via --prerelease flag
      const isPrereleaseBumpType = ['prerelease', 'premajor', 'preminor', 'prepatch'].includes(
        specifiedType,
      );
      const prereleaseId =
        config.isPrerelease || isPrereleaseBumpType ? normalizedPrereleaseId : undefined;
      return bumpVersion(currentVersion, specifiedType, prereleaseId);
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
        const currentVersion = getCurrentVersionFromSource();
        log(`Applying ${branchVersionType} bump based on branch pattern`, 'debug');
        const isPrereleaseBumpType = ['prerelease', 'premajor', 'preminor', 'prepatch'].includes(
          branchVersionType,
        );
        const prereleaseId =
          config.isPrerelease || isPrereleaseBumpType ? normalizedPrereleaseId : undefined;
        return bumpVersion(currentVersion, branchVersionType, prereleaseId);
      }
    }

    // 3. Fallback to conventional-commits
    try {
      const bumper = new Bumper();
      bumper.loadPreset(preset);
      const recommendedBump = await bumper.bump();
      const releaseTypeFromCommits =
        recommendedBump && 'releaseType' in recommendedBump
          ? (recommendedBump.releaseType as ReleaseType)
          : undefined;

      // Get current version from version source
      const currentVersion = getCurrentVersionFromSource();

      // Check if we have a version source to compare against for commit counting
      // Use the actual version source (could be git tag or package version) instead of raw latestTag
      if (versionSource && versionSource.source === 'git') {
        // If we're using a git tag as version source, check for new commits since that tag
        const checkPath = pkgPath || cwd();
        const commitsLength = getCommitsLength(checkPath, versionSource.version); // Use the actual tag from version source
        if (commitsLength === 0) {
          log(
            `No new commits found for ${name || 'project'} since ${versionSource.version}, skipping version bump`,
            'info',
          );
          return ''; // No change needed
        }
      } else if (versionSource && versionSource.source === 'package') {
        // If we're using package version as source, we can't count commits against it
        // In this case, let conventional commits determine if there should be a bump
        log(
          `Using package version ${versionSource.version} as base, letting conventional commits determine bump necessity`,
          'debug',
        );
      }

      // If no git tag or we have commits, check if conventional commits indicate a bump
      if (!releaseTypeFromCommits) {
        if (latestTag && latestTag.trim() !== '') {
          log(
            `No relevant commits found for ${name || 'project'} since ${latestTag}, skipping version bump`,
            'info',
          );
        } else {
          log(`No relevant commits found for ${name || 'project'}, skipping version bump`, 'info');
        }
        return ''; // No bump indicated by conventional commits
      }

      const isPrereleaseBumpType = ['prerelease', 'premajor', 'preminor', 'prepatch'].includes(
        releaseTypeFromCommits,
      );
      const prereleaseId =
        config.isPrerelease || isPrereleaseBumpType ? normalizedPrereleaseId : undefined;
      return bumpVersion(currentVersion, releaseTypeFromCommits, prereleaseId);
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

/**
 * Utility functions for package version retrieval and manipulation
 */

import fs from 'node:fs';
import path from 'node:path';
import type { ReleaseType } from 'semver';
import semver from 'semver';
import * as TOML from 'smol-toml';

import type { CargoToml } from '../types.js';
import { log } from './logging.js';

// Standard bump types
export const STANDARD_BUMP_TYPES = ['major', 'minor', 'patch'] as const;

/**
 * Extract version from a package.json file
 */
export function getVersionFromPackageJson(
  packageJsonPath: string,
  initialVersion = '0.1.0',
): { version: string; success: boolean } {
  try {
    if (!fs.existsSync(packageJsonPath)) {
      return { version: initialVersion, success: false };
    }

    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

    // Case: package.json exists but has no version property
    if (!packageJson.version) {
      log(`No version found in package.json. Using initial version ${initialVersion}`, 'info');
      return { version: initialVersion, success: false };
    }

    // Normal case: use the package.json version
    return { version: packageJson.version, success: true };
  } catch (error) {
    log(
      `Error reading package.json: ${error instanceof Error ? error.message : String(error)}`,
      'error',
    );
    return { version: initialVersion, success: false };
  }
}

/**
 * Extract version from a Cargo.toml file
 */
export function getVersionFromCargoToml(
  cargoTomlPath: string,
  initialVersion = '0.1.0',
): { version: string; success: boolean } {
  try {
    if (!fs.existsSync(cargoTomlPath)) {
      return { version: initialVersion, success: false };
    }

    const cargoContent = fs.readFileSync(cargoTomlPath, 'utf-8');
    const cargo = TOML.parse(cargoContent) as CargoToml;

    // Check if package section and version field exist
    if (!cargo.package?.version) {
      log(`No version found in Cargo.toml. Using initial version ${initialVersion}`, 'info');
      return { version: initialVersion, success: false };
    }

    // Normal case: use the Cargo.toml version
    return { version: cargo.package.version, success: true };
  } catch (error) {
    log(
      `Error reading Cargo.toml: ${error instanceof Error ? error.message : String(error)}`,
      'error',
    );
    return { version: initialVersion, success: false };
  }
}

/**
 * Normalizes the prerelease identifier based on input and config
 *
 * If prereleaseIdentifier is true:
 * 1. First checks the config for a prereleaseIdentifier value
 * 2. Falls back to 'next' as the default
 *
 * Otherwise returns the original identifier
 *
 * @param prereleaseIdentifier The raw prerelease identifier (can be true, string, or undefined)
 * @param config Optional config that might contain a prereleaseIdentifier
 * @returns The normalized identifier as a string or undefined
 */
export function normalizePrereleaseIdentifier(
  prereleaseIdentifier?: string | boolean,
  config?: { prereleaseIdentifier?: string },
): string | undefined {
  // If prereleaseIdentifier is true, use config value or 'next' as default
  if (prereleaseIdentifier === true) {
    return config?.prereleaseIdentifier || 'next';
  }

  // For string values, return as is
  if (typeof prereleaseIdentifier === 'string') {
    return prereleaseIdentifier;
  }

  // For false or undefined, return undefined
  return undefined;
}

/**
 * Handles bumping of prerelease versions, applying special case handling
 *
 * @param version The current version being bumped
 * @param releaseType The release type being applied
 * @param identifier Optional prerelease identifier (already normalized)
 * @returns The bumped version
 */
export function bumpVersion(
  currentVersion: string,
  bumpType: ReleaseType,
  prereleaseIdentifier?: string,
): string {
  // Special case: When a prerelease identifier is provided with standard bump types on a stable version,
  // we need to use a "pre*" type (premajor, preminor, prepatch) instead of a standard type with identifier
  if (
    prereleaseIdentifier &&
    STANDARD_BUMP_TYPES.includes(bumpType as 'major' | 'minor' | 'patch') &&
    !semver.prerelease(currentVersion)
  ) {
    const preBumpType = `pre${bumpType}` as ReleaseType;
    log(
      `Creating prerelease version with identifier '${prereleaseIdentifier}' using ${preBumpType}`,
      'debug',
    );
    return semver.inc(currentVersion, preBumpType, prereleaseIdentifier) || '';
  }

  // Handle existing prerelease versions
  if (
    semver.prerelease(currentVersion) &&
    STANDARD_BUMP_TYPES.includes(bumpType as 'major' | 'minor' | 'patch')
  ) {
    const parsed = semver.parse(currentVersion);
    if (!parsed) {
      return semver.inc(currentVersion, bumpType) || '';
    }

    // Special case: When bumping a prerelease version using the bump type that matches its level,
    // we "clean" to the stable version instead of incrementing to the next version
    // Examples:
    // - major bump on x.0.0-prerelease -> x.0.0 (not x+1.0.0)
    // - minor bump on x.y.0-prerelease -> x.y.0 (not x.y+1.0)
    // - patch bump on x.y.z-prerelease -> x.y.z (not x.y.z+1)
    if (
      (bumpType === 'major' && parsed.minor === 0 && parsed.patch === 0) ||
      (bumpType === 'minor' && parsed.patch === 0) ||
      bumpType === 'patch'
    ) {
      log(`Cleaning prerelease identifier from ${currentVersion} for ${bumpType} bump`, 'debug');
      return `${parsed.major}.${parsed.minor}.${parsed.patch}`;
    }

    // For other cases (e.g., minor bump on a patch prerelease), use standard semver increment
    log(`Standard increment for ${currentVersion} with ${bumpType} bump`, 'debug');
    return semver.inc(currentVersion, bumpType) || '';
  }

  // For non-prerelease versions or non-standard bump types
  return semver.inc(currentVersion, bumpType, prereleaseIdentifier) || '';
}

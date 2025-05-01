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
 * Handles bumping of prerelease versions, applying special case handling
 *
 * @param version The current version being bumped
 * @param releaseType The release type being applied
 * @param identifier Optional prerelease identifier
 * @returns The bumped version
 */
export function bumpVersion(
  currentVersion: string,
  bumpType: ReleaseType,
  prereleaseIdentifier?: string,
): string {
  // Handle prerelease versions
  if (
    semver.prerelease(currentVersion) &&
    STANDARD_BUMP_TYPES.includes(bumpType as 'major' | 'minor' | 'patch')
  ) {
    // Special case for major prerelease versions (1.0.0-next.x) bumping to stable 1.0.0
    // This handles the edge case where:
    // 1. We have a version that's already at 1.0.0-x (prerelease of first major)
    // 2. A major bump is requested on this prerelease
    // 3. Instead of going to 2.0.0, we want to simply "clean" to 1.0.0 (stable release)
    // This is a common pattern when preparing for a major stable release
    const parsed = semver.parse(currentVersion);
    if (
      bumpType === 'major' &&
      parsed?.major === 1 &&
      parsed.minor === 0 &&
      parsed.patch === 0 &&
      semver.prerelease(currentVersion)
    ) {
      return `${parsed.major}.${parsed.minor}.${parsed.patch}`;
    }

    // For standard bump types with prerelease versions
    log(`Cleaning prerelease identifier from ${currentVersion} for ${bumpType} bump`, 'debug');
    return semver.inc(currentVersion, bumpType) || '';
  }

  // For non-prerelease versions or non-standard bump types
  return semver.inc(currentVersion, bumpType, prereleaseIdentifier) || '';
}

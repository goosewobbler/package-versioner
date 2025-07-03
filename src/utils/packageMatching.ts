/**
 * Package matching utilities for scope-based and exact name matching
 */

import micromatch from 'micromatch';
import { log } from './logging.js';

/**
 * Check if a package name matches a target pattern
 * Supports:
 * - Exact matches: "@scope/package-name"
 * - Scope wildcards: "@scope/*"
 * - Path patterns: "packages/**\/*"
 * - Unscoped wildcards: "*" (matches all packages)
 */
export function matchesPackageTarget(packageName: string, target: string): boolean {
  // Exact match
  if (packageName === target) {
    return true;
  }

  // Handle scope wildcards like "@scope/*"
  if (target.startsWith('@') && target.endsWith('/*')) {
    const scope = target.slice(0, -2); // Remove "/*"
    return packageName.startsWith(`${scope}/`);
  }

  // Handle path-based patterns using micromatch
  try {
    return micromatch.isMatch(packageName, target, {
      dot: true,
      contains: true,
      noglobstar: false,
      bash: true,
    });
  } catch (error) {
    log(
      `Invalid pattern "${target}": ${error instanceof Error ? error.message : String(error)}`,
      'warning',
    );
    return false;
  }
}

/**
 * Check if a package name matches any of the target patterns
 */
export function shouldMatchPackageTargets(packageName: string, targets: string[]): boolean {
  return targets.some((target) => matchesPackageTarget(packageName, target));
}

/**
 * Check if a package should be processed based on skip list only
 * Note: Package targeting is now handled at discovery time, so this only handles exclusions
 */
export function shouldProcessPackage(packageName: string, skip: string[] = []): boolean {
  // Only check skip list - targeting is now handled at discovery time
  return !skip.includes(packageName);
}

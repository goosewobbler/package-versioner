/**
 * Package matching utilities for scope-based and exact name matching
 */

/**
 * Check if a package name matches a target pattern
 * Supports:
 * - Exact matches: "@scope/package-name"
 * - Scope wildcards: "@scope/*"
 * - Unscoped wildcards: "*" (matches all packages)
 */
export function matchesPackageTarget(packageName: string, target: string): boolean {
  // Exact match
  if (packageName === target) {
    return true;
  }

  // Handle scope wildcards like "@scope/*"
  if (target.endsWith('/*')) {
    const scope = target.slice(0, -2); // Remove "/*"

    // For "@scope/*", match packages that start with "@scope/"
    if (scope.startsWith('@')) {
      return packageName.startsWith(`${scope}/`);
    }

    // For "prefix/*", match packages that start with "prefix/"
    return packageName.startsWith(`${scope}/`);
  }

  // Handle global wildcard "*"
  if (target === '*') {
    return true;
  }

  return false;
}

/**
 * Check if a package should be processed based on targets and skip lists
 */
export function shouldProcessPackage(
  packageName: string,
  targets: string[] = [],
  skip: string[] = [],
): boolean {
  // Skip packages explicitly excluded (exact match only for skip)
  if (skip.includes(packageName)) {
    return false;
  }

  // If no targets specified, process all non-skipped packages
  if (targets.length === 0) {
    return true;
  }

  // Check if package matches any target pattern
  return targets.some((target) => matchesPackageTarget(packageName, target));
}

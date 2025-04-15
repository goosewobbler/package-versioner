/**
 * Formatting utilities for package-versioner
 */

/**
 * Escapes special characters in a string to be used in a RegExp safely
 * Prevents regex injection when using user-provided strings in RegExp constructors
 */
export function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Format a version tag with optional prefix and package name
 * Format: packageName@tagPrefix or tagPrefix/version if no package name
 */
export function formatTag(version: string, tagPrefix: string, packageName?: string | null): string {
  if (!tagPrefix) return version;

  // If package name is provided, use packageName@tagPrefix format (e.g., @scope/name@v1.0.0)
  if (packageName) {
    return `${packageName}@${tagPrefix}${version}`;
  }

  // Otherwise just use prefix/version format
  return tagPrefix.endsWith('/') ? `${tagPrefix}${version}` : `${tagPrefix}/${version}`;
}

/**
 * Format a tag prefix based on configuration
 */
export function formatTagPrefix(tagPrefix: string, scope?: string): string {
  if (!tagPrefix) return '';

  const prefix = tagPrefix.replace(/\/$/, ''); // Remove trailing slash

  if (scope) {
    return `${prefix}/${scope}`;
  }

  return prefix;
}

/**
 * Format a commit message using a template
 */
export function formatCommitMessage(template: string, version: string, scope?: string): string {
  return createTemplateString(template, { version, scope });
}

/**
 * Create a string from a template with variables
 */
export function createTemplateString(
  template: string,
  variables: Record<string, string | undefined>,
): string {
  return Object.entries(variables).reduce((result, [key, value]) => {
    if (value === undefined) {
      return result;
    }
    const regex = new RegExp(`\\$\\{${key}\\}`, 'g');
    return result.replace(regex, value);
  }, template);
}

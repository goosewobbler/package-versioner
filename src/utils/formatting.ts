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
 * Format a version tag with optional prefix and package name based on templates
 *
 * @param version The version number
 * @param versionPrefix The prefix to use in the template
 * @param packageName Optional package name
 * @param tagTemplate Template for non-package tags
 * @param packageTagTemplate Template for package-specific tags
 * @returns Formatted tag string
 */
export function formatTag(
  version: string,
  versionPrefix: string,
  packageName?: string | null,
  tagTemplate = '${prefix}${version}',
  packageTagTemplate = '${packageName}@${prefix}${version}',
): string {
  // Variables available for templates
  const variables = {
    version,
    prefix: versionPrefix || '',
    packageName: packageName || '',
  };

  // Use the appropriate template based on whether a package name is provided
  const template = packageName ? packageTagTemplate : tagTemplate;

  return createTemplateString(template, variables);
}

/**
 * Format a tag prefix based on configuration
 */
export function formatVersionPrefix(versionPrefix: string, scope?: string): string {
  if (!versionPrefix) return '';

  const cleanPrefix = versionPrefix.replace(/\/$/, ''); // Remove trailing slash

  if (scope) {
    return `${cleanPrefix}/${scope}`;
  }

  return cleanPrefix;
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

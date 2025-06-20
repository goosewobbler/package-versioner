/**
 * Formatting utilities for package-versioner
 */

import { log } from './logging.js';

/**
 * Escapes special characters in a string to be used in a RegExp safely
 * Prevents regex injection when using user-provided strings in RegExp constructors
 */
export function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Format a version tag with optional prefix and package name based on template
 *
 * @param version The version number
 * @param versionPrefix The prefix to use in the template
 * @param packageName Optional package name
 * @param tagTemplate Template for formatting tags
 * @param packageSpecificTags Whether to use package-specific tagging
 * @returns Formatted tag string
 */
export function formatTag(
  version: string,
  versionPrefix: string,
  packageName?: string | null,
  tagTemplate = '${prefix}${version}',
  packageSpecificTags = false,
): string {
  // Check for potential configuration issues
  if (tagTemplate.includes('${packageName}') && !packageSpecificTags) {
    log(
      'Warning: tagTemplate contains ${packageName} but packageSpecificTags is not enabled. ' +
        'This will result in an empty package name in tags. ' +
        'Set packageSpecificTags: true in your configuration to enable package-specific tagging.',
      'warning',
    );
  }

  // Variables available for templates
  const variables = {
    version,
    prefix: versionPrefix || '',
    packageName: packageSpecificTags && packageName ? packageName : '',
  };

  return createTemplateString(tagTemplate, variables);
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
 *
 * @param template The commit message template
 * @param version The version number to include in the message
 * @param packageName Optional package name to include in the message
 * @param scope Optional scope to include in the message
 * @returns Formatted commit message string
 */
export function formatCommitMessage(
  template: string,
  version: string,
  packageName?: string | undefined,
  scope?: string | undefined,
): string {
  // Check for potential configuration issues
  if (template.includes('${packageName}') && !packageName) {
    log(
      'Warning: commitMessage template contains ${packageName} but no package name was provided. ' +
        'This will result in an empty package name in commit messages.',
      'warning',
    );
  }

  return createTemplateString(template, {
    version,
    scope,
    packageName: packageName || '',
  });
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

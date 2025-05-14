/**
 * Changelog Formatters
 *
 * Functions to format changelog entries in different formats
 */

import type { ChangelogEntry } from './changelogManager.js';

/**
 * Extended changelog entry with additional properties for formatting
 */
interface FormattingChangelogEntry extends ChangelogEntry {
  breaking?: boolean;
  originalType?: string;
}

/**
 * Format changelog entries in the specified format
 */
export function formatChangelogEntries(
  format: 'keep-a-changelog' | 'angular',
  version: string,
  date: string,
  entries: ChangelogEntry[],
  packageName?: string,
  repoUrl?: string,
): string {
  // Cast entries to formatting type which might include breaking flag
  const formattingEntries = entries.map((entry) => {
    const hasBreaking = entry.description.includes('**BREAKING**');
    return {
      ...entry,
      breaking: hasBreaking,
    } as FormattingChangelogEntry;
  });

  return format === 'keep-a-changelog'
    ? formatKeepAChangelogEntries(version, date, formattingEntries, repoUrl)
    : formatAngularEntries(version, date, formattingEntries, packageName);
}

/**
 * Format entries using Keep a Changelog format
 */
function formatKeepAChangelogEntries(
  version: string,
  date: string,
  entries: FormattingChangelogEntry[],
  repoUrl?: string,
): string {
  // Group entries by type
  const added: string[] = [];
  const changed: string[] = [];
  const deprecated: string[] = [];
  const removed: string[] = [];
  const fixed: string[] = [];
  const security: string[] = [];

  // Process entries
  for (const entry of entries) {
    const entryText = entry.scope
      ? `- **${entry.scope}**: ${entry.description}`
      : `- ${entry.description}`;

    // Handle breaking changes specially
    const formattedEntry = entry.breaking ? entryText.replace(/^- /, '- **BREAKING** ') : entryText;

    // Map conventional commit types to Keep a Changelog sections
    const entryType = entry.originalType || entry.type;

    switch (entryType) {
      case 'feat':
        added.push(formattedEntry);
        break;
      case 'fix':
        fixed.push(formattedEntry);
        break;
      case 'docs':
      case 'style':
      case 'refactor':
      case 'perf':
      case 'build':
      case 'ci':
        changed.push(formattedEntry);
        break;
      case 'test':
        // Usually ignored in changelogs
        break;
      case 'chore':
        if (entry.description.toLowerCase().includes('deprecat')) {
          deprecated.push(formattedEntry);
        } else {
          changed.push(formattedEntry);
        }
        break;
      // Keep-a-changelog standard types
      case 'added':
        added.push(formattedEntry);
        break;
      case 'changed':
        changed.push(formattedEntry);
        break;
      case 'deprecated':
        deprecated.push(formattedEntry);
        break;
      case 'removed':
        removed.push(formattedEntry);
        break;
      case 'fixed':
        fixed.push(formattedEntry);
        break;
      case 'security':
        security.push(formattedEntry);
        break;
      default:
        changed.push(formattedEntry);
    }
  }

  // Generate changelog content
  let content = `## [${version}] - ${date}\n\n`;

  // Add sections with entries
  if (added.length > 0) {
    content += `### Added\n\n${added.join('\n')}\n\n`;
  }

  if (changed.length > 0) {
    content += `### Changed\n\n${changed.join('\n')}\n\n`;
  }

  if (deprecated.length > 0) {
    content += `### Deprecated\n\n${deprecated.join('\n')}\n\n`;
  }

  if (removed.length > 0) {
    content += `### Removed\n\n${removed.join('\n')}\n\n`;
  }

  if (fixed.length > 0) {
    content += `### Fixed\n\n${fixed.join('\n')}\n\n`;
  }

  if (security.length > 0) {
    content += `### Security\n\n${security.join('\n')}\n\n`;
  }

  // Add links if repository URL is provided
  if (repoUrl) {
    content += `[${version}]: ${repoUrl}/compare/v${version}...HEAD\n`;
  }

  return content.trim();
}

/**
 * Format entries using Angular changelog format
 */
function formatAngularEntries(
  version: string,
  date: string,
  entries: FormattingChangelogEntry[],
  packageName?: string,
): string {
  // Group entries by type
  const features: FormattingChangelogEntry[] = [];
  const bugfixes: FormattingChangelogEntry[] = [];
  const performance: FormattingChangelogEntry[] = [];
  const breaking: FormattingChangelogEntry[] = [];

  // Process entries
  for (const entry of entries) {
    // Track breaking changes separately
    if (entry.breaking) {
      breaking.push(entry);
    }

    // Group by conventional commit type
    const entryType = entry.originalType || entry.type;

    switch (entryType) {
      case 'feat':
      case 'added':
        features.push(entry);
        break;
      case 'fix':
      case 'fixed':
        bugfixes.push(entry);
        break;
      case 'perf':
        performance.push(entry);
        break;
      // Other types are not commonly included in Angular format
    }
  }

  // Generate changelog content
  let content = `## [${version}]${packageName ? ` (${packageName})` : ''} (${date})\n\n`;

  // Format feature entries
  if (features.length > 0) {
    content += '### Features\n\n';
    content += formatAngularTypeEntries(features);
    content += '\n';
  }

  // Format bugfix entries
  if (bugfixes.length > 0) {
    content += '### Bug Fixes\n\n';
    content += formatAngularTypeEntries(bugfixes);
    content += '\n';
  }

  // Format performance entries
  if (performance.length > 0) {
    content += '### Performance Improvements\n\n';
    content += formatAngularTypeEntries(performance);
    content += '\n';
  }

  // Format breaking changes section
  if (breaking.length > 0) {
    content += '### BREAKING CHANGES\n\n';
    content += formatAngularTypeEntries(breaking);
    content += '\n';
  }

  return content.trim();
}

/**
 * Format a group of entries in Angular style
 */
function formatAngularTypeEntries(entries: FormattingChangelogEntry[]): string {
  // Group by scope
  const entriesByScope = new Map<string, FormattingChangelogEntry[]>();

  for (const entry of entries) {
    const scope = entry.scope || '';
    if (!entriesByScope.has(scope)) {
      entriesByScope.set(scope, []);
    }
    entriesByScope.get(scope)?.push(entry);
  }

  // Format entries by scope
  const result: string[] = [];

  for (const [scope, scopeEntries] of Object.entries(groupEntriesByScope(entries))) {
    if (scope !== 'undefined' && scope !== '') {
      result.push(`* **${scope}:**`);
      for (const entry of scopeEntries) {
        // Clean up the breaking prefix since we're already in the breaking section
        const description = entry.description.replace('**BREAKING** ', '');
        result.push(`  * ${description}`);
      }
    } else {
      // No scope
      for (const entry of scopeEntries) {
        // Clean up the breaking prefix since we're already in the breaking section
        const description = entry.description.replace('**BREAKING** ', '');
        result.push(`* ${description}`);
      }
    }
  }

  return result.join('\n');
}

/**
 * Group entries by scope
 */
function groupEntriesByScope(
  entries: FormattingChangelogEntry[],
): Record<string, FormattingChangelogEntry[]> {
  const result: Record<string, FormattingChangelogEntry[]> = {};

  for (const entry of entries) {
    const scope = entry.scope || '';
    if (!result[scope]) {
      result[scope] = [];
    }
    result[scope].push(entry);
  }

  return result;
}

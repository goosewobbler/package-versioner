/**
 * Commit Parser
 *
 * Extracts changelog entries from git commit messages
 */

import { execSync } from 'node:child_process';
import { log } from '../utils/logging.js';
import type { ChangelogEntry } from './changelogManager.js';

// Regular expression to parse conventional commit messages
const CONVENTIONAL_COMMIT_REGEX = /^(\w+)(?:\(([^)]+)\))?(!)?: (.+)(?:\n\n([\s\S]*))?/;
// Regular expression to extract breaking change notes
const BREAKING_CHANGE_REGEX = /BREAKING CHANGE: ([\s\S]+?)(?:\n\n|$)/;

/**
 * Extract changelog entries from Git commits
 * @param projectDir Directory to run git commands from
 * @param revisionRange Git revision range (e.g., "v1.0.0..v1.1.0" or tag name)
 * @returns Array of changelog entries
 */
export function extractChangelogEntriesFromCommits(
  projectDir: string,
  revisionRange: string,
): ChangelogEntry[] {
  try {
    const command = `git log ${revisionRange} --pretty=format:"%B---COMMIT_DELIMITER---" --no-merges`;
    const output = execSync(command, {
      cwd: projectDir,
      encoding: 'utf8',
    });

    // Split by commit delimiter and remove empty commits
    const commits = output.split('---COMMIT_DELIMITER---').filter((commit) => commit.trim() !== '');

    // Parse each commit and convert to changelog entries
    return commits
      .map((commit) => parseCommitMessage(commit))
      .filter((entry): entry is ChangelogEntry => entry !== null);
  } catch (error) {
    log(`Error extracting commits: ${error}`, 'error');
    return [];
  }
}

/**
 * Parse a commit message into a changelog entry
 */
function parseCommitMessage(message: string): ChangelogEntry | null {
  // Try to parse as conventional commit
  const match = message.match(CONVENTIONAL_COMMIT_REGEX);

  if (match) {
    const [, type, scope, breakingMark, subject, body = ''] = match;

    // Detect breaking changes from the ! marker or BREAKING CHANGE: in body
    const breakingFromMark = breakingMark === '!';
    const breakingChangeMatch = body.match(BREAKING_CHANGE_REGEX);
    const hasBreakingChange = breakingFromMark || breakingChangeMatch !== null;

    // Map conventional commit type to changelog type
    const changelogType = mapCommitTypeToChangelogType(type);

    // Skip certain commit types that usually aren't relevant to the changelog
    if (!changelogType) {
      return null;
    }

    // Extract issue IDs from footer (assuming format like "Fixes #123")
    const issueIds = extractIssueIds(body);

    // Format description, adding BREAKING prefix if needed
    let description = subject;
    if (hasBreakingChange) {
      description = `**BREAKING** ${description}`;
    }

    return {
      type: changelogType,
      description,
      scope: scope || undefined,
      issueIds: issueIds.length > 0 ? issueIds : undefined,
      originalType: type, // Store original type for custom formatting
    };
  }

  // Non-conventional commit - try to extract basic information
  // Only include if it seems meaningful (not just a merge or version bump)
  if (!message.startsWith('Merge') && !message.match(/^v?\d+\.\d+\.\d+/)) {
    const firstLine = message.split('\n')[0].trim();
    return {
      type: 'changed',
      description: firstLine,
    };
  }

  return null;
}

/**
 * Map conventional commit type to changelog entry type
 */
function mapCommitTypeToChangelogType(type: string): ChangelogEntry['type'] | null {
  switch (type) {
    case 'feat':
      return 'added';
    case 'fix':
      return 'fixed';
    case 'docs':
    case 'style':
    case 'refactor':
    case 'perf':
    case 'build':
    case 'ci':
      return 'changed';
    case 'revert':
      return 'removed';
    case 'chore':
      // Special case - depend on commit message
      return 'changed';
    case 'test':
      // Usually test changes are not in changelog
      return null;
    default:
      // For unknown types, put in 'changed'
      return 'changed';
  }
}

/**
 * Extract issue IDs from commit message body
 */
function extractIssueIds(body: string): string[] {
  const issueRegex = /(?:fix|fixes|close|closes|resolve|resolves)\s+#(\d+)/gi;
  const issueIds: string[] = [];

  // Rewrite to avoid assignment in expression
  let match: RegExpExecArray | null = issueRegex.exec(body);
  while (match !== null) {
    issueIds.push(`#${match[1]}`);
    match = issueRegex.exec(body);
  }

  return issueIds;
}

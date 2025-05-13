import { execSync } from 'node:child_process';
import { log } from '../utils/logging.js';
import type { ChangelogEntry } from './changelogManager.js';

/**
 * Map conventional commit types to changelog entry types
 */
const COMMIT_TYPE_MAP: Record<
  string,
  'added' | 'changed' | 'deprecated' | 'removed' | 'fixed' | 'security'
> = {
  feat: 'added',
  feature: 'added',
  fix: 'fixed',
  perf: 'changed',
  refactor: 'changed',
  style: 'changed',
  docs: 'changed',
  test: 'changed',
  build: 'changed',
  ci: 'changed',
  chore: 'changed',
  revert: 'removed',
  deprecate: 'deprecated',
  security: 'security',
};

/**
 * Extract issue IDs from commit message
 */
function extractIssueIds(message: string): string[] {
  const issueIds: string[] = [];
  const closesPattern = /(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?):?\s+(?:#(\d+))/gi;
  let match: RegExpExecArray | null = closesPattern.exec(message);

  while (match !== null) {
    if (match[1]) {
      issueIds.push(`#${match[1]}`);
    }
    match = closesPattern.exec(message);
  }

  return issueIds;
}

/**
 * Parse a commit message into a changelog entry
 */
function parseCommit(commitMessage: string): ChangelogEntry | null {
  // Basic conventional commit format: <type>[(scope)]: <description>
  const conventionalCommitPattern = /^(\w+)(?:\(([^)]+)\))?: (.+)$/;
  const match = conventionalCommitPattern.exec(commitMessage.split('\n')[0].trim());

  if (!match) {
    return null;
  }

  const [, type, scope, description] = match;

  // Skip commits we don't want in the changelog
  if (type === 'chore' && description.startsWith('release')) {
    return null;
  }

  // Map commit type to changelog entry type
  const entryType = COMMIT_TYPE_MAP[type] || 'changed';
  const issueIds = extractIssueIds(commitMessage);

  let formattedDescription = description;
  if (scope) {
    formattedDescription = `**${scope}**: ${description}`;
  }

  // Check for BREAKING CHANGE
  const isBreaking = commitMessage.includes('BREAKING CHANGE:') || commitMessage.includes('!:');
  if (isBreaking) {
    formattedDescription = `**BREAKING** ${formattedDescription}`;
  }

  return {
    type: entryType,
    description: formattedDescription,
    issueIds: issueIds.length > 0 ? issueIds : undefined,
    scope,
    originalType: type,
  };
}

/**
 * Get commit messages between versions
 */
function getCommitMessagesBetweenVersions(
  packagePath: string,
  fromTag?: string,
  toRef = 'HEAD',
): string[] {
  try {
    const gitCommand = fromTag
      ? `git log ${fromTag}..${toRef} --format=%B%n-commit-separator- -- "${packagePath}"`
      : `git log --format=%B%n-commit-separator- -- "${packagePath}"`;

    const output = execSync(gitCommand, { encoding: 'utf8' });

    return output
      .split('-commit-separator-\n')
      .filter(Boolean)
      .map((msg) => msg.trim());
  } catch (error) {
    log(
      `Error getting commit messages: ${error instanceof Error ? error.message : String(error)}`,
      'error',
    );
    return [];
  }
}

/**
 * Extract changelog entries from commits for a package
 */
export function extractChangelogEntriesFromCommits(
  packagePath: string,
  fromTag?: string,
  toRef?: string,
): ChangelogEntry[] {
  // Get commit messages between versions
  const commitMessages = getCommitMessagesBetweenVersions(packagePath, fromTag, toRef);

  // Parse each commit and filter out null results
  const entries = commitMessages
    .map(parseCommit)
    .filter((entry): entry is ChangelogEntry => entry !== null);

  return entries;
}

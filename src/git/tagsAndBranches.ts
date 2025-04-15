import { getSemverTags } from 'git-semver-tags';
import { log } from '../utils/logging.js';
import { execAsync, execSync } from './commandExecutor.js';

/**
 * Get the number of commits since the last tag for a specific package
 * @param pkgRoot Path to the package
 * @returns Number of commits
 */
export function getCommitsLength(pkgRoot: string): number {
  try {
    const gitCommand = `git rev-list --count HEAD ^$(git describe --tags --abbrev=0) ${pkgRoot}`;
    const amount = execSync(gitCommand).toString().trim();

    return Number(amount);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log(`Failed to get number of commits since last tag: ${errorMessage}`, 'error');
    return 0;
  }
}

/**
 * Get the latest semver tag from the repository
 * @returns The latest tag or empty string if none found
 */
export async function getLatestTag(): Promise<string> {
  try {
    const tags: string[] = await getSemverTags({});
    return tags[0] || ''; // Return the latest tag or empty string
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log(`Failed to get latest tag: ${errorMessage}`, 'error');

    // Check if the error specifically means no tags were found
    if (error instanceof Error && error.message.includes('No names found')) {
      log('No tags found in the repository.', 'info');
    }

    return ''; // Return empty string on error or no tags
  }
}

/**
 * Get the name of the last merged branch matching the specified patterns
 * @param branches Branch patterns to match
 * @param baseBranch Base branch to check merges against
 * @returns Branch name or null if not found
 */
export async function lastMergeBranchName(
  branches: string[],
  baseBranch: string,
): Promise<string | null> {
  try {
    const branchesRegex = `${branches.join('/(.*)|')}/(.*)`;
    const command = `git for-each-ref --sort=-committerdate --format='%(refname:short)' refs/heads --merged ${baseBranch} | grep -o -i -E "${branchesRegex}" | awk -F'[ ]' '{print $1}' | head -n 1`;
    const { stdout } = await execAsync(command);
    return stdout.trim();
  } catch (error) {
    console.error(
      'Error while getting the last branch name:',
      error instanceof Error ? error.message : String(error),
    );
    return null;
  }
}

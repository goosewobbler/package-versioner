import { getSemverTags } from 'git-semver-tags';
import { escapeRegExp } from '../utils/formatting.js';
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
    // Escape special regex characters in branch patterns
    const escapedBranches = branches.map((branch) => escapeRegExp(branch));

    const branchesRegex = `${escapedBranches.join('/(.*)|')}/(.*)`;
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

/**
 * Get the latest semver tag for a specific package
 * @param packageName The name of the package to get tags for
 * @param versionPrefix Optional version prefix (e.g., 'v')
 * @returns The latest tag for the package or empty string if none found
 */
export async function getLatestTagForPackage(
  packageName: string,
  versionPrefix?: string,
): Promise<string> {
  try {
    // Escape @ in package name for regex
    const escapedPackageName = escapeRegExp(packageName);

    log(
      `Looking for tags for package ${packageName} with prefix ${versionPrefix || 'none'}`,
      'debug',
    );

    // Instead of using the package option which requires lerna mode,
    // get all tags and filter manually for the package
    const allTags: string[] = await getSemverTags({
      tagPrefix: versionPrefix,
    });

    log(`Retrieved ${allTags.length} tags: ${allTags.join(', ')}`, 'debug');

    // Filter for tags that match this package's format
    // Support various common monorepo tag formats:
    // 1. packageName@versionPrefix+version (e.g., {packageName}@v1.1.0)
    // 2. versionPrefix+packageName@version (e.g., v{packageName}@1.1.0)
    // 3. packageName@version (e.g., {packageName}@1.1.0)
    let packageTags: string[] = [];

    // First try the most common format: packageName@versionPrefix+version
    if (versionPrefix) {
      const pattern1 = new RegExp(`^${escapedPackageName}@${escapeRegExp(versionPrefix)}`);
      packageTags = allTags.filter((tag) => pattern1.test(tag));

      // If we found tags with this pattern, return the first (most recent) one
      if (packageTags.length > 0) {
        log(
          `Found ${packageTags.length} package tags using pattern: packageName@${versionPrefix}...`,
          'debug',
        );
        log(`Using tag: ${packageTags[0]}`, 'debug');
        return packageTags[0];
      }
    }

    // Try the alternative format: versionPrefix+packageName@version
    if (versionPrefix) {
      const pattern2 = new RegExp(`^${escapeRegExp(versionPrefix)}${escapedPackageName}@`);
      packageTags = allTags.filter((tag) => pattern2.test(tag));

      // If we found tags with this pattern, return the first (most recent) one
      if (packageTags.length > 0) {
        log(
          `Found ${packageTags.length} package tags using pattern: ${versionPrefix}packageName@...`,
          'debug',
        );
        log(`Using tag: ${packageTags[0]}`, 'debug');
        return packageTags[0];
      }
    }

    // Fallback to no prefix: packageName@version
    const pattern3 = new RegExp(`^${escapedPackageName}@`);
    packageTags = allTags.filter((tag) => pattern3.test(tag));

    // Log all found tags for debugging
    log(`Found ${packageTags.length} package tags for ${packageName}`, 'debug');
    if (packageTags.length === 0) {
      log('No matching tags found for pattern: packageName@version', 'debug');
      if (allTags.length > 0) {
        log(`Available tags: ${allTags.join(', ')}`, 'debug');
      } else {
        log('No tags available in the repository', 'debug');
      }
    } else {
      log(`Using tag: ${packageTags[0]}`, 'debug');
    }

    return packageTags[0] || ''; // Return the latest tag or empty string
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log(`Failed to get latest tag for package ${packageName}: ${errorMessage}`, 'error');

    // Check if the error specifically means no tags were found
    if (error instanceof Error && error.message.includes('No names found')) {
      log(`No tags found for package ${packageName}.`, 'info');
    }

    return ''; // Return empty string on error or no tags
  }
}

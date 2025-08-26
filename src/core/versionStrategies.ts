/**
 * Strategy functions for versioning using the higher-order function pattern
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import * as path from 'node:path';
import type { Package } from '@manypkg/get-packages';
import { type ChangelogEntry, updateChangelog } from '../changelog/changelogManager.js';
import { extractChangelogEntriesFromCommits } from '../changelog/commitParser.js';
import { GitError } from '../errors/gitError.js';
import { createVersionError, VersionError, VersionErrorCode } from '../errors/versionError.js';
import { createGitCommitAndTag } from '../git/commands.js';
import { getLatestTag, getLatestTagForPackage } from '../git/tagsAndBranches.js';
import { updatePackageVersion } from '../package/packageManagement.js';
import { PackageProcessor } from '../package/packageProcessor.js';
import type { Config } from '../types.js';
import { formatCommitMessage, formatTag, formatVersionPrefix } from '../utils/formatting.js';
import { log } from '../utils/logging.js';
import { shouldProcessPackage as shouldProcessPackageUtil } from '../utils/packageMatching.js';
import { calculateVersion } from './versionCalculator.js';
import type { PackagesWithRoot } from './versionEngine.js';

/**
 * Available strategy types
 */
export type StrategyType = 'sync' | 'single' | 'async';

/**
 * Strategy function type
 */
export type StrategyFunction = (packages: PackagesWithRoot, targets?: string[]) => Promise<void>;

/**
 * Helper function to determine if a package should be processed
 * Note: Package targeting is now handled at discovery time, so this only handles skip logic
 */
function shouldProcessPackage(pkg: Package, config: Config): boolean {
  const pkgName = pkg.packageJson.name;
  return shouldProcessPackageUtil(pkgName, config.skip);
}

/**
 * Create a sync versioning strategy function
 */
export function createSyncStrategy(config: Config): StrategyFunction {
  return async (packages: PackagesWithRoot): Promise<void> => {
    try {
      const {
        versionPrefix,
        tagTemplate,
        baseBranch,
        branchPattern,
        commitMessage = 'chore(release): v${version}',
        prereleaseIdentifier,
        dryRun,
        skipHooks,
        mainPackage,
      } = config;

      // Calculate version for root package first
      const formattedPrefix = formatVersionPrefix(versionPrefix || 'v');
      let latestTag = await getLatestTag();

      // Find the main package if specified
      let mainPkgPath = packages.root;
      let mainPkgName: string | undefined;

      if (mainPackage) {
        const mainPkg = packages.packages.find((p) => p.packageJson.name === mainPackage);
        if (mainPkg) {
          mainPkgPath = mainPkg.dir;
          mainPkgName = mainPkg.packageJson.name;
          log(`Using ${mainPkgName} as primary package for version determination`, 'info');
        } else {
          log(
            `Main package '${mainPackage}' not found. Using root package for version determination.`,
            'warning',
          );
        }
      }

      // Make sure we have a valid path for version calculation
      if (!mainPkgPath) {
        mainPkgPath = process.cwd();
        log(
          `No valid package path found, using current working directory: ${mainPkgPath}`,
          'warning',
        );
      }

      // If we have a main package, try to get package-specific tags first
      if (mainPkgName) {
        const packageSpecificTag = await getLatestTagForPackage(mainPkgName, formattedPrefix, {
          tagTemplate,
          packageSpecificTags: config.packageSpecificTags,
        });

        if (packageSpecificTag) {
          latestTag = packageSpecificTag;
          log(`Using package-specific tag for ${mainPkgName}: ${latestTag}`, 'debug');
        } else {
          log(
            `No package-specific tag found for ${mainPkgName}, using global tag: ${latestTag}`,
            'debug',
          );
        }
      }

      // Calculate the next version using the main package if specified
      const nextVersion = await calculateVersion(config, {
        latestTag,
        versionPrefix: formattedPrefix,
        branchPattern,
        baseBranch,
        prereleaseIdentifier,
        path: mainPkgPath,
        name: mainPkgName,
        type: config.type,
      });

      if (!nextVersion) {
        const msg = mainPkgName
          ? `No version change needed for ${mainPkgName}`
          : 'No version change needed';
        log(msg, 'info');
        return;
      }

      const files: string[] = [];
      const updatedPackages: string[] = [];
      const processedPaths = new Set<string>(); // Track processed paths to avoid duplicates

      // Update root package.json if exists
      try {
        // Check if packages.root is defined before joining paths
        if (packages.root) {
          const rootPkgPath = path.join(packages.root, 'package.json');
          if (fs.existsSync(rootPkgPath)) {
            updatePackageVersion(rootPkgPath, nextVersion);
            files.push(rootPkgPath);
            updatedPackages.push('root');
            processedPaths.add(rootPkgPath);
          }
        } else {
          log('Root package path is undefined, skipping root package.json update', 'warning');
        }
      } catch (error) {
        const errMessage = error instanceof Error ? error.message : String(error);
        log(`Failed to update root package.json: ${errMessage}`, 'error');
      }

      // Update all workspace packages
      for (const pkg of packages.packages) {
        if (!shouldProcessPackage(pkg, config)) {
          continue;
        }

        const packageJsonPath = path.join(pkg.dir, 'package.json');

        // Skip if we've already processed this path (avoids duplicates in single-package repos)
        if (processedPaths.has(packageJsonPath)) {
          continue;
        }

        updatePackageVersion(packageJsonPath, nextVersion);
        files.push(packageJsonPath);
        updatedPackages.push(pkg.packageJson.name);
        processedPaths.add(packageJsonPath);
      }

      // Log updated packages
      if (updatedPackages.length > 0) {
        log(`Updated ${updatedPackages.length} package(s) to version ${nextVersion}`, 'success');
      } else {
        log('No packages were updated', 'warning');
        return;
      }

      // Create tag using the template
      // In sync mode with single package, respect packageSpecificTags setting
      let tagPackageName: string | null = null;
      let commitPackageName: string | undefined;

      // If packageSpecificTags is enabled and we have exactly one package, use its name
      if (config.packageSpecificTags && packages.packages.length === 1) {
        tagPackageName = packages.packages[0].packageJson.name;
        commitPackageName = packages.packages[0].packageJson.name;
      }

      const nextTag = formatTag(
        nextVersion,
        formattedPrefix,
        tagPackageName,
        tagTemplate,
        config.packageSpecificTags || false,
      );
      const formattedCommitMessage = formatCommitMessage(
        commitMessage,
        nextVersion,
        commitPackageName,
        undefined,
      );

      // Use the Git service functions
      await createGitCommitAndTag(files, nextTag, formattedCommitMessage, skipHooks, dryRun);
    } catch (error) {
      if (error instanceof VersionError || error instanceof GitError) {
        log(`Synced Strategy failed: ${error.message} (${error.code || 'UNKNOWN'})`, 'error');
      } else {
        const errorMessage = error instanceof Error ? error.message : String(error);
        log(`Synced Strategy failed: ${errorMessage}`, 'error');
      }
      throw error;
    }
  };
}

/**
 * Create a single package versioning strategy function
 */
export function createSingleStrategy(config: Config): StrategyFunction {
  return async (packages: PackagesWithRoot): Promise<void> => {
    try {
      const {
        mainPackage,
        versionPrefix,
        tagTemplate,
        commitMessage = 'chore(release): ${version}',
        dryRun,
        skipHooks,
      } = config;

      // Use mainPackage if specified, otherwise use the first package from the resolved packages
      let packageName: string | undefined;

      if (mainPackage) {
        packageName = mainPackage;
      } else if (packages.packages.length === 1) {
        packageName = packages.packages[0].packageJson.name;
      } else {
        throw createVersionError(
          VersionErrorCode.INVALID_CONFIG,
          'Single mode requires either mainPackage or exactly one resolved package',
        );
      }

      const pkg = packages.packages.find((p) => p.packageJson.name === packageName);

      if (!pkg) {
        throw createVersionError(VersionErrorCode.PACKAGE_NOT_FOUND, packageName);
      }

      const pkgPath = pkg.dir;
      const formattedPrefix = formatVersionPrefix(versionPrefix || 'v');

      // Try to get the latest tag specific to this package first
      let latestTagResult = await getLatestTagForPackage(packageName, formattedPrefix, {
        tagTemplate,
        packageSpecificTags: config.packageSpecificTags,
      });

      // Fallback to global tag if no package-specific tag exists
      if (!latestTagResult) {
        const globalTagResult = await getLatestTag();
        latestTagResult = globalTagResult || '';
      }

      // At this point, latestTagResult is guaranteed to be a string (possibly empty)
      const latestTag = latestTagResult;

      let nextVersion: string | undefined;

      // Calculate the next version
      nextVersion = await calculateVersion(config, {
        latestTag,
        versionPrefix: formattedPrefix,
        branchPattern: config.branchPattern,
        baseBranch: config.baseBranch,
        prereleaseIdentifier: config.prereleaseIdentifier,
        path: pkgPath,
        name: packageName,
        type: config.type,
      });

      if (!nextVersion) {
        log(`No version change needed for ${packageName}`, 'info');
        return;
      }

      // Generate changelog entries from conventional commits
      if (config.updateChangelog !== false) {
        // Extract changelog entries from commit messages
        let changelogEntries: ChangelogEntry[] = [];

        try {
          // Extract entries from commits between the latest tag and HEAD
          let revisionRange: string;

          // Check if the tag actually exists in the repository
          if (latestTag) {
            try {
              execSync(`git rev-parse --verify "${latestTag}"`, {
                cwd: pkgPath,
                stdio: 'ignore',
              });
              // Tag exists, get commits since that tag
              revisionRange = `${latestTag}..HEAD`;
            } catch {
              // Tag doesn't exist, get all commits
              log(`Tag ${latestTag} doesn't exist, using all commits for changelog`, 'debug');
              revisionRange = 'HEAD';
            }
          } else {
            // No tag provided, get all commits
            revisionRange = 'HEAD';
          }

          changelogEntries = extractChangelogEntriesFromCommits(pkgPath, revisionRange);

          // If we have no entries but we're definitely changing versions,
          // add a minimal entry about the version change
          if (changelogEntries.length === 0) {
            changelogEntries = [
              {
                type: 'changed',
                description: `Update version to ${nextVersion}`,
              },
            ];
          }
        } catch (error) {
          log(
            `Error extracting changelog entries: ${error instanceof Error ? error.message : String(error)}`,
            'warning',
          );
          // Fall back to minimal entry
          changelogEntries = [
            {
              type: 'changed',
              description: `Update version to ${nextVersion}`,
            },
          ];
        }

        // Determine repo URL from package.json or git config
        let repoUrl: string | undefined;
        try {
          const packageJsonPath = path.join(pkgPath, 'package.json');
          if (fs.existsSync(packageJsonPath)) {
            const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
            if (packageJson.repository) {
              if (typeof packageJson.repository === 'string') {
                repoUrl = packageJson.repository;
              } else if (packageJson.repository.url) {
                repoUrl = packageJson.repository.url;
              }

              // Clean up GitHub URL format if needed
              if (repoUrl?.startsWith('git+') && repoUrl?.endsWith('.git')) {
                repoUrl = repoUrl.substring(4, repoUrl.length - 4);
              }
            }
          }
        } catch (error) {
          log(
            `Could not determine repository URL for changelog links: ${error instanceof Error ? error.message : String(error)}`,
            'warning',
          );
        }

        // Update the changelog
        updateChangelog(
          pkgPath,
          packageName,
          nextVersion,
          changelogEntries,
          repoUrl,
          config.changelogFormat,
        );
      }

      // Update package version
      const packageJsonPath = path.join(pkgPath, 'package.json');
      updatePackageVersion(packageJsonPath, nextVersion);

      log(`Updated package ${packageName} to version ${nextVersion}`, 'success');

      // Create tag and commit
      const tagName = formatTag(
        nextVersion,
        formattedPrefix,
        packageName,
        tagTemplate,
        config.packageSpecificTags,
      );

      const commitMsg = formatCommitMessage(commitMessage, nextVersion, packageName);

      if (!dryRun) {
        await createGitCommitAndTag([packageJsonPath], tagName, commitMsg, skipHooks, dryRun);
        log(`Created tag: ${tagName}`, 'success');
      } else {
        log(`Would create tag: ${tagName}`, 'info');
      }
    } catch (error) {
      if (error instanceof VersionError || error instanceof GitError) {
        log(`Single Strategy failed: ${error.message} (${error.code || 'UNKNOWN'})`, 'error');
      } else {
        const errorMessage = error instanceof Error ? error.message : String(error);
        log(`Single Strategy failed: ${errorMessage}`, 'error');
      }
      throw error;
    }
  };
}

/**
 * Create an async package versioning strategy function
 */
export function createAsyncStrategy(config: Config): StrategyFunction {
  // Initialize package processor dependencies
  const dependencies = {
    getLatestTag,
  };

  // Initialize processor with configuration
  const processorOptions = {
    skip: config.skip || [],
    versionPrefix: config.versionPrefix || 'v',
    tagTemplate: config.tagTemplate,
    commitMessageTemplate: config.commitMessage || '',
    dryRun: config.dryRun || false,
    skipHooks: config.skipHooks || false,
    getLatestTag: dependencies.getLatestTag,
    fullConfig: config,
    // Extract common version configuration properties
    config: {
      branchPattern: config.branchPattern || [],
      baseBranch: config.baseBranch || 'main',
      prereleaseIdentifier: config.prereleaseIdentifier,
      type: config.type,
    },
  };

  const packageProcessor = new PackageProcessor(processorOptions);

  return async (packages: PackagesWithRoot, _targets: string[] = []): Promise<void> => {
    try {
      // Packages are already filtered at discovery time, so just process all passed packages
      log(`Processing ${packages.packages.length} pre-filtered packages`, 'info');

      // 2. Process packages with PackageProcessor
      const result = await packageProcessor.processPackages(packages.packages);

      // 3. Report results
      if (result.updatedPackages.length === 0) {
        log('No packages required a version update.', 'info');
      } else {
        const packageNames = result.updatedPackages.map((p) => p.name).join(', ');
        log(`Updated ${result.updatedPackages.length} package(s): ${packageNames}`, 'success');

        if (result.tags.length > 0) {
          log(`Created ${result.tags.length} tag(s): ${result.tags.join(', ')}`, 'success');
        }

        if (result.commitMessage) {
          log(`Created commit with message: "${result.commitMessage}"`, 'success');
        }
      }
    } catch (error) {
      if (error instanceof VersionError || error instanceof GitError) {
        log(`Async Strategy failed: ${error.message} (${error.code || 'UNKNOWN'})`, 'error');
      } else {
        const errorMessage = error instanceof Error ? error.message : String(error);
        log(`Async Strategy failed: ${errorMessage}`, 'error');
      }
      throw error;
    }
  };
}

/**
 * Create a strategy function based on configuration
 * Note: This is only used for initial strategy creation.
 * The CLI will override this based on resolved packages.
 */
export function createStrategy(config: Config): StrategyFunction {
  if (config.sync) {
    return createSyncStrategy(config);
  }

  // Default to async strategy - the CLI will determine the actual strategy
  // based on resolved packages after glob expansion
  return createAsyncStrategy(config);
}

/**
 * Create a strategy map for easy lookup
 */
export function createStrategyMap(config: Config): Record<StrategyType, StrategyFunction> {
  return {
    sync: createSyncStrategy(config),
    single: createSingleStrategy(config),
    async: createAsyncStrategy(config),
  };
}

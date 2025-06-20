/**
 * Strategy functions for versioning using the higher-order function pattern
 */
import fs from 'node:fs';
import * as path from 'node:path';

import type { Package } from '@manypkg/get-packages';
import { GitError } from '../errors/gitError.js';
import { VersionError, VersionErrorCode, createVersionError } from '../errors/versionError.js';
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
export type StrategyType = 'synced' | 'single' | 'async';

/**
 * Strategy function type
 */
export type StrategyFunction = (packages: PackagesWithRoot, targets?: string[]) => Promise<void>;

/**
 * Helper function to determine if a package should be processed
 */
function shouldProcessPackage(pkg: Package, config: Config, targets: string[] = []): boolean {
  const pkgName = pkg.packageJson.name;
  return shouldProcessPackageUtil(pkgName, targets, config.skip);
}

/**
 * Create a synced versioning strategy function
 */
export function createSyncedStrategy(config: Config): StrategyFunction {
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
      const latestTag = await getLatestTag();

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
        log('No version change needed', 'info');
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
      // In synced mode with single package, respect packageSpecificTags setting
      let tagPackageName: string | null = null;
      let commitPackageName: string | undefined = undefined;

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
        packages: configPackages,
        mainPackage,
        versionPrefix,
        tagTemplate,
        commitMessage = 'chore(release): ${version}',
        dryRun,
        skipHooks,
      } = config;

      // Use mainPackage if specified, otherwise use the first package from the packages array
      let packageName: string | undefined;

      if (mainPackage) {
        packageName = mainPackage;
      } else if (configPackages && configPackages.length === 1) {
        packageName = configPackages[0];
      } else {
        throw createVersionError(
          VersionErrorCode.INVALID_CONFIG,
          'Single mode requires either mainPackage or exactly one package in the packages array',
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

      let nextVersion: string | undefined = undefined;
      try {
        // Calculate the next version
        nextVersion = await calculateVersion(config, {
          latestTag,
          versionPrefix: formattedPrefix,
          path: pkgPath,
          name: packageName,
          type: config.type,
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        throw createVersionError(VersionErrorCode.VERSION_CALCULATION_ERROR, errorMessage);
      }

      // Explicitly check for undefined (error) or empty string (no bump)
      if (nextVersion === undefined || nextVersion === '') {
        log(`No version change needed for ${packageName}`, 'info');
        return;
      }

      // Update package.json
      const packageJsonPath = path.join(pkgPath, 'package.json');
      updatePackageVersion(packageJsonPath, nextVersion);

      log(`Updated package ${packageName} to version ${nextVersion}`, 'success');

      // Create tag
      const nextTag = formatTag(
        nextVersion,
        formattedPrefix,
        packageName,
        tagTemplate,
        config.packageSpecificTags,
      );
      const formattedCommitMessage = formatCommitMessage(commitMessage, nextVersion, packageName);

      // Use the Git service functions
      await createGitCommitAndTag(
        [packageJsonPath],
        nextTag,
        formattedCommitMessage,
        skipHooks,
        dryRun,
      );
    } catch (error) {
      if (error instanceof VersionError || error instanceof GitError) {
        log(
          `Single Package Strategy failed: ${error.message} (${error.code || 'UNKNOWN'})`,
          'error',
        );
      } else {
        const errorMessage = error instanceof Error ? error.message : String(error);
        log(`Single Package Strategy failed: ${errorMessage}`, 'error');
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
    targets: config.packages || [],
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

  return async (packages: PackagesWithRoot, targets: string[] = []): Promise<void> => {
    try {
      // 1. Set targets for processing
      const targetPackages = targets.length > 0 ? targets : config.packages || [];
      packageProcessor.setTargets(targetPackages);

      if (targetPackages.length > 0) {
        log(`Processing targeted packages: ${targetPackages.join(', ')}`, 'info');
      } else {
        log('No targets specified, processing all non-skipped packages', 'info');
      }

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
 */
export function createStrategy(config: Config): StrategyFunction {
  if (config.synced) {
    return createSyncedStrategy(config);
  }

  // If single package specified either via mainPackage or packages
  if (config.mainPackage || config.packages?.length === 1) {
    return createSingleStrategy(config);
  }

  return createAsyncStrategy(config);
}

/**
 * Create a strategy map for easy lookup
 */
export function createStrategyMap(config: Config): Record<StrategyType, StrategyFunction> {
  return {
    synced: createSyncedStrategy(config),
    single: createSingleStrategy(config),
    async: createAsyncStrategy(config),
  };
}

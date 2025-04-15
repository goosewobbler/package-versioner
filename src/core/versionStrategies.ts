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
import { formatCommitMessage, formatTag, formatTagPrefix } from '../utils/formatting.js';
import { log } from '../utils/logging.js';
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

  // Skip packages explicitly excluded
  if (config.skip?.includes(pkgName)) {
    return false;
  }

  // If no targets specified, process all non-skipped packages
  if (!targets || targets.length === 0) {
    return true;
  }

  // Otherwise, only process packages in targets list
  return targets.includes(pkgName);
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
      } = config;

      // Calculate version for root package first
      const formattedPrefix = formatTagPrefix(versionPrefix || 'v');
      const latestTag = await getLatestTag();

      // Calculate the next version
      const nextVersion = await calculateVersion(config, {
        latestTag,
        versionPrefix: formattedPrefix,
        branchPattern,
        baseBranch,
        prereleaseIdentifier,
      });

      if (!nextVersion) {
        log('No version change needed', 'info');
        return;
      }

      const files: string[] = [];
      const updatedPackages: string[] = [];

      // Update root package.json if exists
      try {
        const rootPkgPath = path.join(packages.root, 'package.json');
        if (fs.existsSync(rootPkgPath)) {
          updatePackageVersion(rootPkgPath, nextVersion);

          files.push(rootPkgPath);
          updatedPackages.push('root');
        }
      } catch (_error) {
        log('Failed to update root package.json', 'error');
      }

      // Update all workspace packages
      for (const pkg of packages.packages) {
        if (!shouldProcessPackage(pkg, config)) {
          continue;
        }

        const packageJsonPath = path.join(pkg.dir, 'package.json');
        updatePackageVersion(packageJsonPath, nextVersion);

        files.push(packageJsonPath);
        updatedPackages.push(pkg.packageJson.name);
      }

      // Log updated packages
      if (updatedPackages.length > 0) {
        log(`Updated ${updatedPackages.length} package(s) to version ${nextVersion}`, 'success');
      } else {
        log('No packages were updated', 'warning');
        return;
      }

      // Create tag using the template
      const nextTag = formatTag(nextVersion, formattedPrefix, null, tagTemplate);
      const formattedCommitMessage = formatCommitMessage(commitMessage, nextVersion);

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
        versionPrefix,
        tagTemplate,
        packageTagTemplate,
        commitMessage = 'chore(release): ${version}',
        dryRun,
        skipHooks,
      } = config;

      if (!configPackages || configPackages.length !== 1) {
        throw createVersionError(
          VersionErrorCode.INVALID_CONFIG,
          'Single mode requires exactly one package name',
        );
      }

      const packageName = configPackages[0];
      const pkg = packages.packages.find((p) => p.packageJson.name === packageName);

      if (!pkg) {
        throw createVersionError(VersionErrorCode.PACKAGE_NOT_FOUND, packageName);
      }

      const pkgPath = pkg.dir;
      const formattedPrefix = formatTagPrefix(versionPrefix || 'v');

      // Try to get the latest tag specific to this package first
      let latestTagResult = await getLatestTagForPackage(packageName, formattedPrefix);

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
        packageTagTemplate,
      );
      const formattedCommitMessage = formatCommitMessage(commitMessage, nextVersion);

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
    packageTagTemplate: config.packageTagTemplate,
    commitMessageTemplate: config.commitMessage || '',
    dryRun: config.dryRun || false,
    skipHooks: config.skipHooks || false,
    getLatestTag: dependencies.getLatestTag,
    fullConfig: config,
    config: {
      branchPattern: config.branchPattern || [],
      baseBranch: config.baseBranch || 'main',
      prereleaseIdentifier: config.prereleaseIdentifier,
      forceType: config.forceType,
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

  if (config.packages?.length === 1) {
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

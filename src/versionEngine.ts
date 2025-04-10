import fs from 'node:fs';
import path from 'node:path';
import { cwd, exit } from 'node:process';

import { type Package, type Packages, getPackagesSync } from '@manypkg/get-packages';
import { Bumper } from 'conventional-recommended-bump';
import semver from 'semver';

import type { ReleaseType } from 'semver';
import type { Config, VersionOptions } from './types.js';
import {
  formatCommitMessage,
  formatTag,
  formatTagPrefix,
  getCommitsLength,
  getCurrentBranch,
  getLatestTag,
  gitProcess,
  lastMergeBranchName,
  log,
  updatePackageVersion,
} from './utils.js';

// Define extended type that includes root property
export interface PackagesWithRoot extends Packages {
  root: string;
}

/**
 * Main versioning engine that implements the strategy pattern for different versioning approaches
 */
export class VersionEngine {
  private config: Config;

  constructor(config: Config) {
    this.config = config;
  }

  /**
   * Calculate the next version based on options
   */
  private async calculateVersion(options: VersionOptions): Promise<string> {
    const { latestTag, tagPrefix, type, path, name, branchPattern, prereleaseIdentifier } = options;

    // If we already have a specific type (from conventional-commits)
    if (type) {
      if (!latestTag) {
        return prereleaseIdentifier ? `0.0.1-${prereleaseIdentifier}` : '0.0.1';
      }

      const version =
        semver.clean(latestTag.replace(`${tagPrefix}${name ? `${name}@` : 'v'}`, '')) || '0.0.0';
      return semver.inc(version, type, prereleaseIdentifier) || '';
    }

    // Use branch pattern versioning
    if (
      this.config.versionStrategy === 'branchPattern' &&
      branchPattern &&
      branchPattern.length > 0
    ) {
      const currentBranch = await getCurrentBranch();
      const mergeBranch = await lastMergeBranchName(branchPattern, this.config.baseBranch);
      const branch = mergeBranch || currentBranch;

      console.log('calculateVersion', mergeBranch, currentBranch);

      for (const pattern of branchPattern) {
        console.log('calculateVersion', pattern);
        const [match, releaseType] = pattern.split(':');
        console.log('calculateVersion', branch, match, releaseType);
        if (branch.includes(match) && releaseType) {
          if (!latestTag) {
            return prereleaseIdentifier ? `0.0.1-${prereleaseIdentifier}` : '0.0.1';
          }

          const version =
            semver.clean(latestTag.replace(`${tagPrefix}${name ? `${name}@` : 'v'}`, '')) ||
            '0.0.0';
          return semver.inc(version, releaseType as ReleaseType, prereleaseIdentifier) || '';
        }
      }
    }

    // Fall back to conventional-commits
    try {
      if (path) {
        const commitsLength = await getCommitsLength(path);

        if (commitsLength === 0) {
          log('info', `No commits found for ${name || 'project'}, skipping version bump`);
          return '';
        }
      }

      // Call conventionalRecommendedBump with correct options
      const bumper = new Bumper();
      bumper.loadPreset(this.config.preset);
      const recommendedBump = await bumper.bump();

      const releaseType = recommendedBump.releaseType as ReleaseType;

      if (!latestTag) {
        return prereleaseIdentifier ? `0.0.1-${prereleaseIdentifier}` : '0.0.1';
      }

      const version =
        semver.clean(latestTag.replace(`${tagPrefix}${name ? `${name}@` : 'v'}`, '')) || '0.0.0';
      return semver.inc(version, releaseType, prereleaseIdentifier) || '';
    } catch (error) {
      log('error', `Failed to calculate version for ${name || 'project'}`);
      console.error(error);
      return '';
    }
  }

  /**
   * Process all packages and update their versions
   */
  private async processPackages(
    packages: Package[] = [],
    configPackages: string[] = [],
  ): Promise<string[]> {
    const { tagPrefix } = this.config;

    const pkgsResult = packages.length
      ? { packages }
      : (getPackagesSync(cwd()) as PackagesWithRoot);
    const files: string[] = [];
    const selectedPackages = pkgsResult.packages.filter((pkg: Package) => {
      if (this.config.skip?.includes(pkg.packageJson.name)) {
        return false;
      }

      return configPackages.length === 0 || configPackages.includes(pkg.packageJson.name);
    });

    for (const pkg of selectedPackages) {
      const name = pkg.packageJson.name;
      const pkgPath = pkg.dir;
      const prefix = formatTagPrefix(tagPrefix);
      const latestTag = await getLatestTag();

      const nextVersion = await this.calculateVersion({
        latestTag,
        tagPrefix: prefix,
        path: pkgPath,
        name,
        branchPattern: this.config.branchPattern,
        baseBranch: this.config.baseBranch,
        prereleaseIdentifier: this.config.prereleaseIdentifier,
      });

      if (!nextVersion) {
        continue;
      }

      updatePackageVersion({
        path: pkgPath,
        version: nextVersion,
        name,
      });

      files.push(path.join(pkgPath, 'package.json'));
    }

    return files;
  }

  /**
   * Create git commit and tag
   */
  private async createGitCommitAndTag(
    files: string[],
    nextTag: string,
    commitMessage: string,
  ): Promise<void> {
    try {
      await gitProcess({
        files,
        nextTag,
        commitMessage,
        skipHooks: this.config.skipHooks,
      });

      log('success', `Created tag: ${nextTag}`);
    } catch (error) {
      log('error', 'Failed to create git commit and tag');
      console.error(error);
      exit(1);
    }
  }

  /**
   * Synced versioning strategy (all packages get the same version)
   */
  public async syncedStrategy(): Promise<void> {
    const {
      tagPrefix,
      baseBranch,
      branchPattern,
      commitMessage = 'chore(release): v${version}',
      prereleaseIdentifier,
    } = this.config;

    // Calculate version for root package first
    const prefix = formatTagPrefix(tagPrefix);
    const latestTag = await getLatestTag();
    const nextVersion = await this.calculateVersion({
      latestTag,
      tagPrefix: prefix,
      branchPattern,
      baseBranch,
      prereleaseIdentifier,
    });

    if (!nextVersion) {
      log('info', 'No version change needed');
      return;
    }

    // Now update all packages to this version
    let pkgsResult: PackagesWithRoot;
    try {
      pkgsResult = getPackagesSync(cwd()) as PackagesWithRoot;
      if (!pkgsResult || !pkgsResult.packages) {
        throw new Error('Failed to get packages information');
      }
    } catch (error) {
      log('error', 'Failed to get packages information');
      console.error(error);
      exit(1);
      return; // This is unreachable but helps TypeScript understand pkgsResult is defined below
    }

    const files: string[] = [];

    // Update root package.json if exists
    try {
      const rootPkgPath = path.join(pkgsResult.root, 'package.json');
      if (fs.existsSync(rootPkgPath)) {
        updatePackageVersion({
          path: pkgsResult.root,
          version: nextVersion,
          name: 'root',
        });

        files.push(rootPkgPath);
      }
    } catch (_error) {
      log('error', 'Failed to update root package.json');
    }

    // Update all workspace packages
    for (const pkg of pkgsResult.packages) {
      if (this.config.skip?.includes(pkg.packageJson.name)) {
        continue;
      }

      updatePackageVersion({
        path: pkg.dir,
        version: nextVersion,
        name: pkg.packageJson.name,
      });

      files.push(path.join(pkg.dir, 'package.json'));
    }

    // Create commit and tag
    const nextTag = formatTag(
      { synced: true, tagPrefix },
      { tagPrefix: prefix, version: nextVersion },
    );
    const formattedCommitMessage = formatCommitMessage(commitMessage, nextVersion);

    await this.createGitCommitAndTag(files, nextTag, formattedCommitMessage);
  }

  /**
   * Single package versioning strategy
   */
  public async singleStrategy(): Promise<void> {
    const {
      packages: configPackages,
      tagPrefix,
      commitMessage = 'chore(release): ${version}',
    } = this.config;

    if (configPackages.length !== 1) {
      log('error', 'Single mode requires exactly one package name');
      exit(1);
    }

    const packageName = configPackages[0];

    let pkgsResult: PackagesWithRoot;
    try {
      pkgsResult = getPackagesSync(cwd()) as PackagesWithRoot;
      if (!pkgsResult || !pkgsResult.packages) {
        throw new Error('Failed to get packages information');
      }
    } catch (error) {
      log('error', 'Failed to get packages information');
      console.error(error);
      exit(1);
      return; // This is unreachable but helps TypeScript understand pkgsResult is defined below
    }

    const pkg = pkgsResult.packages.find((p: Package) => p.packageJson.name === packageName);

    if (!pkg) {
      log('error', `Package ${packageName} not found`);
      exit(1);
    }

    const pkgPath = pkg.dir;
    const prefix = formatTagPrefix(tagPrefix);
    const latestTag = await getLatestTag();

    const nextVersion = await this.calculateVersion({
      latestTag,
      tagPrefix: prefix,
      path: pkgPath,
      name: packageName,
    });

    if (!nextVersion) {
      log('info', `No version change needed for ${packageName}`);
      return;
    }

    updatePackageVersion({
      path: pkgPath,
      version: nextVersion,
      name: packageName,
    });

    const nextTag = formatTag(
      { tagPrefix, name: packageName, synced: false },
      { tagPrefix: prefix, version: nextVersion },
    );
    const formattedCommitMessage = formatCommitMessage(commitMessage, nextVersion);

    await this.createGitCommitAndTag([`${pkgPath}/package.json`], nextTag, formattedCommitMessage);
  }

  /**
   * Async versioning strategy (each package gets its own version)
   */
  public async asyncStrategy(): Promise<void> {
    const {
      packages: configPackages,
      commitMessage = 'chore(release): ${version}',
      skipHooks,
    } = this.config;

    let pkgsResult: PackagesWithRoot;
    try {
      pkgsResult = getPackagesSync(cwd()) as PackagesWithRoot;
      if (!pkgsResult || !pkgsResult.packages) {
        throw new Error('Failed to get packages information');
      }
    } catch (error) {
      log('error', 'Failed to get packages information');
      console.error(error);
      exit(1);
      return; // This is unreachable but helps TypeScript understand pkgsResult is defined below
    }

    // Get packages to process
    const pkgsToProcess = await this.processPackages(pkgsResult.packages, configPackages);

    // No packages to process
    if (pkgsToProcess.length === 0) {
      log('info', 'No packages to process');
      return;
    }

    const formattedCommitMessage = commitMessage;

    try {
      await gitProcess({
        files: pkgsToProcess,
        nextTag: '', // No tag for async strategy
        commitMessage: formattedCommitMessage,
        skipHooks,
      });

      log('success', 'Created version commit');
    } catch (error) {
      log('error', 'Failed to create version commit');
      console.error(error);
      exit(1);
    }
  }
}

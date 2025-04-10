import fs from 'node:fs';
import path from 'node:path';
import { cwd, exit } from 'node:process';

import { type Package, type Packages, getPackagesSync } from '@manypkg/get-packages';
import { Bumper } from 'conventional-recommended-bump';
import semver from 'semver';

import type { ReleaseType } from 'semver';
import type { Config, VersionOptions } from './types.js';
import {
  createGitTag,
  formatCommitMessage,
  formatTag,
  formatTagPrefix,
  getCommitsLength,
  getCurrentBranch,
  getLatestTag,
  gitAdd,
  gitCommit,
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
    const { latestTag, type, path, name, branchPattern, prereleaseIdentifier } = options;
    // Get the ORIGINAL prefix from the config for pattern matching
    const originalPrefix = this.config.tagPrefix || ''; // Default to empty string

    const initialVersion = prereleaseIdentifier ? `0.0.1-${prereleaseIdentifier}` : '0.0.1';

    // Correctly determine tag search pattern using the ORIGINAL prefix
    const tagSearchPattern = name
      ? originalPrefix
        ? `${originalPrefix}${name}@`
        : `${name}@`
      : originalPrefix
        ? `${originalPrefix}v`
        : 'v';

    let determinedReleaseType: ReleaseType | null = type || null;

    // 1. Handle specific type if provided
    if (determinedReleaseType) {
      if (!latestTag) {
        return initialVersion;
      }
      const currentVersion = semver.clean(latestTag.replace(tagSearchPattern, '')) || '0.0.0';
      return semver.inc(currentVersion, determinedReleaseType, prereleaseIdentifier) || '';
    }

    // 2. Handle branch pattern versioning (if configured)
    if (this.config.versionStrategy === 'branchPattern' && branchPattern?.length) {
      const currentBranch = await getCurrentBranch();
      const mergeBranch = await lastMergeBranchName(branchPattern, this.config.baseBranch);
      const branch = mergeBranch || currentBranch;

      for (const pattern of branchPattern) {
        const [match, releaseType] = pattern.split(':');
        if (branch.includes(match) && releaseType) {
          determinedReleaseType = releaseType as ReleaseType;
          break; // Found matching branch pattern
        }
      }

      if (determinedReleaseType) {
        if (!latestTag) {
          return initialVersion;
        }
        const currentVersion = semver.clean(latestTag.replace(tagSearchPattern, '')) || '0.0.0';
        return semver.inc(currentVersion, determinedReleaseType, prereleaseIdentifier) || '';
      }
    }

    // 3. Fallback to conventional-commits
    try {
      const bumper = new Bumper();
      bumper.loadPreset(this.config.preset);
      const recommendedBump = await bumper.bump();
      const releaseTypeFromCommits = recommendedBump.releaseType as ReleaseType | undefined;

      if (!latestTag) {
        // No tags yet, return initial version
        return initialVersion;
      }

      // If tags exist, check for new commits since the last tag
      // Use path if provided, otherwise check the whole repo (cwd)
      const checkPath = path || cwd();
      const commitsLength = await getCommitsLength(checkPath); // Uses git describe internally
      if (commitsLength === 0) {
        log(
          'info',
          `No new commits found for ${name || 'project'} since ${latestTag}, skipping version bump`,
        );
        return ''; // No change needed
      }

      // If tags exist AND there are new commits, calculate the next version
      if (!releaseTypeFromCommits) {
        log(
          'info',
          `No relevant commits found for ${name || 'project'} since ${latestTag}, skipping version bump`,
        );
        return ''; // No bump indicated by conventional commits
      }

      const currentVersion = semver.clean(latestTag.replace(tagSearchPattern, '')) || '0.0.0';
      return semver.inc(currentVersion, releaseTypeFromCommits, prereleaseIdentifier) || '';
    } catch (error) {
      // Handle errors during conventional bump calculation
      log('error', `Failed to calculate version for ${name || 'project'}`);
      console.error(error);
      // Check if the error is specifically due to no tags found by underlying git commands
      if (error instanceof Error && error.message.includes('No names found')) {
        log('info', 'No tags found, proceeding with initial version calculation (if applicable).');
        // If conventional bump failed *because* of no tags, return initial version
        return initialVersion;
      }
      return ''; // Return empty on other errors
    }
  }

  /**
   * Process packages based on discovery, skip list, and optional target list.
   * Returns a list of package.json file paths that were updated (or would be in dry run).
   */
  private async processPackages(
    discoveredPackages: Package[] = [],
    targets: string[] = [],
  ): Promise<string[]> {
    const { tagPrefix, skip, dryRun } = this.config;
    const files: string[] = [];

    // Determine which packages to consider based on targets and skip list
    const pkgsToConsider = discoveredPackages.filter((pkg: Package) => {
      // Always skip packages in the skip list
      if (skip?.includes(pkg.packageJson.name)) {
        log('info', `Skipping package ${pkg.packageJson.name} based on config skip list.`);
        return false;
      }
      // If targets are provided, only include packages matching a target
      if (targets.length > 0) {
        const isTargeted = targets.includes(pkg.packageJson.name);
        if (!isTargeted) {
          // log('info', `Skipping package ${pkg.packageJson.name} as it is not in the target list.`);
        }
        return isTargeted;
      }
      // If no targets are provided, include all non-skipped packages
      return true;
    });

    log('info', `Found ${pkgsToConsider.length} package(s) to process after filtering.`);

    for (const pkg of pkgsToConsider) {
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
        type: this.config.forceType,
      });

      if (!nextVersion) {
        continue;
      }

      updatePackageVersion({
        path: pkgPath,
        version: nextVersion,
        name,
        dryRun: dryRun,
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
    dryRun?: boolean,
  ): Promise<void> {
    try {
      await gitProcess({
        files,
        nextTag,
        commitMessage,
        skipHooks: this.config.skipHooks,
        dryRun,
      });

      if (!dryRun) {
        log('success', `Created tag: ${nextTag}`);
      }
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
          dryRun: this.config.dryRun,
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
        dryRun: this.config.dryRun,
      });

      files.push(path.join(pkg.dir, 'package.json'));
    }

    // Create commit and tag
    const nextTag = formatTag(
      { synced: true, tagPrefix },
      { tagPrefix: prefix, version: nextVersion },
    );
    const formattedCommitMessage = formatCommitMessage(commitMessage, nextVersion);

    await this.createGitCommitAndTag(files, nextTag, formattedCommitMessage, this.config.dryRun);
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

    // biome-ignore lint/style/noVar: Need let for try/catch assignment
    let nextVersion = ''; // Initialize, type inferred
    try {
      // Wrap calculateVersion in try/catch
      nextVersion = await this.calculateVersion({
        latestTag,
        tagPrefix: prefix,
        path: pkgPath,
        name: packageName,
      });
    } catch (error) {
      // Log error similar to how calculateVersion does, but ensure flow continues
      log('error', `Failed to calculate version for ${packageName}`);
      console.error(error);
      // nextVersion remains ''
    }

    if (!nextVersion) {
      log('info', `No version change needed for ${packageName}`);
      return;
    }

    updatePackageVersion({
      path: pkgPath,
      version: nextVersion,
      name: packageName,
      dryRun: this.config.dryRun,
    });

    const nextTag = formatTag(
      { tagPrefix, name: packageName, synced: false },
      { tagPrefix: prefix, version: nextVersion },
    );
    const formattedCommitMessage = formatCommitMessage(commitMessage, nextVersion);

    await this.createGitCommitAndTag(
      [path.join(pkgPath, 'package.json')],
      nextTag,
      formattedCommitMessage,
      this.config.dryRun,
    );
  }

  /**
   * Async versioning strategy (each package gets its own version)
   */
  public async asyncStrategy(cliTargets: string[] = []): Promise<void> {
    // --- Route to new targeted strategy if targets are provided ---
    if (cliTargets.length > 0) {
      await this.asyncTargetedStrategy(cliTargets);
      return; // Exit after targeted strategy is done
    }

    // --- Original async logic (when no targets are provided) ---
    const {
      commitMessage = 'chore(release): ${version}', // Align with test expectations
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
      return;
    }

    // Get packages to process (returns file paths)
    const pkgsToProcess = await this.processPackages(pkgsResult.packages, cliTargets); // cliTargets will be empty here

    if (pkgsToProcess.length === 0) {
      log('info', 'No packages to process based on changes and targets');
      return;
    }

    const formattedCommitMessage = commitMessage;

    try {
      // Use original gitProcess which handles commit only (no tags for default async)
      await gitProcess({
        files: pkgsToProcess,
        nextTag: '', // No tag for default async
        commitMessage: formattedCommitMessage,
        skipHooks,
        dryRun: this.config.dryRun,
      });

      if (!this.config.dryRun) {
        log('success', `Created version commit for ${pkgsToProcess.length} package(s)`);
      }
    } catch (error) {
      log('error', 'Failed to create version commit');
      console.error(error);
      exit(1);
    }
  }

  // --- NEW METHOD for Async + Targeted ---
  private async asyncTargetedStrategy(cliTargets: string[]): Promise<void> {
    const {
      tagPrefix,
      skip,
      dryRun,
      skipHooks,
      commitMessage: commitMessageTemplate,
    } = this.config;
    const updatedPackagesInfo: Array<{ name: string; version: string; path: string }> = [];

    log('info', `Processing targeted packages: ${cliTargets.join(', ')}`);

    // 1. Get all packages
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
      return;
    }

    // 2. Filter packages based on targets and skip list
    const pkgsToConsider = pkgsResult.packages.filter((pkg: Package) => {
      if (skip?.includes(pkg.packageJson.name)) {
        log('info', `Skipping package ${pkg.packageJson.name} based on config skip list.`);
        return false;
      }
      // Only include if it's in the cliTargets list
      const isTargeted = cliTargets.includes(pkg.packageJson.name);
      if (!isTargeted) {
        // log('info', `Skipping package ${pkg.packageJson.name} as it is not targeted.`);
      }
      return isTargeted;
    });

    log('info', `Found ${pkgsToConsider.length} targeted package(s) to process after filtering.`);

    if (pkgsToConsider.length === 0) {
      log('info', 'No matching targeted packages found to process.');
      return;
    }

    // 3. Process each targeted package
    for (const pkg of pkgsToConsider) {
      const name = pkg.packageJson.name;
      const pkgPath = pkg.dir;
      const prefix = formatTagPrefix(tagPrefix);
      const latestTag = await getLatestTag(); // Still potentially repo-global

      const nextVersion = await this.calculateVersion({
        latestTag,
        tagPrefix: prefix,
        path: pkgPath,
        name,
        branchPattern: this.config.branchPattern,
        baseBranch: this.config.baseBranch,
        prereleaseIdentifier: this.config.prereleaseIdentifier,
        type: this.config.forceType,
      });

      if (!nextVersion) {
        continue; // No version change calculated for this package
      }

      // Update package.json
      updatePackageVersion({
        path: pkgPath,
        version: nextVersion,
        name,
        dryRun: dryRun,
      });

      // Create package-specific tag
      const packageTag = formatTag(
        { synced: false, name, tagPrefix },
        { version: nextVersion, tagPrefix },
      );
      const tagMessage = `chore(release): ${name} ${nextVersion}`;

      if (!dryRun) {
        try {
          await createGitTag({ tag: packageTag, message: tagMessage });
          log('success', `Created tag: ${packageTag}`);
        } catch (tagError) {
          log('error', `Failed to create tag ${packageTag} for ${name}`);
          console.error(tagError);
          // Continue processing other packages even if tagging fails?
        }
      } else {
        log('info', `[DRY RUN] Would create tag: ${packageTag}`);
      }

      // Collect info for the final commit
      updatedPackagesInfo.push({ name, version: nextVersion, path: pkgPath });
    }

    // 4. Create single commit if any packages were updated
    if (updatedPackagesInfo.length === 0) {
      log('info', 'No targeted packages required a version update.');
      return;
    }

    const filesToCommit = updatedPackagesInfo.map((info) => path.join(info.path, 'package.json'));
    const packageNames = updatedPackagesInfo.map((p) => p.name).join(', ');
    // Use the version from the first updated package as representative
    const representativeVersion = updatedPackagesInfo[0]?.version || 'multiple';
    let commitMessage = commitMessageTemplate || 'chore(release): publish packages';

    // Construct commit message: Use template if only one package, otherwise list names.
    if (updatedPackagesInfo.length === 1 && commitMessage.includes('${version}')) {
      // If template has ${version} and only one package, format it
      commitMessage = formatCommitMessage(commitMessage, representativeVersion);
    } else {
      // Otherwise, use a generic message listing packages and representative version
      commitMessage = `chore(release): ${packageNames} ${representativeVersion}`;
    }
    commitMessage += ' [skip-ci]'; // Add skip-ci trailer

    if (!dryRun) {
      try {
        await gitAdd(filesToCommit);
        await gitCommit({ message: commitMessage, skipHooks });
        log('success', `Created commit for targeted release: ${packageNames}`);
      } catch (commitError) {
        log('error', 'Failed to create commit for targeted release.');
        console.error(commitError);
        exit(1); // Exit if commit fails
      }
    } else {
      log('info', '[DRY RUN] Would add files:');
      for (const file of filesToCommit) {
        log('info', `  - ${file}`);
      }
      log('info', `[DRY RUN] Would commit with message: "${commitMessage}"`);
    }
  }
}

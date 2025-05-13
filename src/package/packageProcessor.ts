import * as fs from 'node:fs';
import path from 'node:path';
import { exit } from 'node:process';
import type { Package } from '@manypkg/get-packages';
import { type ChangelogEntry, updateChangelog } from '../changelog/changelogManager.js';
import { extractChangelogEntriesFromCommits } from '../changelog/commitParser.js';
import { calculateVersion } from '../core/versionCalculator.js';
import { createGitTag, gitAdd, gitCommit } from '../git/commands.js';
import { getLatestTagForPackage } from '../git/tagsAndBranches.js';
import type { Config, VersionConfigBase } from '../types.js';
import { formatCommitMessage, formatTag, formatVersionPrefix } from '../utils/formatting.js';
import { addTag, setCommitMessage } from '../utils/jsonOutput.js';
import { log } from '../utils/logging.js';
import { getVersionFromManifests } from '../utils/manifestHelpers.js';
import { updatePackageVersion } from './packageManagement.js';

export interface PackageProcessorOptions {
  skip?: string[];
  targets?: string[];
  versionPrefix?: string;
  tagTemplate?: string;
  packageTagTemplate?: string;
  commitMessageTemplate?: string;
  dryRun?: boolean;
  skipHooks?: boolean;
  getLatestTag: () => Promise<string | null>;
  config: Omit<VersionConfigBase, 'versionPrefix' | 'path' | 'name'>;
  // Config needed for version calculation
  fullConfig: Config;
}

export interface ProcessResult {
  updatedPackages: Array<{
    name: string;
    version: string;
    path: string;
  }>;
  commitMessage?: string;
  tags: string[];
}

export class PackageProcessor {
  private skip: string[];
  private targets: string[];
  private versionPrefix: string;
  private tagTemplate?: string;
  private packageTagTemplate?: string;
  private commitMessageTemplate: string;
  private dryRun: boolean;
  private skipHooks: boolean;
  private getLatestTag: () => Promise<string | null>;
  private config: Omit<VersionConfigBase, 'versionPrefix' | 'path' | 'name'>;
  // Config for version calculation
  private fullConfig: Config;

  constructor(options: PackageProcessorOptions) {
    this.skip = options.skip || [];
    this.targets = options.targets || [];
    this.versionPrefix = options.versionPrefix || 'v';
    this.tagTemplate = options.tagTemplate;
    this.packageTagTemplate = options.packageTagTemplate;
    this.commitMessageTemplate = options.commitMessageTemplate || '';
    this.dryRun = options.dryRun || false;
    this.skipHooks = options.skipHooks || false;
    this.getLatestTag = options.getLatestTag;
    this.config = options.config;
    this.fullConfig = options.fullConfig;
  }

  /**
   * Set package targets to process
   */
  setTargets(targets: string[]): void {
    this.targets = targets;
  }

  /**
   * Process packages based on targeting criteria
   */
  async processPackages(packages: Package[]): Promise<ProcessResult> {
    const tags: string[] = [];
    const updatedPackagesInfo: Array<{ name: string; version: string; path: string }> = [];

    // 1. Basic validation
    if (!packages || !Array.isArray(packages)) {
      log('Invalid packages data provided. Expected array of packages.', 'error');
      return { updatedPackages: [], tags: [] };
    }

    // 2. Apply filtering to determine which packages to process
    const pkgsToConsider = packages.filter((pkg) => {
      const pkgName = pkg.packageJson.name;

      // Skip packages explicitly excluded
      if (this.skip?.includes(pkgName)) {
        log(`Skipping package ${pkgName} as it's in the skip list.`, 'info');
        return false;
      }

      // If targets is empty, process all non-skipped packages
      if (!this.targets || this.targets.length === 0) {
        return true;
      }

      // Otherwise, only process packages explicitly targeted
      const isTargeted = this.targets.includes(pkgName);
      if (!isTargeted) {
        log(`Package ${pkgName} not in target list, skipping.`, 'info');
      }
      return isTargeted;
    });

    log(`Found ${pkgsToConsider.length} targeted package(s) to process after filtering.`, 'info');

    if (pkgsToConsider.length === 0) {
      log('No matching targeted packages found to process.', 'info');
      return { updatedPackages: [], tags: [] };
    }

    // 3. Process each targeted package
    for (const pkg of pkgsToConsider) {
      const name = pkg.packageJson.name;
      const pkgPath = pkg.dir;
      const formattedPrefix = formatVersionPrefix(this.versionPrefix);
      // For package-specific tags, we may need to request package-specific version history
      // Try to get the latest tag specific to this package first
      let latestTagResult = '';
      try {
        latestTagResult = await getLatestTagForPackage(name, this.versionPrefix);
      } catch (error) {
        // Log the specific error, but continue with fallback
        const errorMessage = error instanceof Error ? error.message : String(error);
        log(
          `Error getting package-specific tag for ${name}, falling back to global tag: ${errorMessage}`,
          'warning',
        );
      }

      // Fallback to global tag if no package-specific tag exists
      if (!latestTagResult) {
        try {
          // First try the package manifest files as fallback
          const packageDir = pkgPath;
          let manifestFallbackUsed = false;

          // Use the centralized helper to check manifests
          const manifestResult = getVersionFromManifests(packageDir);
          if (manifestResult.manifestFound && manifestResult.version) {
            log(
              `Using ${manifestResult.manifestType} version ${manifestResult.version} for ${name} as no package-specific tags found`,
              'info',
            );
            log(
              `FALLBACK: Using package version from ${manifestResult.manifestType} instead of global tag`,
              'debug',
            );
            // We'll create a fake tag with this version to use as base
            latestTagResult = `${this.versionPrefix || ''}${manifestResult.version}`;
            manifestFallbackUsed = true;
          }

          // Only if we couldn't use either manifest file, try global tag
          if (!manifestFallbackUsed) {
            const globalTagResult = await this.getLatestTag();
            if (globalTagResult) {
              latestTagResult = globalTagResult;
              log(`Using global tag ${globalTagResult} as fallback for package ${name}`, 'info');
            }
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          log(`Error getting fallback version, using empty tag value: ${errorMessage}`, 'warning');
        }
      }

      // At this point, latestTagResult is guaranteed to be a string (possibly empty)
      const latestTag = latestTagResult;

      const nextVersion = await calculateVersion(this.fullConfig, {
        latestTag,
        versionPrefix: formattedPrefix,
        path: pkgPath,
        name,
        branchPattern: this.config.branchPattern,
        baseBranch: this.config.baseBranch,
        prereleaseIdentifier: this.config.prereleaseIdentifier,
        type: this.config.type,
      });

      if (!nextVersion) {
        continue; // No version change calculated for this package
      }

      // Generate changelog entries from conventional commits
      if (this.fullConfig.updateChangelog !== false) {
        // Extract changelog entries from commit messages
        let changelogEntries: ChangelogEntry[] = [];

        try {
          // Extract entries from commits between the latest tag and HEAD
          changelogEntries = extractChangelogEntriesFromCommits(pkgPath, latestTag);

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
          name,
          nextVersion,
          changelogEntries,
          repoUrl,
          this.fullConfig.changelogFormat,
        );
      }

      // Update both package.json and Cargo.toml if they exist.
      // Note: There is no priority between package.json and Cargo.toml.
      //       Both files are updated independently if they are present.
      //       Each manifest will receive the same calculated version.
      //       This ensures consistent versioning across language ecosystems.
      const packageJsonPath = path.join(pkgPath, 'package.json');

      // Always update package.json if it exists
      if (fs.existsSync(packageJsonPath)) {
        updatePackageVersion(packageJsonPath, nextVersion);
      }

      // Check if Cargo.toml handling is enabled (default to true if not specified)
      const cargoEnabled = this.fullConfig.cargo?.enabled !== false;

      if (cargoEnabled) {
        // Check for cargo paths configuration
        const cargoPaths = this.fullConfig.cargo?.paths;

        if (cargoPaths && cargoPaths.length > 0) {
          // If paths are specified, only include those Cargo.toml files
          for (const cargoPath of cargoPaths) {
            const resolvedCargoPath = path.resolve(pkgPath, cargoPath, 'Cargo.toml');
            if (fs.existsSync(resolvedCargoPath)) {
              updatePackageVersion(resolvedCargoPath, nextVersion);
            }
          }
        } else {
          // Default behavior: check for Cargo.toml in the root package directory
          const cargoTomlPath = path.join(pkgPath, 'Cargo.toml');
          if (fs.existsSync(cargoTomlPath)) {
            updatePackageVersion(cargoTomlPath, nextVersion);
          }
        }
      }

      // Create package-specific tag (using the updated formatTag function with package name)
      const packageTag = formatTag(
        nextVersion,
        this.versionPrefix,
        name,
        this.tagTemplate,
        this.packageTagTemplate,
      );
      const tagMessage = `chore(release): ${name} ${nextVersion}`;

      // Track tag for JSON output
      addTag(packageTag);
      tags.push(packageTag);

      if (!this.dryRun) {
        try {
          await createGitTag({ tag: packageTag, message: tagMessage });
          log(`Created tag: ${packageTag}`, 'success');
        } catch (tagError) {
          log(
            `Failed to create tag ${packageTag} for ${name}: ${(tagError as Error).message}`,
            'error',
          );
          log((tagError as Error).stack || 'No stack trace available', 'error');
          // Continue processing other packages even if tagging fails
        }
      } else {
        log(`[DRY RUN] Would create tag: ${packageTag}`, 'info');
      }

      // Collect info for the final commit
      updatedPackagesInfo.push({ name, version: nextVersion, path: pkgPath });
    }

    // 4. Create single commit if any packages were updated
    if (updatedPackagesInfo.length === 0) {
      log('No targeted packages required a version update.', 'info');
      return { updatedPackages: [], tags };
    }

    // Collect all files that need to be committed (both package.json and Cargo.toml)
    const filesToCommit: string[] = [];
    for (const info of updatedPackagesInfo) {
      const packageJsonPath = path.join(info.path, 'package.json');

      if (fs.existsSync(packageJsonPath)) {
        filesToCommit.push(packageJsonPath);
      }

      // Check if Cargo.toml handling is enabled (default to true if not specified)
      const cargoEnabled = this.fullConfig.cargo?.enabled !== false;

      if (cargoEnabled) {
        // Check for cargo paths configuration
        const cargoPaths = this.fullConfig.cargo?.paths;

        if (cargoPaths && cargoPaths.length > 0) {
          // If paths are specified, only include those Cargo.toml files
          for (const cargoPath of cargoPaths) {
            const resolvedCargoPath = path.resolve(info.path, cargoPath, 'Cargo.toml');
            if (fs.existsSync(resolvedCargoPath)) {
              filesToCommit.push(resolvedCargoPath);
            }
          }
        } else {
          // Default behavior: check for Cargo.toml in the root package directory
          const cargoTomlPath = path.join(info.path, 'Cargo.toml');
          if (fs.existsSync(cargoTomlPath)) {
            filesToCommit.push(cargoTomlPath);
          }
        }
      }
    }

    const packageNames = updatedPackagesInfo.map((p) => p.name).join(', ');
    // Use the version from the first updated package as representative
    const representativeVersion = updatedPackagesInfo[0]?.version || 'multiple';
    let commitMessage = this.commitMessageTemplate || 'chore(release): publish packages';

    // Construct commit message: Use template if only one package, otherwise list names.
    const placeholderRegex = /\$\{[^}]+\}/; // Matches placeholders like ${variableName}
    if (updatedPackagesInfo.length === 1 && placeholderRegex.test(commitMessage)) {
      // If template has any placeholders and only one package, format it with package name
      const packageName = updatedPackagesInfo[0].name;
      commitMessage = formatCommitMessage(commitMessage, representativeVersion, packageName);
    } else {
      // Otherwise, use a generic message listing packages and representative version
      commitMessage = `chore(release): ${packageNames} ${representativeVersion}`;
    }

    // Track commit message for JSON output
    setCommitMessage(commitMessage);

    if (!this.dryRun) {
      try {
        await gitAdd(filesToCommit);
        await gitCommit({ message: commitMessage, skipHooks: this.skipHooks });
        log(`Created commit for targeted release: ${packageNames}`, 'success');
      } catch (commitError) {
        log('Failed to create commit for targeted release.', 'error');
        console.error(commitError);
        exit(1); // Exit if commit fails
      }
    } else {
      log('[DRY RUN] Would add files:', 'info');
      for (const file of filesToCommit) {
        log(`  - ${file}`, 'info');
      }
      log(`[DRY RUN] Would commit with message: "${commitMessage}"`, 'info');
    }

    return {
      updatedPackages: updatedPackagesInfo,
      commitMessage,
      tags,
    };
  }
}

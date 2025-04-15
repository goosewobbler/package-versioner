import path from 'node:path';
import { exit } from 'node:process';
import type { Package } from '@manypkg/get-packages';
import type { ReleaseType } from 'semver';
import { calculateVersion } from '../core/versionCalculator.js';
import { createGitTag, gitAdd, gitCommit } from '../git/commands.js';
import { getLatestTagForPackage } from '../git/tagsAndBranches.js';
import type { Config } from '../types.js';
import { formatCommitMessage, formatTag, formatTagPrefix } from '../utils/formatting.js';
import { addTag, setCommitMessage } from '../utils/jsonOutput.js';
import { log } from '../utils/logging.js';
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
  config: {
    branchPattern?: string[];
    baseBranch?: string;
    prereleaseIdentifier?: string;
    forceType?: ReleaseType;
  };
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
  private config: {
    branchPattern?: string[];
    baseBranch?: string;
    prereleaseIdentifier?: string;
    forceType?: ReleaseType;
  };
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
      const formattedPrefix = formatTagPrefix(this.versionPrefix);
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
          const globalTagResult = await this.getLatestTag();
          latestTagResult = globalTagResult || '';
          if (globalTagResult) {
            log(`Using global tag ${globalTagResult} as fallback for package ${name}`, 'info');
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          log(`Error getting global tag, using empty tag value: ${errorMessage}`, 'warning');
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
        type: this.config.forceType,
      });

      if (!nextVersion) {
        continue; // No version change calculated for this package
      }

      // Update package.json
      updatePackageVersion(path.join(pkgPath, 'package.json'), nextVersion);

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

    const filesToCommit = updatedPackagesInfo.map((info) => path.join(info.path, 'package.json'));
    const packageNames = updatedPackagesInfo.map((p) => p.name).join(', ');
    // Use the version from the first updated package as representative
    const representativeVersion = updatedPackagesInfo[0]?.version || 'multiple';
    let commitMessage = this.commitMessageTemplate || 'chore(release): publish packages';

    // Construct commit message: Use template if only one package, otherwise list names.
    if (updatedPackagesInfo.length === 1 && commitMessage.includes('${version}')) {
      // If template has ${version} and only one package, format it
      commitMessage = formatCommitMessage(commitMessage, representativeVersion);
    } else {
      // Otherwise, use a generic message listing packages and representative version
      commitMessage = `chore(release): ${packageNames} ${representativeVersion}`;
    }
    commitMessage += ' [skip-ci]'; // Add skip-ci trailer

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

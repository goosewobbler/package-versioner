/**
 * Shared type definitions
 */

import type { ReleaseType } from 'semver';

/**
 * Git information for version calculation
 */
export interface GitInfo {
  currentBranch: string;
  mergeBranch?: string;
}

/**
 * Common version configuration properties shared between interfaces
 */
export interface VersionConfigBase {
  versionPrefix: string;
  type?: ReleaseType;
  prereleaseIdentifier?: string;
  branchPattern?: string[];
  baseBranch?: string;
  path?: string;
  name?: string;
}

/**
 * Configuration for the versioner
 */
export interface Config extends VersionConfigBase {
  // Tag formatting templates with default templates
  tagTemplate: string; // Default: '${prefix}${version}'
  packageTagTemplate: string; // Default: '${packageName}@${prefix}${version}'

  preset: string;
  synced: boolean;
  packages: string[];
  mainPackage?: string; // The package to use for version determination
  updateInternalDependencies: 'major' | 'minor' | 'patch' | 'no-internal-update';
  skip?: string[];
  commitMessage?: string;
  versionStrategy?: 'branchPattern' | 'commitMessage';
  branchPatterns?: BranchPattern[];
  defaultReleaseType?: ReleaseType;
  skipHooks?: boolean;
  dryRun?: boolean;
  latestTag?: string;
  updateChangelog?: boolean; // Whether to automatically generate and update changelogs
  changelogFormat?: 'keep-a-changelog' | 'angular'; // Format to use for changelogs
  // Cargo configuration options
  cargo?: {
    enabled?: boolean; // Default: true - Set to false to disable Cargo.toml version handling
    paths?: string[]; // Optional: Specify directories to search for Cargo.toml files
  };
}

/**
 * Branch pattern for version strategy
 */
export interface BranchPattern {
  pattern: string;
  releaseType: ReleaseType;
}

/**
 * Package JSON structure
 */
export type PkgJson = {
  name: string;
  version: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  path?: string;
};

/**
 * Cargo.toml structure
 */
export interface CargoToml {
  package?: {
    name: string;
    version?: string;
    authors?: string[];
    edition?: string;
    description?: string;
    repository?: string;
    license?: string;
    readme?: string;
    [key: string]: unknown;
  };
  dependencies?: Record<string, string | CargoDepSpec>;
  dev_dependencies?: Record<string, string | CargoDepSpec>;
  [key: string]: unknown;
}

/**
 * Cargo dependency specification
 */
export interface CargoDepSpec {
  version?: string;
  path?: string;
  git?: string;
  branch?: string;
  tag?: string;
  rev?: string;
  features?: string[];
  optional?: boolean;
  default_features?: boolean;
  [key: string]: unknown;
}

/**
 * Git tag formatting options
 */
export interface TagFormat {
  tagTemplate?: string;
  packageTagTemplate?: string;
  prefix?: string;
  name?: string;
  synced: boolean;
}

/**
 * Tag properties for format functions
 */
export interface TagProps {
  prefix: string;
  version: string;
  packageName?: string;
}

/**
 * Version calculation options
 */
export interface VersionOptions extends VersionConfigBase {
  latestTag: string;
}

/**
 * Git process options
 */
export interface GitProcess {
  files: string[];
  nextTag: string;
  commitMessage: string;
  skipHooks?: boolean;
  dryRun?: boolean;
}

/**
 * Package version update options
 */
export interface PackageVersion {
  path: string;
  version: string;
  name: string;
  dryRun?: boolean;
}

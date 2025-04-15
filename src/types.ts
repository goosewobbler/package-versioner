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
 * Configuration for the versioner
 */
export interface Config {
  // Tag formatting templates with default templates
  tagTemplate: string; // Default: '${prefix}${version}'
  packageTagTemplate: string; // Default: '${packageName}@${prefix}${version}'
  versionPrefix: string; // Used in templates

  preset: string;
  baseBranch: string;
  synced: boolean;
  packages: string[];
  updateInternalDependencies: 'major' | 'minor' | 'patch' | 'no-internal-update';
  skip?: string[];
  commitMessage?: string;
  versionStrategy?: 'branchPattern' | 'commitMessage';
  branchPattern: string[];
  branchPatterns?: BranchPattern[];
  defaultReleaseType?: ReleaseType;
  prereleaseIdentifier?: string;
  skipHooks?: boolean;
  dryRun?: boolean;
  forceType?: ReleaseType;
  latestTag?: string;
  type?: ReleaseType;
  path?: string;
  name?: string;
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
export interface VersionOptions {
  latestTag: string;
  versionPrefix: string;
  type?: ReleaseType;
  path?: string;
  name?: string;
  branchPattern?: string[];
  baseBranch?: string;
  prereleaseIdentifier?: string;
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

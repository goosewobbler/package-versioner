/**
 * Shared type definitions
 */

import type { ReleaseType } from 'semver';

/**
 * Configuration for the versioner
 */
export interface Config {
  tagPrefix: string;
  preset: string;
  baseBranch: string;
  synced: boolean;
  packages: string[];
  updateInternalDependencies: 'major' | 'minor' | 'patch' | 'no-internal-update';
  skip?: string[];
  commitMessage?: string;
  versionStrategy?: 'branchPattern' | 'commitMessage';
  branchPattern: string[];
  prereleaseIdentifier?: string;
  skipHooks?: boolean;
  dryRun?: boolean;
  forceType?: ReleaseType;
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
  tagPrefix?: string;
  name?: string;
  synced: boolean;
}

/**
 * Tag properties for format functions
 */
export interface TagProps {
  tagPrefix: string;
  version: string;
}

/**
 * Version calculation options
 */
export interface VersionOptions {
  latestTag: string;
  tagPrefix: string;
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

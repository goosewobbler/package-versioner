/**
 * Package management utilities for package-versioner
 */

import fs from 'node:fs';
import path from 'node:path';
import type { PkgJson } from '../types.js';
import { addPackageUpdate } from '../utils/jsonOutput.js';
import { log } from '../utils/logging.js';

// Define the PackageInfo interface here for internal use
export interface PackageInfo {
  name: string;
  version: string;
  path: string;
  dir: string;
  content: PkgJson;
}

/**
 * Get package info from package.json
 */
export function getPackageInfo(pkgPath: string): PackageInfo {
  if (!fs.existsSync(pkgPath)) {
    log(`Package file not found at: ${pkgPath}`, 'error');
    process.exit(1);
  }

  try {
    const fileContent = fs.readFileSync(pkgPath, 'utf8');
    const pkg = JSON.parse(fileContent);

    if (!pkg.name) {
      log(`Package name not found in: ${pkgPath}`, 'error');
      process.exit(1);
    }

    return {
      name: pkg.name,
      version: pkg.version || '0.0.0',
      path: pkgPath,
      dir: path.dirname(pkgPath),
      content: pkg,
    };
  } catch (error) {
    log(`Error reading package: ${pkgPath}`, 'error');
    if (error instanceof Error) {
      log(error.message, 'error');
    }
    process.exit(1);
  }
}

/**
 * Update a package.json file with a new version
 */
export function updatePackageVersion(packagePath: string, version: string): void {
  try {
    const packageContent = fs.readFileSync(packagePath, 'utf8');
    const packageJson = JSON.parse(packageContent);
    const packageName = packageJson.name;

    packageJson.version = version;
    fs.writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);

    // Track update for JSON output
    addPackageUpdate(packageName, version, packagePath);

    log(`Updated package.json at ${packagePath} to version ${version}`, 'success');
  } catch (error) {
    log(`Failed to update package.json at ${packagePath}`, 'error');
    if (error instanceof Error) {
      log(error.message, 'error');
    }
    throw error;
  }
}

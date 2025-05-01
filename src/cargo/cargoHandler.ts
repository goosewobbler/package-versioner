/**
 * Cargo.toml management utilities for package-versioner
 */

import fs from 'node:fs';
import path from 'node:path';
import * as TOML from 'smol-toml';
import type { CargoToml } from '../types.js';
import { addPackageUpdate } from '../utils/jsonOutput.js';
import { log } from '../utils/logging.js';

// Define the CargoInfo interface for internal use
export interface CargoInfo {
  name: string;
  version: string;
  path: string;
  dir: string;
  content: CargoToml;
}

/**
 * Get cargo info from Cargo.toml
 */
export function getCargoInfo(cargoPath: string): CargoInfo {
  if (!fs.existsSync(cargoPath)) {
    log(`Cargo.toml file not found at: ${cargoPath}`, 'error');
    throw new Error(`Cargo.toml file not found at: ${cargoPath}`);
  }

  try {
    const fileContent = fs.readFileSync(cargoPath, 'utf8');
    const cargo = TOML.parse(fileContent) as CargoToml;

    if (!cargo.package?.name) {
      log(`Package name not found in: ${cargoPath}`, 'error');
      throw new Error(`Package name not found in: ${cargoPath}`);
    }

    return {
      name: cargo.package.name,
      version: cargo.package.version || '0.0.0',
      path: cargoPath,
      dir: path.dirname(cargoPath),
      content: cargo,
    };
  } catch (error) {
    log(`Error reading Cargo.toml: ${cargoPath}`, 'error');
    if (error instanceof Error) {
      log(error.message, 'error');
    }
    process.exit(1);
  }
}

/**
 * Check if a file is a Cargo.toml file
 */
export function isCargoToml(filePath: string): boolean {
  return path.basename(filePath) === 'Cargo.toml';
}

/**
 * Update a Cargo.toml file with a new version
 * Preserves comments and formatting as much as possible
 */
export function updateCargoVersion(cargoPath: string, version: string): void {
  try {
    // Read the original file to preserve formatting
    const originalContent = fs.readFileSync(cargoPath, 'utf8');

    // Parse the TOML
    const cargo = TOML.parse(originalContent) as CargoToml;
    const packageName = cargo.package?.name;

    if (!packageName) {
      throw new Error(`No package name found in ${cargoPath}`);
    }

    // Update the version
    if (!cargo.package) {
      cargo.package = { name: packageName, version };
    } else {
      cargo.package.version = version;
    }

    // Write back to the file, preserving format
    // Strategy: Use TOML.stringify for the updated content. Note that TOML.stringify
    // does not preserve the original formatting or comments, so this is a best-effort
    // approach to update the file while maintaining its structure.
    const updatedContent = TOML.stringify(cargo);
    fs.writeFileSync(cargoPath, updatedContent);

    // Track update for JSON output
    addPackageUpdate(packageName, version, cargoPath);

    log(`Updated Cargo.toml at ${cargoPath} to version ${version}`, 'success');
  } catch (error) {
    log(`Failed to update Cargo.toml at ${cargoPath}`, 'error');
    if (error instanceof Error) {
      log(error.message, 'error');
    }
    throw error;
  }
}

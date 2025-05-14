import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

/**
 * Create a package.json file in the given directory
 */
export function createPackageJson(dir: string, name: string, version = '0.1.0') {
  const packageJson = {
    name,
    version,
    private: true,
  };

  writeFileSync(join(dir, 'package.json'), JSON.stringify(packageJson, null, 2));

  // Create a dummy index.js file to give the package some actual content
  writeFileSync(join(dir, 'index.js'), 'console.log("Hello from package");');
}

/**
 * Create a version.config.json file in the given directory
 */
export function createVersionConfig(dir: string, config: Record<string, unknown>) {
  writeFileSync(join(dir, 'version.config.json'), JSON.stringify(config, null, 2));

  // Create the packages directory structure if specified
  if (config.packages && Array.isArray(config.packages)) {
    for (const pkgPath of config.packages) {
      if (pkgPath === './' || pkgPath === '.') {
        // Make sure the root has a package.json if it doesn't already
        const rootPackageJsonPath = join(dir, 'package.json');
        if (!existsSync(rootPackageJsonPath)) {
          createPackageJson(dir, basename(dir));
        }
        continue;
      }

      // Handle glob pattern by creating a basic structure
      if (pkgPath.includes('*')) {
        const basePath = pkgPath.replace('/*', '');
        const packagesDir = join(dir, basePath);

        if (!existsSync(packagesDir)) {
          mkdirSync(packagesDir, { recursive: true });
        }
      } else {
        // Handle direct path
        const packageDir = join(dir, pkgPath);
        if (!existsSync(packageDir)) {
          mkdirSync(packageDir, { recursive: true });
        }
      }
    }
  }
}

/**
 * Get the version from a package.json file
 */
export function getPackageVersion(dir: string, pkgName?: string): string {
  const packageJsonPath = pkgName
    ? join(dir, 'packages', pkgName, 'package.json')
    : join(dir, 'package.json');

  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
  return packageJson.version;
}

/**
 * Read the CHANGELOG.md file from a directory
 */
export function readChangelog(dir: string): string {
  const changelogPath = join(dir, 'CHANGELOG.md');
  return existsSync(changelogPath) ? readFileSync(changelogPath, 'utf8') : '';
}

/**
 * Mock version updates for a package
 */
export function mockVersionUpdates(packagePath: string, newVersion: string): void {
  // Read the package.json
  const packageJsonPath = join(packagePath, 'package.json');
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));

  // Update the version
  packageJson.version = newVersion;

  // Write the updated package.json
  writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
}

/**
 * Update the version in a Cargo.toml file
 */
export function updateCargoVersion(cargoPath: string, newVersion: string): void {
  // Simple implementation that replaces the version line
  // This avoids adding an external dependency on TOML parser for the test helpers
  const content = readFileSync(cargoPath, 'utf-8');
  const updatedContent = content.replace(/version\s*=\s*"[^"]+"/, `version = "${newVersion}"`);
  writeFileSync(cargoPath, updatedContent);
}

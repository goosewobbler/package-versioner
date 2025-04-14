#!/usr/bin/env node
import { Command } from 'commander';
import { loadConfig } from './config.js';
import type { Config } from './types.js';
import { enableJsonOutput, getPackageInfo, log, printFiglet, printJsonOutput } from './utils.js';
import { VersionEngine } from './versionEngine.js';

async function run() {
  const program = new Command();
  // Get package info dynamically for version
  const { version } = getPackageInfo();

  program
    .name('package-versioner')
    .description(
      'Automated semantic versioning based on Git history and conventional commits. Supports monorepos with synchronized or independent package versioning strategies.',
    )
    .version(version) // Use dynamic version from package.json
    .option('--config <path>', 'Path to the configuration file')
    .option('--dry-run', 'Simulate the versioning process without making changes')
    .option('--synced', 'Force synced versioning strategy (overrides config)') // Keep for explicit override
    .option('--bump <type>', 'Force a specific release type (patch, minor, major)')
    .option(
      '--prerelease <identifier>',
      'Create a prerelease version with the specified identifier',
    )
    .option(
      '-t, --target <targets>',
      'Comma-separated list of package names to target (only for async strategy)',
    )
    .option('--json', 'Output results as JSON (suppresses normal output)')
    .parse(process.argv);

  const options = program.opts();

  // Set up JSON output mode before any logging happens
  if (options.json) {
    enableJsonOutput(!!options.dryRun);
  } else {
    // Only print figlet banner in non-JSON mode
    printFiglet();
  }

  try {
    // Load config
    const config: Config = await loadConfig(options.config);
    log('info', `Loaded configuration from ${options.config || 'version.config.json'}`);

    // Override config with CLI options
    if (options.dryRun) config.dryRun = true;
    if (options.synced) config.synced = true; // Allow forcing sync mode
    if (options.bump) config.forceType = options.bump;
    if (options.prerelease)
      config.prereleaseIdentifier = options.prerelease === true ? 'rc' : options.prerelease;

    // Parse targets
    const cliTargets: string[] = options.target
      ? options.target.split(',').map((t: string) => t.trim())
      : [];

    // Initialize engine with JSON mode setting
    const engine = new VersionEngine(config, !!options.json);

    // Determine strategy
    if (config.synced) {
      log('info', 'Using synced versioning strategy.');
      await engine.syncedStrategy(); // Synced doesn't use targets
    } else if (config.packages && config.packages.length === 1) {
      log('info', 'Using single package versioning strategy.');
      if (cliTargets.length > 0) {
        log('warning', '--target flag is ignored for single package strategy.');
      }
      await engine.singleStrategy();
    } else {
      log('info', 'Using async versioning strategy.');
      if (cliTargets.length > 0) {
        log('info', `Targeting specific packages: ${cliTargets.join(', ')}`);
      }
      await engine.asyncStrategy(cliTargets); // Pass targets to async strategy
    }

    log('success', 'Versioning process completed.');

    // Print JSON output if enabled (this will be the only output in JSON mode)
    printJsonOutput();
  } catch (error) {
    log('error', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

run();

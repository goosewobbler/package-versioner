#!/usr/bin/env node
import { Command } from 'commander';
import { loadConfig } from './config.js';
import { VersionEngine } from './core/versionEngine.js';
import type { Config } from './types.js';
import { enableJsonOutput, printJsonOutput } from './utils/jsonOutput.js';
import { log } from './utils/logging.js';

// Main execution function for the CLI
async function run() {
  const program = new Command();

  // Configure the CLI options
  program
    .name('package-versioner')
    .description(
      'A lightweight yet powerful CLI tool for automated semantic versioning based on Git history and conventional commits.',
    )
    .version(process.env.npm_package_version || '0.0.0')
    .option(
      '-c, --config <path>',
      'Path to config file (defaults to version.config.json in current directory)',
    )
    .option('-d, --dry-run', 'Dry run (no changes made)', false)
    .option('-b, --bump <type>', 'Force specific bump type (patch|minor|major)')
    .option('-p, --prerelease [identifier]', 'Create prerelease version')
    .option('-s, --synced', 'Force synchronized versioning across all packages')
    .option('-j, --json', 'Output results as JSON', false)
    .option('-t, --target <packages>', 'Comma-delimited list of package names to target')
    .parse(process.argv);

  const options = program.opts();

  // Enable JSON output mode if requested
  if (options.json) {
    enableJsonOutput(options.dryRun);
  }

  try {
    // Load config
    const config: Config = await loadConfig(options.config);
    log(`Loaded configuration from ${options.config || 'version.config.json'}`, 'info');

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

    // Determine strategy and run
    if (config.synced) {
      log('Using synced versioning strategy.', 'info');
      engine.setStrategy('synced');
      await engine.run(); // Synced doesn't use targets
    } else if (config.packages && config.packages.length === 1) {
      log('Using single package versioning strategy.', 'info');
      if (cliTargets.length > 0) {
        log('--target flag is ignored for single package strategy.', 'warning');
      }
      engine.setStrategy('single');
      await engine.run();
    } else {
      log('Using async versioning strategy.', 'info');
      if (cliTargets.length > 0) {
        log(`Targeting specific packages: ${cliTargets.join(', ')}`, 'info');
      }
      engine.setStrategy('async');
      await engine.run(cliTargets); // Pass targets to async strategy
    }

    log('Versioning process completed.', 'success');

    // Print JSON output if enabled (this will be the only output in JSON mode)
    printJsonOutput();
  } catch (error) {
    log(error instanceof Error ? error.message : String(error), 'error');
    process.exit(1);
  }
}

// Entry point
run().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

#!/usr/bin/env node

import { exit } from 'node:process';
import chalk from 'chalk';
import { Command } from 'commander';
import figlet from 'figlet';
//@ts-ignore
import pkg from '../package.json' assert { type: 'json' };
import { loadConfig } from './config.js';
import { log } from './utils.js';
import { VersionEngine } from './versionEngine.js';

const name = 'package-versioner';

const program = new Command();

program
  .name('package-versioner')
  .description('Manages package versions using Git context.')
  .version(pkg.version);

// Core options
program
  .option('-t, --target <project>', 'specific package to update')
  .option('-b, --bump <version>', 'type of version bump to perform', (value) => {
    const validBumps = [
      'patch',
      'minor',
      'major',
      'premajor',
      'preminor',
      'prepatch',
      'prerelease',
    ];
    if (!validBumps.includes(value)) {
      log('error', `Invalid bump type '${value}'. Valid options are: ${validBumps.join(', ')}`);
      process.exit(1);
    }
    return value;
  })
  .option('--base-branch <branch>', 'override the base branch for this operation')
  .option('--synced', 'force synced versioning mode')
  .option('--no-synced', 'force async versioning mode')
  .option('--skip <packages>', 'comma-separated list of packages to skip', (value) =>
    value.split(','),
  )
  .option('--prerelease <identifier>', 'set prerelease identifier (e.g., alpha, beta)')
  .option('--skip-hooks', 'skip Git hooks for this operation')
  .option('--config <path>', 'specify a custom config file path')
  .option('--dry-run', 'Calculate version and log actions without changing files or Git state');

program
  .description('Version packages based on Git context and conventional commits')
  .action(async (options): Promise<void> => {
    // Display the figlet header directly
    const figletText = figlet.textSync(name);
    const versionText = `v${pkg.version}`;
    process.stdout.write(`${chalk.hex('#FF1F57')(figletText)}\n`);
    process.stdout.write(`${chalk.hex('#0096FF')(versionText)}\n\n`);

    try {
      // Load config (with potential override for config path)
      const configPath = options.config || undefined;
      const config = await loadConfig(configPath);

      // Override config with CLI options
      if (options.baseBranch) config.baseBranch = options.baseBranch;
      if (options.synced !== undefined) config.synced = options.synced;
      if (options.skip) config.skip = options.skip;
      if (options.prerelease) config.prereleaseIdentifier = options.prerelease;
      if (options.skipHooks !== undefined) config.skipHooks = options.skipHooks;
      if (options.dryRun !== undefined) config.dryRun = options.dryRun;

      const engine = new VersionEngine(config);

      // Simple routing logic
      if (config.synced) {
        // Synced mode - all packages get the same version
        await engine.syncedStrategy();
      } else if (options.bump && options.target) {
        // Single package mode - version specific packages
        await engine.singleStrategy();
      } else {
        // Async mode - version packages with changes
        await engine.asyncStrategy();
      }
    } catch (err: unknown) {
      log('error', `${err instanceof Error ? err.message : String(err)}`);
      exit(1);
    }
  });

program.parse();

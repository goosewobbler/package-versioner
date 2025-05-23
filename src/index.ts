#!/usr/bin/env node
import * as fs from 'node:fs';
import path from 'node:path';
import { Command } from 'commander';
import { regenerateChangelog, writeChangelog } from './changelog/changelogRegenerator.js';
import { loadConfig } from './config.js';
import { VersionEngine } from './core/versionEngine.js';
import type { Config } from './types.js';
import { enableJsonOutput, printJsonOutput } from './utils/jsonOutput.js';
import { log } from './utils/logging.js';

/**
 * Read package version from package.json
 * @returns The package version or a fallback value
 */
function getPackageVersion(): string {
  try {
    // Read version from package.json
    const packageJsonPath = path.resolve(
      path.dirname(import.meta.url.replace('file:', '')),
      '../package.json',
    );
    const packageJsonContent = fs.readFileSync(packageJsonPath, 'utf-8');
    const packageJson = JSON.parse(packageJsonContent);
    return packageJson.version || '0.0.0';
  } catch (error) {
    // Fallback in case of any errors
    console.error('Failed to read package version:', error);
    return '0.0.0';
  }
}

/**
 * Main execution function for package-versioner
 */
export async function run(): Promise<void> {
  try {
    // Add build timestamp and version for debug verification
    const buildTimestamp = new Date().toISOString();
    const packageVersion = getPackageVersion();
    log(`package-versioner v${packageVersion} (Build: ${buildTimestamp})`, 'debug');

    const program = new Command();

    // Configure the CLI options
    program
      .name('package-versioner')
      .description(
        'A lightweight yet powerful CLI tool for automated semantic versioning based on Git history and conventional commits.',
      )
      .version(packageVersion);

    // Main versioning command (default)
    program
      .command('version', { isDefault: true })
      .description('Version a package or packages based on configuration')
      .option(
        '-c, --config <path>',
        'Path to config file (defaults to version.config.json in current directory)',
      )
      .option('-d, --dry-run', 'Dry run (no changes made)', false)
      .option('-b, --bump <type>', 'Specify bump type (patch|minor|major)')
      .option('-p, --prerelease [identifier]', 'Create prerelease version')
      .option('-s, --synced', 'Use synchronized versioning across all packages')
      .option('-j, --json', 'Output results as JSON', false)
      .option('-t, --target <packages>', 'Comma-delimited list of package names to target')
      .action(async (options) => {
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
          if (options.bump) config.type = options.bump;
          if (options.prerelease)
            config.prereleaseIdentifier = options.prerelease === true ? 'next' : options.prerelease;

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
      });

    // Add regenerate-changelog subcommand
    program
      .command('regenerate-changelog')
      .description('Regenerate a complete changelog from git history')
      .option('-o, --output <path>', 'Output path for changelog file', 'CHANGELOG.md')
      .option(
        '-f, --format <format>',
        'Changelog format (keep-a-changelog|angular)',
        'keep-a-changelog',
      )
      .option('-s, --since <tag>', 'Start changelog from specific tag')
      .option('-u, --repo-url <url>', 'Repository URL for changelog links')
      .option('-d, --dry-run', 'Preview changelog without writing to file', false)
      .option('-p, --project-dir <path>', 'Project directory', process.cwd())
      .action(async (options) => {
        try {
          log('Regenerating changelog from git history...', 'info');

          // Validate options
          if (options.format !== 'keep-a-changelog' && options.format !== 'angular') {
            throw new Error(
              'Invalid format specified. Must be either "keep-a-changelog" or "angular"',
            );
          }

          const regenerateOptions = {
            format: options.format,
            since: options.since,
            output: options.output,
            dryRun: options.dryRun,
            projectDir: options.projectDir,
            repoUrl: options.repoUrl,
          };

          // Generate changelog content
          const content = await regenerateChangelog(regenerateOptions);

          // Write to file or preview
          await writeChangelog(
            content,
            path.resolve(options.projectDir, options.output),
            options.dryRun,
          );

          if (!options.dryRun) {
            log(`Changelog successfully regenerated at ${options.output}`, 'success');
          }
        } catch (error) {
          log(error instanceof Error ? error.message : String(error), 'error');
          process.exit(1);
        }
      });

    program.parse(process.argv);
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

// Entry point
run().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

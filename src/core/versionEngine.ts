import { cwd } from 'node:process';

import { type Package, type Packages, getPackagesSync } from '@manypkg/get-packages';

import { GitError } from '../errors/gitError.js';
import { VersionError, VersionErrorCode, createVersionError } from '../errors/versionError.js';
import type { Config } from '../types.js';
import { log } from '../utils/logging.js';
import {
  type StrategyFunction,
  type StrategyType,
  createStrategy,
  createStrategyMap,
} from './versionStrategies.js';

// Define extended type that includes root property
export interface PackagesWithRoot extends Packages {
  root: string;
}

/**
 * Main versioning engine that uses functional strategies
 */
export class VersionEngine {
  private config: Config;
  private jsonMode: boolean;
  private workspaceCache: PackagesWithRoot | null = null;
  private strategies: Record<StrategyType, StrategyFunction>;
  private currentStrategy: StrategyFunction;

  constructor(config: Config, jsonMode = false) {
    // Validate required configuration
    if (!config) {
      throw createVersionError(VersionErrorCode.CONFIG_REQUIRED);
    }

    // Default values for required properties
    if (!config.preset) {
      config.preset = 'conventional-commits';
      log('No preset specified, using default: conventional-commits', 'warning');
    }

    this.config = config;
    this.jsonMode = jsonMode;

    // Create all strategy functions
    this.strategies = createStrategyMap(config);

    // Set initial strategy based on config
    this.currentStrategy = createStrategy(config);
  }

  /**
   * Get workspace packages information - with caching for performance
   */
  private async getWorkspacePackages(): Promise<PackagesWithRoot> {
    try {
      // Return cached result if available for better performance
      if (this.workspaceCache) {
        return this.workspaceCache;
      }

      const pkgsResult = getPackagesSync(cwd()) as PackagesWithRoot;
      if (!pkgsResult || !pkgsResult.packages) {
        throw createVersionError(VersionErrorCode.PACKAGES_NOT_FOUND);
      }

      // Ensure the root property is set
      if (!pkgsResult.root) {
        log(
          'Root path is undefined in packages result, setting to current working directory',
          'warning',
        );
        pkgsResult.root = cwd();
      }

      // Cache the result for subsequent calls
      this.workspaceCache = pkgsResult;
      return pkgsResult;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log(`Failed to get packages information: ${errorMessage}`, 'error');
      console.error(error);

      // Throw a more specific error for better error handling upstream
      throw createVersionError(VersionErrorCode.WORKSPACE_ERROR, errorMessage);
    }
  }

  /**
   * Run the current strategy
   * @param targets Optional package targets to process (only used by async strategy)
   */
  public async run(targets: string[] = []): Promise<void> {
    try {
      // Get workspace packages
      const packages = await this.getWorkspacePackages();

      // Execute the strategy function
      return this.currentStrategy(packages, targets);
    } catch (error) {
      if (error instanceof VersionError || error instanceof GitError) {
        log(`Version engine failed: ${error.message} (${error.code || 'UNKNOWN'})`, 'error');

        // Enhanced error logging for GitError
        if (error instanceof GitError) {
          console.error('Git error details:');
          if (error.message.includes('Command failed:')) {
            const cmdOutput = error.message.split('Command failed:')[1];
            if (cmdOutput) {
              console.error('Command output:', cmdOutput.trim());
            }
          }
        }
      } else {
        const errorMessage = error instanceof Error ? error.message : String(error);
        log(`Version engine failed: ${errorMessage}`, 'error');

        if (error instanceof Error && error.stack) {
          console.error('Error stack trace:');
          console.error(error.stack);
        }
      }
      throw error;
    }
  }

  /**
   * Change the current strategy
   * @param strategyType The strategy type to use: 'synced', 'single', or 'async'
   */
  public setStrategy(strategyType: StrategyType): void {
    this.currentStrategy = this.strategies[strategyType];
  }
}

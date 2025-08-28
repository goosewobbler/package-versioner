/**
 * Base error class for package-versioner with integrated logging capabilities
 */

import { log } from '../utils/logging.js';

/**
 * Base error class that all package-versioner errors should extend
 * Provides consistent error handling and logging functionality
 */
export abstract class BasePackageVersionerError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly suggestions?: string[],
  ) {
    super(message);
    this.name = this.constructor.name;
  }

  /**
   * Log the error with consistent formatting and optional suggestions
   * This centralizes all error output formatting and behavior
   */
  logError(): void {
    log(this.message, 'error');

    if (this.suggestions?.length) {
      log('\nSuggested solutions:', 'info');
      this.suggestions.forEach((suggestion, i) => {
        log(`${i + 1}. ${suggestion}`, 'info');
      });
    }
  }

  /**
   * Type guard to check if an error is a package-versioner error
   * @param error Error to check
   * @returns true if error is a BasePackageVersionerError
   */
  static isPackageVersionerError(error: unknown): error is BasePackageVersionerError {
    return error instanceof BasePackageVersionerError;
  }
}

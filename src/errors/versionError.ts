/**
 * Custom error class for versioning operations
 */
export class VersionError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'VersionError';
  }
}

/**
 * Error codes for versioning operations
 */
export enum VersionErrorCode {
  CONFIG_REQUIRED = 'CONFIG_REQUIRED',
  PACKAGES_NOT_FOUND = 'PACKAGES_NOT_FOUND',
  WORKSPACE_ERROR = 'WORKSPACE_ERROR',
  INVALID_CONFIG = 'INVALID_CONFIG',
  PACKAGE_NOT_FOUND = 'PACKAGE_NOT_FOUND',
  VERSION_CALCULATION_ERROR = 'VERSION_CALCULATION_ERROR',
}

/**
 * Creates a VersionError with standard error message for common failure scenarios
 * @param code Error code
 * @param details Additional error details
 * @returns VersionError instance
 */
export function createVersionError(code: VersionErrorCode, details?: string): VersionError {
  const messages: Record<VersionErrorCode, string> = {
    [VersionErrorCode.CONFIG_REQUIRED]: 'Configuration is required',
    [VersionErrorCode.PACKAGES_NOT_FOUND]: 'Failed to get packages information',
    [VersionErrorCode.WORKSPACE_ERROR]: 'Failed to get workspace packages',
    [VersionErrorCode.INVALID_CONFIG]: 'Invalid configuration',
    [VersionErrorCode.PACKAGE_NOT_FOUND]: 'Package not found',
    [VersionErrorCode.VERSION_CALCULATION_ERROR]: 'Failed to calculate version',
  };

  const baseMessage = messages[code];
  const fullMessage = details ? `${baseMessage}: ${details}` : baseMessage;

  return new VersionError(fullMessage, code);
}

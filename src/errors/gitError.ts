/**
 * Custom error class for Git operations
 */
export class GitError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'GitError';
  }
}

/**
 * Error codes for Git operations
 */
export enum GitErrorCode {
  NOT_GIT_REPO = 'NOT_GIT_REPO',
  GIT_PROCESS_ERROR = 'GIT_PROCESS_ERROR',
  NO_FILES = 'NO_FILES',
  NO_COMMIT_MESSAGE = 'NO_COMMIT_MESSAGE',
  GIT_ERROR = 'GIT_ERROR',
}

/**
 * Creates a GitError with standard error message for common failure scenarios
 * @param code Error code
 * @param details Additional error details
 * @returns GitError instance
 */
export function createGitError(code: GitErrorCode, details?: string): GitError {
  const messages: Record<GitErrorCode, string> = {
    [GitErrorCode.NOT_GIT_REPO]: 'Not a git repository',
    [GitErrorCode.GIT_PROCESS_ERROR]: 'Failed to create new version',
    [GitErrorCode.NO_FILES]: 'No files specified for commit',
    [GitErrorCode.NO_COMMIT_MESSAGE]: 'Commit message is required',
    [GitErrorCode.GIT_ERROR]: 'Git operation failed',
  };

  const baseMessage = messages[code];
  const fullMessage = details ? `${baseMessage}: ${details}` : baseMessage;

  return new GitError(fullMessage, code);
}

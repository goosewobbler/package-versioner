/**
 * JSON Output service for package-versioner
 * Centralizes all JSON output handling
 */

/**
 * JSON output data structure
 */
export interface JsonOutputData {
  dryRun: boolean;
  updates: Array<{
    packageName: string;
    newVersion: string;
    filePath: string;
  }>;
  commitMessage?: string;
  tags: string[];
}

// Flag to control JSON output mode
let _jsonOutputMode = false;

// Store collected information for JSON output
const _jsonData: JsonOutputData = {
  dryRun: false,
  updates: [],
  tags: [],
};

/**
 * Enable JSON output mode
 * @param dryRun Whether this is a dry run
 */
export function enableJsonOutput(dryRun = false): void {
  _jsonOutputMode = true;
  _jsonData.dryRun = dryRun;
  _jsonData.updates = [];
  _jsonData.tags = [];
  _jsonData.commitMessage = undefined;
}

/**
 * Check if JSON output mode is enabled
 */
export function isJsonOutputMode(): boolean {
  return _jsonOutputMode;
}

/**
 * Add a package update to the JSON output
 */
export function addPackageUpdate(packageName: string, newVersion: string, filePath: string): void {
  if (!_jsonOutputMode) return;

  _jsonData.updates.push({
    packageName,
    newVersion,
    filePath,
  });
}

/**
 * Add a tag to the JSON output
 */
export function addTag(tag: string): void {
  if (!_jsonOutputMode) return;

  _jsonData.tags.push(tag);
}

/**
 * Set the commit message in the JSON output
 */
export function setCommitMessage(message: string): void {
  if (!_jsonOutputMode) return;

  _jsonData.commitMessage = message;
}

/**
 * Get the current JSON output data (for testing)
 */
export function getJsonData(): JsonOutputData {
  return { ..._jsonData };
}

/**
 * Print JSON output at the end of execution
 */
export function printJsonOutput(): void {
  if (_jsonOutputMode) {
    console.log(JSON.stringify(_jsonData, null, 2));
  }
}

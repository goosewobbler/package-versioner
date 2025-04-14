# package-versioner


<a href="https://www.npmjs.com/package/package-versioner" alt="NPM Version">
  <img src="https://img.shields.io/npm/v/package-versioner" /></a>
<a href="https://www.npmjs.com/package/package-versioner" alt="NPM Downloads">
  <img src="https://img.shields.io/npm/dw/package-versioner" /></a>

A lightweight CLI tool for automated semantic versioning based on Git history and conventional commits. Supports both single package projects and monorepos with flexible versioning strategies.

## Features

- Automatically determines version bumps based on commit history (using conventional commits)
- Supports both single package projects and monorepos with minimal configuration
- Flexible versioning strategies (e.g., based on commit types, branch patterns)
- Integrates with conventional commits presets
- Customizable through a `version.config.json` file or CLI options
- Automatically updates `package.json` version
- Creates appropriate Git tags for releases
- CI/CD friendly with JSON output support

## Usage

`package-versioner` is designed to be run directly using your preferred package manager's execution command, without needing global installation.

```bash
# Determine bump based on conventional commits since last tag
npx package-versioner

# Using pnpm
pnpm dlx package-versioner

# Using yarn
yarn dlx package-versioner

# Specify a bump type explicitly
npx package-versioner --bump minor

# Create a prerelease (e.g., alpha)
npx package-versioner --bump patch --prerelease alpha

# Target specific packages (only in async/independent mode, comma-separated)
npx package-versioner -t @scope/package-a,@scope/package-b

# Perform a dry run: calculates version, logs actions, but makes no file changes or Git commits/tags
npx package-versioner --dry-run

# Output results as JSON (useful for CI/CD scripts)
npx package-versioner --json

# Combine with dry-run for CI planning
npx package-versioner --dry-run --json
```

**Note on Targeting:** Using the `-t` flag creates package-specific tags (e.g., `@scope/package-a@1.2.0`) but *not* a global tag (like `v1.2.0`). If needed, create the global tag manually in your CI/CD script after this command.

## JSON Output

When using the `--json` flag, normal console output is suppressed and the tool outputs a structured JSON object that includes information about the versioning operation.

```json
{
  "dryRun": true,
  "updates": [
    {
      "packageName": "@scope/package-a",
      "newVersion": "1.2.3",
      "filePath": "/path/to/package.json"
    }
  ],
  "commitMessage": "chore(release): v1.2.3",
  "tags": [
    "v@scope/package-a@1.2.3"
  ]
}
```

For detailed examples of how to use this in CI/CD pipelines, see [CI/CD Integration](./docs/CI_CD_INTEGRATION.md).

## Configuration

Customize behavior by creating a `version.config.json` file in your project root:

```json
{
  "preset": "conventional-commits", // Preset for conventional-commits analysis
  "tagPrefix": "v",                 // Prefix for Git tags (e.g., v1.0.0)
  "commitMessage": "chore(release): v${version}", // Template for the release commit (defaults to this if omitted)
  "versionStrategy": "commitMessage", // Use conventional commit messages (default) or "branchPattern"
  "baseBranch": "main",               // Base branch for calculations
  "branchPattern": [                // Used if versionStrategy is branchPattern
    "feature:minor", 
    "fix:patch"
  ],
  "prereleaseIdentifier": null,     // Default prerelease identifier (e.g., "beta")
  "skipHooks": false,               // Skip git commit hooks (--no-verify)
  "synced": true,                   // (Monorepo-specific) Treat as a single synchronized unit
  "packages": [],                   // (Monorepo-specific) Specify packages (not typical for single repo)
  "updateInternalDependencies": "no-internal-update" // (Monorepo-specific) How to handle workspace deps
}
```

**Note:** Options like `synced`, `packages`, and `updateInternalDependencies` enable monorepo-specific behaviours.

## How Versioning Works

`package-versioner` determines the next version based on your configuration (`version.config.json`). The two main approaches are:

1.  **Conventional Commits:** Analyzes commit messages (like `feat:`, `fix:`, `BREAKING CHANGE:`) since the last tag.
2.  **Branch Pattern:** Determines the bump based on the current or recently merged branch name matching predefined patterns.

For a detailed explanation of these concepts and monorepo modes (Synced vs. Async), see [Versioning Strategies and Concepts](./docs/VERSIONING_STRATEGIES.md).

## Documentation

- [Versioning Strategies and Concepts](./docs/VERSIONING_STRATEGIES.md) - Detailed explanation of versioning approaches
- [CI/CD Integration](./docs/CI_CD_INTEGRATION.md) - Guide for integrating with CI/CD pipelines

For more details on available CLI options, run:

```bash
npx package-versioner --help
```

## Acknowledgements

This project was originally forked from and inspired by [`jucian0/turbo-version`](https://github.com/jucian0/turbo-version). We appreciate the foundational work done by the original authors.

## License

MIT

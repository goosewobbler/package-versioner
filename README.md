# package-versioner


<a href="https://www.npmjs.com/package/package-versioner" alt="NPM Version">
  <img src="https://img.shields.io/npm/v/package-versioner" /></a>
<a href="https://www.npmjs.com/package/package-versioner" alt="NPM Downloads">
  <img src="https://img.shields.io/npm/dw/package-versioner" /></a>

A lightweight yet powerful CLI tool for automated semantic versioning based on Git history and conventional commits. Supports both single package projects and monorepos with flexible versioning strategies.

## Features

- Automatically determines version bumps based on commit history (using conventional commits)
- Supports both single package projects and monorepos with minimal configuration
- Support for both npm (package.json) and Rust (Cargo.toml) projects
- Flexible versioning strategies (e.g., based on commit types, branch patterns)
- Integrates with conventional commits presets
- Customizable through a `version.config.json` file or CLI options
- Automatically updates `package.json` or `Cargo.toml` version
- Creates appropriate Git tags for releases
- Automatically generates and maintains Keep a Changelog compliant changelogs
- CI/CD friendly with JSON output support

## Supporting JavaScript and Rust Projects

`package-versioner` provides version management for both JavaScript/TypeScript (via package.json) and Rust (via Cargo.toml) projects:

- **JavaScript/TypeScript**: Automatically detects and updates version in package.json files
- **Rust**: Detects and updates version in Cargo.toml files using the same versioning strategies
- **Mixed Projects**: Supports repositories containing both package.json and Cargo.toml files

When run, the tool will automatically discover and update the appropriate manifest file based on the project structure.

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
  "preset": "angular",
  "versionPrefix": "v",
  "tagTemplate": "${prefix}${version}",
  "packageTagTemplate": "${packageName}@${prefix}${version}",
  "commitMessage": "chore: release ${packageName}@${version} [skip ci]",
  "updateChangelog": true,
  "monorepo": {
    "synced": true,
    "skip": [
      "docs",
      "e2e"
    ],
    "packagePath": "packages"
  },
  "cargo": {
    "enabled": true,
    "paths": ["src/", "crates/"]
  }
}
```

**Notes:** 
- Options like `synced`, `packages`, and `updateInternalDependencies` enable monorepo-specific behaviours.
- The `tagTemplate` and `packageTagTemplate` allow you to customize how Git tags are formatted for releases.
- The `commitMessage` template can include CI skip tokens like `[skip ci]` if you want to prevent CI runs after version commits (e.g., `"commitMessage": "chore: release ${packageName}@${version} [skip ci]"`). See [CI/CD Integration](./docs/CI_CD_INTEGRATION.md) for more details.
- The `updateChangelog` option controls whether to automatically generate and update changelogs for each package (default: true).
- The `cargo` options can help when working with Rust projects:
  - `enabled` (default: `true`): Set to `false` to disable Cargo.toml version handling
  - `paths` (optional): Specify directories to search for Cargo.toml files

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

## Changelog Generation

`package-versioner` automatically generates and maintains a [Keep a Changelog](https://keepachangelog.com/) compatible changelog for each package.

### How It Works

1. When a package is versioned, `package-versioner` scans the git history since the last release tag.
2. It parses conventional commit messages and sorts them into appropriate changelog sections:
   - `feat` prefixed commits become "Added" entries
   - `fix` prefixed commits become "Fixed" entries
   - `deprecate` prefixed commits become "Deprecated" entries
   - And so on

### Changelog Structure

The generated changelogs follow the Keep a Changelog structure:

- An "Unreleased" section for tracking upcoming changes
- Version sections with release dates and sorted entries
- Entries grouped by type (Added, Changed, Fixed, etc.)
- Automatic linking between versions if repository info is available

### Customization

- Enable or disable changelog generation with `updateChangelog: false` in your config
- Issue references in commit messages like `Fixes #123` are automatically linked in the changelog
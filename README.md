# package-versioner


<a href="https://www.npmjs.com/package/package-versioner" alt="NPM Version">
  <img src="https://img.shields.io/npm/v/package-versioner" /></a>
<a href="https://www.npmjs.com/package/package-versioner" alt="NPM Downloads">
  <img src="https://img.shields.io/npm/dw/package-versioner" /></a>
<br/><br/>
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
- Automatically generates and maintains changelogs in Keep a Changelog or Angular format
- Integrates commit messages, breaking changes, and issue references into well-structured changelogs
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

Customize behaviour by creating a `version.config.json` file in your project root:

```json
{
  "preset": "angular",
  "versionPrefix": "v",
  "tagTemplate": "${packageName}@${prefix}${version}",
  "packageSpecificTags": true,
  "commitMessage": "chore: release ${packageName}@${version} [skip ci]",
  "updateChangelog": true,
  "changelogFormat": "keep-a-changelog",
  "synced": true,
  "skip": [
    "docs",
    "e2e"
  ],
  "packages": ["@mycompany/*"],
  "mainPackage": "primary-package",
  "cargo": {
    "enabled": true,
    "paths": ["src/", "crates/"]
  }
}
```

### Configuration Options

#### General Options (All Projects)
- `preset`: Conventional commits preset to use for version calculation (default: "angular")
- `versionPrefix`: Prefix for version numbers in tags (default: "v")
- `tagTemplate`: Template for Git tags (default: "${prefix}${version}")
- `commitMessage`: Template for commit messages (default: "chore(release): ${version}")
- `updateChangelog`: Whether to automatically update changelogs (default: true)
- `changelogFormat`: Format for changelogs - "keep-a-changelog" or "angular" (default: "keep-a-changelog")
- `cargo`: Options for Rust projects:
  - `enabled`: Whether to handle Cargo.toml files (default: true)
  - `paths`: Directories to search for Cargo.toml files (optional)

#### Monorepo-Specific Options
- `synced`: Whether all packages should be versioned together (default: true)
- `skip`: Array of package names to exclude from versioning
- `packages`: Array of package names or patterns to target for versioning. Supports exact names, scope wildcards, and global wildcards (e.g., ["@scope/package-a", "@scope/*", "*"])
- `mainPackage`: Package name whose commit history should drive version determination
- `packageSpecificTags`: Whether to enable package-specific tagging behaviour (default: false)
- `updateInternalDependencies`: How to update internal dependencies ("patch", "minor", "major", or "inherit")

For more details on CI/CD integration and advanced usage, see [CI/CD Integration](./docs/CI_CD_INTEGRATION.md).

### Package Targeting

The `packages` configuration option allows you to specify which packages should be processed for versioning. It supports several pattern types:

#### Exact Package Names
```json
{
  "packages": ["@mycompany/core", "@mycompany/utils", "standalone-package"]
}
```

#### Scope Wildcards
Target all packages within a specific scope:
```json
{
  "packages": ["@mycompany/*"]
}
```

#### Global Wildcard
Target all packages in the workspace:
```json
{
  "packages": ["*"]
}
```

#### Mixed Patterns
Combine different pattern types:
```json
{
  "packages": ["@mycompany/*", "@utils/logger", "legacy-package"]
}
```

**Note**: Package discovery is handled by your workspace configuration (pnpm-workspace.yaml, package.json workspaces, etc.). The `packages` option only filters which discovered packages to process.

### Package-Specific Tagging

The `packageSpecificTags` option controls whether the tool creates and searches for package-specific Git tags:

- **When `false` (default)**: Creates global tags like `v1.2.3` and searches for the latest global tag
- **When `true`**: Creates package-specific tags like `@scope/package-a@v1.2.3` and searches for package-specific tags

This option works in conjunction with `tagTemplate` to control tag formatting. The `tagTemplate` is used for all tag creation, with the `packageSpecificTags` boolean controlling whether the `${packageName}` variable is populated:

- When `packageSpecificTags` is `false`: The `${packageName}` variable is empty, so templates should use `${prefix}${version}`
- When `packageSpecificTags` is `true`: The `${packageName}` variable contains the package name

**Examples:**

For single-package repositories or synced monorepos:
```json
{
  "packageSpecificTags": true,
  "tagTemplate": "${packageName}@${prefix}${version}"
}
```
Creates tags like `my-package@v1.2.3`

For global versioning:
```json
{
  "packageSpecificTags": false,
  "tagTemplate": "${prefix}${version}"
}
```
Creates tags like `v1.2.3`

**Important Notes:**
- In **synced mode** with a single package, `packageSpecificTags: true` will use the package name even though all packages are versioned together
- In **synced mode** with multiple packages, package names are not used regardless of the setting
- In **async mode**, each package gets its own tag when `packageSpecificTags` is enabled

With package-specific tagging enabled, the tool will:
1. Look for existing tags matching the configured pattern for each package
2. Create new tags using the same pattern when releasing
3. Fall back to global tag lookup if no package-specific tags are found

## How Versioning Works

`package-versioner` determines the next version based on your configuration (`version.config.json`). The two main approaches are:

1.  **Conventional Commits:** Analyzes commit messages (like `feat:`, `fix:`, `BREAKING CHANGE:`) since the last tag.
2.  **Branch Pattern:** Determines the bump based on the current or recently merged branch name matching predefined patterns.

For a detailed explanation of these concepts and monorepo modes (Synced vs. Async), see [Versioning Strategies and Concepts](./docs/versioning.md).

## Documentation

- [Versioning Strategies and Concepts](./docs/versioning.md) - Detailed explanation of versioning approaches
- [CI/CD Integration](./docs/ci_cd_integration.md) - Guide for integrating with CI/CD pipelines
- [Changelog Generation](./docs/changelogs.md) - How changelogs are automatically generated and maintained

For more details on available CLI options, run:

```bash
npx package-versioner --help
```

## Acknowledgements

This project was originally forked from and inspired by [`jucian0/turbo-version`](https://github.com/jucian0/turbo-version). We appreciate the foundational work done by the original authors.

## License

MIT

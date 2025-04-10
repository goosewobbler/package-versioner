# package-versioner

A powerful CLI tool for automated semantic versioning based on Git history and conventional commits. Simplifies version management in JavaScript/TypeScript projects.

## Features

- Automatically determines version bumps based on commit history
- Supports both monorepo and single package projects
- Flexible versioning strategies (synchronized or independent)
- Integrates with conventional commits
- Customizable through configuration or CLI options
- Generates appropriate Git tags for releases

## Installation

```bash
# Global installation
npm install -g package-versioner

# Or as a dev dependency
npm install --save-dev package-versioner
```

## Usage

### Basic Usage

```bash
# Let package-versioner determine what to bump based on commit messages
package-versioner

# Specify a bump type
package-versioner --bump minor

# Target a specific package in a monorepo
package-versioner --target my-package --bump patch

# Use prerelease identifier
package-versioner --prerelease beta
```

### Configuration

Create a `version.config.json` file in your project root:

```json
{
  "preset": "conventional-commits",
  "packages": [],
  "tagPrefix": "v",
  "versionStrategy": "branchPattern",
  "baseBranch": "main",
  "synced": true,
  "branchPattern": ["feature:minor", "fix:patch"],
  "skip": [],
  "updateInternalDependencies": "no-internal-update"
}
```

## Versioning Strategies

### Synced Mode

All packages get the same version number. Use this for tightly coupled packages.

```bash
package-versioner --synced
```

### Async Mode

Each package gets its own independent version. Use this for loosely coupled packages.

```bash
package-versioner --no-synced
```

### Single Package Mode

Version a specific package in a monorepo.

```bash
package-versioner --target my-package
```

## Documentation

For more details on available options and configuration, run:

```bash
package-versioner --help
```

## License

MIT

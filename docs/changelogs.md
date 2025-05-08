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

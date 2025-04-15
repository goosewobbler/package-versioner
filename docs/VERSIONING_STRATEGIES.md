# Versioning Strategies and Concepts

`package-versioner` offers flexible ways to determine the next version for your project based on its history and your configuration.

## How the Next Version is Calculated

There are two primary methods the tool uses to decide the version bump (e.g., patch, minor, major), configured via the `versionStrategy` option in `version.config.json`:

### 1. Conventional Commits (`versionStrategy: "conventional"`)

This is the default strategy. `package-versioner` analyzes Git commit messages since the last Git tag that follows semver patterns. It uses the [conventional-commits](https://www.conventionalcommits.org/) specification to determine the bump:

-   **Patch Bump (e.g., 1.2.3 -> 1.2.4):** Triggered by `fix:` commit types.
-   **Minor Bump (e.g., 1.2.3 -> 1.3.0):** Triggered by `feat:` commit types.
-   **Major Bump (e.g., 1.2.3 -> 2.0.0):** Triggered by commits with `BREAKING CHANGE:` in the footer or `feat!:`, `fix!:` etc. in the header.

The specific preset used for analysis (e.g., "angular", "conventional") can be set using the `preset` option in `version.config.json`.

**Format:** `<type>(<scope>): <subject>`

`<scope>` is optional.

**Example Commit Types:**

-   `feat:` (new feature for the user)
-   `fix:` (bug fix for the user)
-   `docs:` (changes to the documentation)
-   `style:` (formatting, missing semi-colons, etc; no production code change)
-   `refactor:` (refactoring production code, e.g. renaming a variable)
-   `test:` (adding missing tests, refactoring tests; no production code change)
-   `chore:` (updating build tasks etc; no production code change)

**References:**

-   [https://www.conventionalcommits.org/](https://www.conventionalcommits.org/)
-   [https://github.com/conventional-changelog/conventional-changelog](https://github.com/conventional-changelog/conventional-changelog)

### 2. Branch Pattern (`versionStrategy: "branchPattern"`)

This strategy uses the name of the current Git branch (or the most recently merged branch matching a pattern, if applicable) to determine the version bump.

You define patterns in the `branchPattern` array in `version.config.json`. Each pattern is a string like `"prefix:bumptype"`.

**Example `version.config.json`:**

```json
{
  "versionStrategy": "branchPattern",
  "branchPattern": [
    "feature:minor",
    "hotfix:patch",
    "fix:patch",
    "release:major" 
  ],
  "baseBranch": "main" 
}
```

**How it works:**

1.  The tool checks the current branch name.
2.  It might also look for the most recently merged branch into `baseBranch` that matches any pattern in `branchPattern`.
3.  It compares the relevant branch name (current or last merged) against the prefixes in `branchPattern`.
4.  If a match is found (e.g., current branch is `feature/add-login`), it applies the corresponding bump type (`minor` in this case).

This allows you to enforce version bumps based on your branching workflow (e.g., all branches starting with `feature/` result in a minor bump).

## Monorepo Versioning Modes

While primarily used for single packages now, `package-versioner` retains options for monorepo workflows, controlled mainly by the `synced` flag in `version.config.json`.

### Synced Mode (`synced: true`)

This is the default if the `synced` flag is present and true.

-   **Behavior:** The tool calculates **one** version bump based on the overall history (or branch pattern). This single new version is applied to **all** packages within the repository (or just the root `package.json` if not a structured monorepo). A single Git tag is created (e.g., `v1.2.3`).
-   **Use Case:** Suitable for monorepos where all packages are tightly coupled and released together with the same version number. Also the effective mode for single-package repositories.

### Async Mode (`synced: false`)

*(Note: This mode relies heavily on monorepo tooling and structure, like `pnpm workspaces` and correctly configured package dependencies.)*

-   **Behavior (Default - No `-t` flag):** The tool analyzes commits to determine which specific packages within the monorepo have changed since the last relevant commit/tag.
    -   It calculates an appropriate version bump **independently for each changed package** based on the commits affecting that package.
    -   Only the `package.json` files of the changed packages are updated.
    -   A **single commit** is created grouping all the version bumps, using the commit message template. **No Git tags are created** in this mode.
-   **Use Case:** Suitable for monorepos where packages are versioned independently, but a single commit represents the batch of updates for traceability.

-   **Behavior (Targeted - With `-t` flag):** When using the `-t, --target <targets>` flag:
    -   Only the specified packages (respecting the `skip` list) are considered for versioning.
    -   It calculates an appropriate version bump **independently for each targeted package** based on its commit history.
    -   The `package.json` file of each successfully updated targeted package is modified.
    -   An **individual Git tag** (e.g., `packageName@1.2.3`) is created **for each successfully updated package** immediately after its version is bumped.
    -   Finally, a **single commit** is created including all the updated `package.json` files, using a summary commit message (e.g., `chore(release): pkg-a, pkg-b 1.2.3 [skip-ci]`).
    -   **Important:** Only package-specific tags are created. The global tag (e.g., `v1.2.3`) is **not** automatically generated in this mode. If your release process (like GitHub Releases) depends on a global tag, you'll need to create it manually in your CI/CD script *after* `package-versioner` completes.
-   **Use Case:** Releasing specific packages independently while still tagging each released package individually.

## Prerelease Handling

`package-versioner` provides flexible handling for prerelease versions, allowing both creation of prereleases and promotion to stable releases.

### Creating Prereleases

Use the `--prerelease` flag with an identifier to create a prerelease version:

```bash
# Create a beta prerelease
npx package-versioner --bump minor --prerelease beta
# Result: 1.0.0 -> 1.1.0-beta.0
```

You can also set a default prerelease identifier in your `version.config.json`:

```json
{
  "prereleaseIdentifier": "beta"
}
```

### Promoting Prereleases to Stable Releases

When using standard bump types (`major`, `minor`, `patch`) with the `--bump` flag on a prerelease version, `package-versioner` will automatically clean the prerelease identifier:

```bash
# Starting from version 1.0.0-beta.1
npx package-versioner --bump major
# Result: 1.0.0-beta.1 -> 2.0.0 (not 2.0.0-beta.0)
```

This intuitive behavior means you don't need to use an empty prerelease identifier (`--prerelease ""`) to promote a prerelease to a stable version. Simply specify the standard bump type and the tool will automatically produce a clean version number.

This applies to all standard bump types:
- `--bump major`: 1.0.0-beta.1 -> 2.0.0
- `--bump minor`: 1.0.0-beta.1 -> 1.1.0 
- `--bump patch`: 1.0.0-beta.1 -> 1.0.1

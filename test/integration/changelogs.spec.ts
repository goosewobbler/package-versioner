import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { executeCliCommand } from '../utils/cli.js';
import { restoreFixtureState, saveFixtureState } from '../utils/file.js';
import { createConventionalCommit, initGitRepo } from '../utils/git.js';
import { createPackageJson, createVersionConfig, readChangelog } from '../utils/package.js';

/**
 * Fixture paths
 */
const FIXTURES_DIR = join(process.cwd(), 'test/fixtures');
const CHANGELOG_FIXTURE_DIR = join(FIXTURES_DIR, 'changelog-test');
const KEEP_A_CHANGELOG_DIR = join(CHANGELOG_FIXTURE_DIR, 'keep-a-changelog');
const ANGULAR_CHANGELOG_DIR = join(CHANGELOG_FIXTURE_DIR, 'angular-changelog');

describe('Changelog Integration Tests', () => {
  // Setup and teardown for each test
  beforeAll(() => {
    // Ensure fixtures directory exists
    if (!existsSync(FIXTURES_DIR)) {
      mkdirSync(FIXTURES_DIR, { recursive: true });
    }

    // Save the original state of all config files
    saveFixtureState(FIXTURES_DIR);
  });

  // Restore all package.json files after tests complete
  afterAll(() => {
    restoreFixtureState(FIXTURES_DIR);
  });

  describe('Keep a Changelog Format', () => {
    beforeEach(() => {
      // Clean up and recreate the fixture directory
      if (existsSync(KEEP_A_CHANGELOG_DIR)) {
        rmSync(KEEP_A_CHANGELOG_DIR, { recursive: true, force: true });
      }
      mkdirSync(KEEP_A_CHANGELOG_DIR, { recursive: true });

      // Initialize git repo
      initGitRepo(KEEP_A_CHANGELOG_DIR);

      // Create package.json
      createPackageJson(KEEP_A_CHANGELOG_DIR, 'keep-a-changelog-test');

      // Create version.config.json with keep-a-changelog format
      createVersionConfig(KEEP_A_CHANGELOG_DIR, {
        preset: 'conventional-commits',
        packages: ['.'],
        versionPrefix: 'v',
        updateChangelog: true,
        changelogFormat: 'keep-a-changelog',
      });

      // Add files to git
      execSync('git add .', { cwd: KEEP_A_CHANGELOG_DIR });
      execSync('git commit -m "chore: setup project"', { cwd: KEEP_A_CHANGELOG_DIR });
    });

    it('should generate a changelog file with Keep a Changelog format', () => {
      // Create different types of commits for changelog generation
      createConventionalCommit(KEEP_A_CHANGELOG_DIR, 'feat', 'add new feature');
      createConventionalCommit(KEEP_A_CHANGELOG_DIR, 'fix', 'fix a bug', 'core');
      createConventionalCommit(KEEP_A_CHANGELOG_DIR, 'docs', 'improve documentation');

      // Execute the version bump command
      executeCliCommand('bump minor', KEEP_A_CHANGELOG_DIR);

      // Verify the changelog was created and has the correct format
      const changelog = readChangelog(KEEP_A_CHANGELOG_DIR);

      // Check for Keep a Changelog structure
      expect(changelog).toContain('# Changelog');
      expect(changelog).toContain('The format is based on [Keep a Changelog]');

      // Check for appropriate sections
      expect(changelog).toContain('## [0.2.0]');
      expect(changelog).toContain('### Added');
      expect(changelog).toContain('### Fixed');
      expect(changelog).toContain('### Changed');

      // Check content
      expect(changelog).toContain('- add new feature');
      expect(changelog).toContain('- **core**: fix a bug');
      expect(changelog).toContain('- improve documentation');
    });

    it('should update an existing Keep a Changelog format changelog', () => {
      // First generate a changelog
      createConventionalCommit(KEEP_A_CHANGELOG_DIR, 'feat', 'add first feature');
      executeCliCommand('bump minor', KEEP_A_CHANGELOG_DIR);

      // Now add more commits and generate a new version
      createConventionalCommit(KEEP_A_CHANGELOG_DIR, 'fix', 'fix a critical bug');
      executeCliCommand('bump patch', KEEP_A_CHANGELOG_DIR);

      // Verify the changelog was updated
      const changelog = readChangelog(KEEP_A_CHANGELOG_DIR);

      // Check for both versions
      expect(changelog).toContain('## [0.2.1]');
      expect(changelog).toContain('## [0.2.0]');

      // Check content
      expect(changelog).toContain('- fix a critical bug');
      expect(changelog).toContain('- add first feature');
    });

    it('should properly handle breaking changes', () => {
      // Create a breaking change commit
      createConventionalCommit(KEEP_A_CHANGELOG_DIR, 'feat', 'add breaking feature', 'api', true);

      // Execute the version bump command
      executeCliCommand('bump major', KEEP_A_CHANGELOG_DIR);

      // Verify the changelog was created and has the correct format
      const changelog = readChangelog(KEEP_A_CHANGELOG_DIR);

      // Check content - breaking changes should be marked
      expect(changelog).toContain('## [1.0.0]');
      expect(changelog).toContain('### Added');
      expect(changelog).toContain('- **BREAKING** **api**: add breaking feature');
    });
  });

  describe('Angular Changelog Format', () => {
    beforeEach(() => {
      // Clean up and recreate the fixture directory
      if (existsSync(ANGULAR_CHANGELOG_DIR)) {
        rmSync(ANGULAR_CHANGELOG_DIR, { recursive: true, force: true });
      }
      mkdirSync(ANGULAR_CHANGELOG_DIR, { recursive: true });

      // Initialize git repo
      initGitRepo(ANGULAR_CHANGELOG_DIR);

      // Create package.json
      createPackageJson(ANGULAR_CHANGELOG_DIR, 'angular-changelog-test');

      // Create version.config.json with angular format
      createVersionConfig(ANGULAR_CHANGELOG_DIR, {
        preset: 'conventional-commits',
        packages: ['.'],
        versionPrefix: 'v',
        updateChangelog: true,
        changelogFormat: 'angular',
      });

      // Add files to git
      execSync('git add .', { cwd: ANGULAR_CHANGELOG_DIR });
      execSync('git commit -m "chore: setup project"', { cwd: ANGULAR_CHANGELOG_DIR });
    });

    it('should generate a changelog file with Angular format', () => {
      // Create different types of commits for changelog generation
      createConventionalCommit(ANGULAR_CHANGELOG_DIR, 'feat', 'add new feature', 'ui');
      createConventionalCommit(ANGULAR_CHANGELOG_DIR, 'fix', 'fix a critical bug', 'core');
      createConventionalCommit(ANGULAR_CHANGELOG_DIR, 'perf', 'improve performance', 'api');

      // Execute the version bump command
      executeCliCommand('bump minor', ANGULAR_CHANGELOG_DIR);

      // Verify the changelog was created and has the correct format
      const changelog = readChangelog(ANGULAR_CHANGELOG_DIR);

      // Check for Angular structure
      expect(changelog).toContain('# Changelog');

      // Check for appropriate sections (Angular-style)
      expect(changelog).toContain('## [0.2.0]');
      expect(changelog).toContain('### Features');
      expect(changelog).toContain('### Bug Fixes');
      expect(changelog).toContain('### Performance Improvements');

      // Check content grouped by scope
      expect(changelog).toContain('* **ui:**');
      expect(changelog).toContain('* **core:**');
      expect(changelog).toContain('* **api:**');

      // Check specific entries
      expect(changelog).toMatch(/\* \*\*ui:\*\*[\s\S]*add new feature/);
      expect(changelog).toMatch(/\* \*\*core:\*\*[\s\S]*fix a critical bug/);
      expect(changelog).toMatch(/\* \*\*api:\*\*[\s\S]*improve performance/);
    });

    it('should update an existing Angular format changelog', () => {
      // First generate a changelog
      createConventionalCommit(ANGULAR_CHANGELOG_DIR, 'feat', 'add first feature', 'ui');
      executeCliCommand('bump minor', ANGULAR_CHANGELOG_DIR);

      // Now add more commits and generate a new version
      createConventionalCommit(ANGULAR_CHANGELOG_DIR, 'fix', 'fix a critical bug', 'core');
      executeCliCommand('bump patch', ANGULAR_CHANGELOG_DIR);

      // Verify the changelog was updated
      const changelog = readChangelog(ANGULAR_CHANGELOG_DIR);

      // Check for both versions
      expect(changelog).toContain('## [0.2.1]');
      expect(changelog).toContain('## [0.2.0]');

      // Check content in proper sections
      expect(changelog).toMatch(
        /## \[0.2.1\][\s\S]*Bug Fixes[\s\S]*\*\*core:\*\*[\s\S]*fix a critical bug/,
      );
      expect(changelog).toMatch(
        /## \[0.2.0\][\s\S]*Features[\s\S]*\*\*ui:\*\*[\s\S]*add first feature/,
      );
    });

    it('should add a dedicated breaking changes section for breaking changes', () => {
      // Create a breaking change commit
      createConventionalCommit(ANGULAR_CHANGELOG_DIR, 'feat', 'add breaking feature', 'api', true);

      // Execute the version bump command
      executeCliCommand('bump major', ANGULAR_CHANGELOG_DIR);

      // Verify the changelog has a BREAKING CHANGES section
      const changelog = readChangelog(ANGULAR_CHANGELOG_DIR);

      // Check content - features and breaking changes sections
      expect(changelog).toContain('## [1.0.0]');
      expect(changelog).toContain('### Features');
      expect(changelog).toContain('### BREAKING CHANGES');

      // The feature should appear in both sections
      expect(changelog).toMatch(/Features[\s\S]*\*\*api:\*\*[\s\S]*add breaking feature/);
      expect(changelog).toMatch(/BREAKING CHANGES[\s\S]*\*\*api:\*\*[\s\S]*add breaking feature/);
    });
  });
});

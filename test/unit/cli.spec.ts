import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as configModule from '../../src/config.js';
import { VersionEngine } from '../../src/core/versionEngine.js';
import * as indexModule from '../../src/index.js';
import type { Config } from '../../src/types.js';

// Mock dependencies
vi.mock('../../src/config.js');
vi.mock('../../src/core/versionEngine.js');
vi.mock('../../src/utils/logging.js');
vi.mock('commander', async () => {
  const actual = (await vi.importActual('commander')) as { Command: typeof Command };
  return {
    ...actual,
    Command: vi.fn().mockImplementation(() => {
      const originalCommand = new actual.Command();

      // Add spies to track method calls
      originalCommand.parse = vi.fn().mockReturnThis();

      // Keep track of commands and their actions
      const commands = new Map<string, { handler: unknown; isDefault?: boolean }>();

      // Override command method to track commands
      const originalCommandMethod = originalCommand.command;
      originalCommand.command = vi.fn((name, opts) => {
        const cmd = originalCommandMethod.call(originalCommand, name, opts);
        cmd.action = vi.fn((handler) => {
          // Store the command and handler
          commands.set(name, { handler, isDefault: opts?.isDefault });
          return cmd;
        });
        return cmd;
      });

      // Add our custom methods via type assertion
      const extendedCommand = originalCommand as typeof originalCommand & {
        getCommandHandler: (name: string) => unknown;
        getCommands: () => Array<[string, { handler: unknown; isDefault?: boolean }]>;
        getDefaultCommand: () => string | null;
      };

      extendedCommand.getCommandHandler = (name: string) => commands.get(name)?.handler;
      extendedCommand.getCommands = () => Array.from(commands.entries());
      extendedCommand.getDefaultCommand = () => {
        for (const [name, { isDefault }] of commands.entries()) {
          if (isDefault) return name;
        }
        return null;
      };

      return extendedCommand;
    }),
  };
});

describe('CLI Interface', () => {
  let mockProcess: Partial<NodeJS.Process>;
  const originalProcess: NodeJS.Process = process;
  const mockConfig: Partial<Config> = {
    synced: false,
    packages: ['package-a'],
    dryRun: false,
  };

  beforeEach(() => {
    // Create a mock process object
    mockProcess = {
      argv: ['node', 'index.js'],
      // Fix Mock type error with appropriate type cast
      exit: vi.fn() as unknown as (code?: number | undefined) => never,
      cwd: vi.fn().mockReturnValue('/test/workspace'),
    };

    // Replace global process
    global.process = mockProcess as NodeJS.Process;

    // Setup mocks
    vi.mocked(configModule.loadConfig, { partial: true }).mockResolvedValue(mockConfig as Config);
    vi.mocked(VersionEngine.prototype.run, { partial: true }).mockResolvedValue(undefined);
    vi.mocked(VersionEngine.prototype.setStrategy, { partial: true }).mockReturnValue(undefined);
  });

  afterEach(() => {
    // Restore original process
    global.process = originalProcess;

    // Clear mocks
    vi.clearAllMocks();
  });

  it('should define a default command', async () => {
    // Call the run function, which sets up the CLI
    await indexModule.run();

    // Get the commander instance
    const commanderInstance = vi.mocked(Command, { partial: true }).mock.results[0].value;

    // Check if there's a default command defined
    const defaultCommand = commanderInstance.getDefaultCommand();
    expect(defaultCommand).toBe('version');
  });

  it('should execute the version command when no command is specified', async () => {
    // Set argv to simulate CLI without a specific command
    mockProcess.argv = ['node', 'index.js', '--dry-run'];

    // Call the run function
    await indexModule.run();

    // Get the commander instance
    const commanderInstance = vi.mocked(Command, { partial: true }).mock.results[0].value;

    // Check if parse was called
    expect(commanderInstance.parse).toHaveBeenCalled();

    // Verify the command structure
    expect(commanderInstance.getCommands()).toContainEqual([
      'version',
      expect.objectContaining({ isDefault: true }),
    ]);
  });

  it('should execute the regenerate-changelog command when explicitly specified', async () => {
    // Set argv to simulate CLI with regenerate-changelog command
    mockProcess.argv = ['node', 'index.js', 'regenerate-changelog', '--dry-run'];

    // Call the run function
    await indexModule.run();

    // Get the commander instance
    const commanderInstance = vi.mocked(Command, { partial: true }).mock.results[0].value;

    // Check if parse was called
    expect(commanderInstance.parse).toHaveBeenCalled();

    // Check that regenerate-changelog command exists
    const commands = commanderInstance.getCommands();
    expect(commands.map(([cmdName]: [string, unknown]) => cmdName)).toContain(
      'regenerate-changelog',
    );
  });
});

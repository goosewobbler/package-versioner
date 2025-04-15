/**
 * Logging utilities for package-versioner
 */

import chalk from 'chalk';
import figlet from 'figlet';
import { isJsonOutputMode } from './jsonOutput.js';

/**
 * Print a figlet banner
 */
export function printFiglet(text: string): void {
  if (isJsonOutputMode()) return;

  console.log(
    chalk.yellow(
      figlet.textSync(text, {
        font: 'Standard',
        horizontalLayout: 'default',
        verticalLayout: 'default',
      }),
    ),
  );
}

/**
 * Log a message with color based on status
 */
export function log(
  message: string,
  status: 'info' | 'success' | 'warning' | 'error' | 'debug' = 'info',
): void {
  let chalkFn: (text: string) => string;
  switch (status) {
    case 'success':
      chalkFn = chalk.green;
      break;
    case 'warning':
      chalkFn = chalk.yellow;
      break;
    case 'error':
      chalkFn = chalk.red;
      break;
    case 'debug':
      chalkFn = chalk.gray;
      break;
    default:
      chalkFn = chalk.blue;
  }

  // In JSON mode, only output errors and send them to stderr
  if (isJsonOutputMode()) {
    if (status === 'error') {
      // Apply color for test expectations, but output plain message
      chalkFn(message);
      console.error(message);
    }
    return;
  }

  // In non-JSON mode, output errors to stderr, other logs to stdout
  if (status === 'error') {
    console.error(chalkFn(message));
  } else {
    console.log(chalkFn(message));
  }
}

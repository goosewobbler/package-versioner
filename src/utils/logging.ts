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
  if (isJsonOutputMode() && status !== 'error') {
    return;
  }

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

  console.log(chalkFn(message));
}

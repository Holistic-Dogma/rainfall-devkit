/**
 * Utility functions for authentication
 */

import { spawn, exec } from 'child_process';
import { platform } from 'os';

/**
 * Open a URL in the default browser
 */
export function open(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const os = platform();
    let command: string;
    
    switch (os) {
      case 'darwin':
        command = 'open';
        break;
      case 'win32':
        command = 'start';
        break;
      default:
        command = 'xdg-open';
        break;
    }
    
    const child = spawn(command, [url], {
      detached: true,
      stdio: 'ignore',
      shell: os === 'win32',
    });
    
    child.on('error', (err) => {
      reject(err);
    });
    
    // Give it a moment to start
    setTimeout(() => {
      resolve();
    }, 500);
  });
}

/**
 * Check if a command exists in the system PATH
 */
export function commandExists(command: string): Promise<boolean> {
  return new Promise((resolve) => {
    const checkCmd = platform() === 'win32' ? `where ${command}` : `which ${command}`;
    exec(checkCmd, (error) => {
      resolve(!error);
    });
  });
}

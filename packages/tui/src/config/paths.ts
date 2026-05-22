/** Filesystem locations for code-journal's own state. */
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Root of code-journal's state directory (`~/.code-journal` by default).
 * Overridable via the CJ_HOME environment variable (used by tests).
 */
export function cjHome(): string {
  const override = process.env.CJ_HOME?.trim();
  return override && override.length > 0 ? override : join(homedir(), '.code-journal');
}

export function configPath(): string {
  return join(cjHome(), 'config.json');
}

/** Credentials live in their own file so it can carry stricter (0600) permissions. */
export function credentialsPath(): string {
  return join(cjHome(), 'credentials.json');
}

export function uploadsPath(): string {
  return join(cjHome(), 'uploads.json');
}

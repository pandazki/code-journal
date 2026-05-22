/**
 * Config + credentials persistence.
 *
 *   ~/.code-journal/tui/config.json       projects + S3 non-secret settings  (0644)
 *   ~/.code-journal/tui/credentials.json  S3 access key + secret             (0600)
 *
 * The AWS-CLI-style split keeps the secret in a tighter-permission file and
 * lets config.json be safely shared / version-diffed.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { configPath, credentialsPath, cjHome } from './paths';

export interface Project {
  /** slug — matches /^[A-Za-z0-9][A-Za-z0-9_-]*$/ */
  id: string;
  name: string;
  /** absolute cwd paths whose coding-agent sessions belong to this project */
  cwds: string[];
}

export interface S3Settings {
  /** e.g. https://s3.us-east-1.amazonaws.com, https://<accountid>.r2.cloudflarestorage.com */
  endpoint: string;
  region: string;
  bucket: string;
  /** key prefix under the bucket; may be '' */
  prefix: string;
  /** path-style addressing — required by MinIO and most S3-compatible stores */
  forcePathStyle: boolean;
}

export interface Credentials {
  accessKeyId: string;
  secretAccessKey: string;
}

/**
 * Where the first-run wizard is up to. 'done' (or absent on a pre-existing
 * config) means the app boots straight to the Board.
 */
export type WizardStep = 'projects' | 's3' | 'cron' | 'done';
const WIZARD_STEPS: readonly WizardStep[] = ['projects', 's3', 'cron', 'done'];

export interface Config {
  version: 1;
  projects: Project[];
  s3: S3Settings | null;
  /** absent until the wizard records progress (or detects a pre-existing setup) */
  wizardStep?: WizardStep;
}

export const PROJECT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export function emptyConfig(): Config {
  return { version: 1, projects: [], s3: null };
}

/** Write JSON atomically (tmp file + rename) so a crash never leaves a half file. */
function atomicWriteJson(path: string, value: unknown, mode: number): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', { mode });
  renameSync(tmp, path);
  try {
    chmodSync(path, mode);
  } catch {
    /* best effort — some filesystems reject chmod */
  }
}

/** True once the config file exists — i.e. setup has been run at least once. */
export function configExists(): boolean {
  return existsSync(configPath());
}

/** Load config.json, falling back to an empty config when absent or corrupt. */
export function loadConfig(): Config {
  try {
    const raw = JSON.parse(readFileSync(configPath(), 'utf8')) as Partial<Config>;
    return {
      version: 1,
      projects: Array.isArray(raw.projects) ? raw.projects.filter(isProject) : [],
      s3: raw.s3 && isS3(raw.s3) ? raw.s3 : null,
      ...(raw.wizardStep && WIZARD_STEPS.includes(raw.wizardStep)
        ? { wizardStep: raw.wizardStep }
        : {}),
    };
  } catch {
    return emptyConfig();
  }
}

export function saveConfig(config: Config): void {
  atomicWriteJson(configPath(), config, 0o644);
}

export function loadCredentials(): Credentials | null {
  try {
    const raw = JSON.parse(readFileSync(credentialsPath(), 'utf8')) as Partial<Credentials>;
    if (typeof raw.accessKeyId === 'string' && typeof raw.secretAccessKey === 'string') {
      return { accessKeyId: raw.accessKeyId, secretAccessKey: raw.secretAccessKey };
    }
  } catch {
    /* fall through */
  }
  return null;
}

export function saveCredentials(creds: Credentials): void {
  atomicWriteJson(credentialsPath(), creds, 0o600);
}

/** Absolute home dir, exposed for the "where is my config" line in the UI. */
export function configHome(): string {
  return cjHome();
}

function isProject(p: unknown): p is Project {
  return (
    !!p &&
    typeof p === 'object' &&
    typeof (p as Project).id === 'string' &&
    typeof (p as Project).name === 'string' &&
    Array.isArray((p as Project).cwds)
  );
}

function isS3(s: unknown): s is S3Settings {
  return (
    !!s &&
    typeof s === 'object' &&
    typeof (s as S3Settings).endpoint === 'string' &&
    typeof (s as S3Settings).bucket === 'string'
  );
}

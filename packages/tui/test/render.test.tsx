import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';

import { render } from 'ink-testing-library';
import React from 'react';

import { App } from '../src/app';
import { emptyConfig, saveConfig } from '../src/config/config';
import { ConfigProvider, type ConfigStore } from '../src/hooks/useConfig';
import { CronModal } from '../src/modals/CronModal';
import { HelpModal } from '../src/modals/HelpModal';
import { LogModal } from '../src/modals/LogModal';
import { type Nav, NavProvider } from '../src/navigation';
import { ProjectEditScreen } from '../src/screens/ProjectEditScreen';
import { S3ConfigScreen } from '../src/screens/S3ConfigScreen';

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const noop = (): void => {};

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'cj-tui-render-'));
  process.env.CJ_HOME = home;
});
afterEach(() => {
  delete process.env.CJ_HOME;
  rmSync(home, { recursive: true, force: true });
});

function harness(children: React.ReactNode): React.ReactElement {
  const store: ConfigStore = {
    config: emptyConfig(),
    credentials: null,
    setConfig: noop,
    setCredentials: noop,
  };
  const nav: Nav = { openTranscript: noop, back: noop };
  return (
    <ConfigProvider value={store}>
      <NavProvider value={nav}>{children}</NavProvider>
    </ConfigProvider>
  );
}

test('App boots to the Board once the wizard is done', async () => {
  saveConfig({ ...emptyConfig(), wizardStep: 'done' });
  const { lastFrame, unmount } = render(<App checkMode={false} />);
  await delay(80);
  const frame = lastFrame() ?? '';
  assert.match(frame, /code-journal/);
  assert.match(frame, /PROJECTS/);
  assert.match(frame, /SESSIONS/);
  unmount();
});

test('App resumes the wizard at the recorded step', async () => {
  // wizardStep persisted at 's3' → next launch resumes on the S3 step
  saveConfig({ ...emptyConfig(), wizardStep: 's3' });
  const { lastFrame, unmount } = render(<App checkMode={false} />);
  await delay(80);
  const frame = lastFrame() ?? '';
  assert.match(frame, /Setup 2\/3/);
  assert.match(frame, /S3 settings/);
  unmount();
});

test('S3ConfigScreen mounts and renders the form fields', async () => {
  const { lastFrame, unmount } = render(harness(<S3ConfigScreen onSaved={noop} onCancel={noop} />));
  await delay(40);
  const frame = lastFrame() ?? '';
  assert.match(frame, /S3 settings/);
  assert.match(frame, /endpoint/);
  assert.match(frame, /bucket/);
  unmount();
});

test('ProjectEditScreen mounts in new-project mode', async () => {
  const { lastFrame, unmount } = render(harness(<ProjectEditScreen projectId={null} onClose={noop} />));
  await delay(40);
  const frame = lastFrame() ?? '';
  assert.match(frame, /New project/);
  assert.match(frame, /add cwd/);
  unmount();
});

test('CronModal shows a Continue row in wizard mode', async () => {
  const { lastFrame, unmount } = render(harness(<CronModal onClose={noop} onContinue={noop} />));
  await delay(40);
  const frame = lastFrame() ?? '';
  assert.match(frame, /Scheduled upload/);
  assert.match(frame, /Continue/);
  unmount();
});

test('LogModal mounts', async () => {
  const { lastFrame, unmount } = render(harness(<LogModal onClose={noop} />));
  await delay(40);
  assert.match(lastFrame() ?? '', /Activity log/);
  unmount();
});

test('HelpModal lists keybindings', async () => {
  const { lastFrame, unmount } = render(harness(<HelpModal onClose={noop} />));
  await delay(40);
  assert.match(lastFrame() ?? '', /switch panel/);
  unmount();
});

/**
 * Root component. Two startup modes:
 *   - Wizard — the default until setup is finished (resumable across launches).
 *   - Board  — the persistent multi-panel app, once the wizard is done.
 * A transcript drill-in can layer over the Board.
 *
 * Config and credentials live here and flow down through context.
 */
import { useApp } from 'ink';
import React, { useEffect, useMemo, useState } from 'react';

import {
  type Config,
  type Credentials,
  type WizardStep,
  loadConfig,
  loadCredentials,
  saveConfig,
  saveCredentials,
} from './config/config';
import { ConfigProvider, type ConfigStore } from './hooks/useConfig';
import { type Nav, NavProvider, type TranscriptRoute } from './navigation';
import { Board } from './screens/Board';
import { TranscriptScreen } from './screens/TranscriptScreen';
import { Wizard } from './screens/Wizard';

export interface AppProps {
  /** --check mode: render one frame then exit 0 (binary smoke-test). */
  checkMode: boolean;
}

function transcriptKey(route: TranscriptRoute): string {
  if (route.kind === 'subagent') return `sub:${route.relPath}`;
  return `txn:${route.locator.kind === 'local' ? route.locator.ref.path : route.locator.sessionId}`;
}

/** Resolve where to start: an explicit wizardStep, else infer from config shape. */
function initialWizardStep(config: Config): WizardStep {
  if (config.wizardStep) return config.wizardStep;
  // a pre-existing setup (projects + S3 already configured) skips the wizard
  return config.projects.length > 0 && config.s3 ? 'done' : 'projects';
}

export function App({ checkMode }: AppProps): React.ReactElement {
  const { exit } = useApp();
  const [config, setConfigState] = useState<Config>(() => loadConfig());
  const [credentials, setCredentialsState] = useState<Credentials | null>(() => loadCredentials());
  const [wizardStep, setWizardStep] = useState<WizardStep>(() => initialWizardStep(config));
  const [stack, setStack] = useState<TranscriptRoute[]>([]);

  useEffect(() => {
    if (!checkMode) return;
    const t = setTimeout(() => exit(), 250);
    return () => clearTimeout(t);
  }, [checkMode, exit]);

  // record the resolved step the first time, so a fresh install is recognised
  // as "wizard in progress" rather than "pre-existing" on the next launch.
  useEffect(() => {
    if (config.wizardStep === undefined) {
      const next = { ...config, wizardStep };
      saveConfig(next);
      setConfigState(next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const configStore: ConfigStore = useMemo(
    () => ({
      config,
      credentials,
      setConfig: (c) => {
        saveConfig(c);
        setConfigState(c);
      },
      setCredentials: (c) => {
        saveCredentials(c);
        setCredentialsState(c);
      },
    }),
    [config, credentials],
  );

  const advanceWizard = (next: WizardStep): void => {
    setWizardStep(next);
    setConfigState((c) => {
      const nc = { ...c, wizardStep: next };
      saveConfig(nc);
      return nc;
    });
  };

  const nav: Nav = useMemo(
    () => ({
      openTranscript: (route) => setStack((s) => [...s, route]),
      back: () => setStack((s) => s.slice(0, -1)),
    }),
    [],
  );

  const top = stack[stack.length - 1];
  const showWizard = !checkMode && wizardStep !== 'done';

  return (
    <ConfigProvider value={configStore}>
      <NavProvider value={nav}>
        {showWizard ? (
          <Wizard step={wizardStep} onAdvance={advanceWizard} />
        ) : top ? (
          <TranscriptScreen key={transcriptKey(top)} route={top} />
        ) : (
          <Board />
        )}
      </NavProvider>
    </ConfigProvider>
  );
}

/**
 * First-run wizard — a resumable three-step onboarding. Each step reuses the
 * same component the Board opens as a modal; quitting (Esc) exits the app with
 * the step un-advanced, so the next launch resumes exactly here. When the cron
 * step is passed, the app boots to the Board from then on.
 */
import { useApp } from 'ink';
import React from 'react';

import type { WizardStep } from '../config/config';
import { CronModal } from '../modals/CronModal';
import { ScanModal } from '../modals/ScanModal';
import { S3ConfigScreen } from './S3ConfigScreen';

export function Wizard({
  step,
  onAdvance,
}: {
  step: WizardStep;
  onAdvance: (next: WizardStep) => void;
}): React.ReactElement {
  const { exit } = useApp();

  if (step === 'projects') {
    return (
      <ScanModal
        wizardLabel="Setup 1/3 · projects"
        onDone={() => onAdvance('s3')}
        onCancel={() => exit()}
      />
    );
  }
  if (step === 's3') {
    return (
      <S3ConfigScreen
        wizardLabel="Setup 2/3 · S3 upload target"
        onSaved={() => onAdvance('cron')}
        onCancel={() => exit()}
      />
    );
  }
  if (step === 'cron') {
    return (
      <CronModal
        wizardLabel="Setup 3/3 · scheduled upload (default every 4h)"
        onContinue={() => onAdvance('done')}
        onClose={() => exit()}
      />
    );
  }
  return <></>;
}

/** S3-compatible upload-target form: endpoint, bucket, credentials, test, save. */
import { Box, Text } from 'ink';
import React, { useState } from 'react';

import { HintBar, ScreenFrame } from '../components/ScreenFrame';
import { Spinner } from '../components/Spinner';
import { TextInput } from '../components/TextInput';
import { applyTextKey } from '../components/textEditing';
import type { Credentials, S3Settings } from '../config/config';
import { useConfig } from '../hooks/useConfig';
import { useScreenInput } from '../hooks/useScreenInput';
import { makeS3Client, normalizeEndpoint } from '../s3/client';
import { testConnection } from '../s3/storage';
import { theme } from '../theme';

interface FormValues {
  endpoint: string;
  region: string;
  bucket: string;
  prefix: string;
  pathStyle: boolean;
  accessKeyId: string;
  secretAccessKey: string;
}

// focus order — index into this drives the form
const TEXT_KEYS: Array<keyof FormValues | null> = [
  'endpoint',
  'region',
  'bucket',
  'prefix',
  null, // pathStyle (toggle, not text)
  'accessKeyId',
  'secretAccessKey',
];
const ROW_COUNT = TEXT_KEYS.length + 2; // + test + save
const TEST_ROW = TEXT_KEYS.length;
const SAVE_ROW = TEXT_KEYS.length + 1;

type TestState = { status: 'idle' | 'testing' | 'ok' | 'error'; message?: string };

export function S3ConfigScreen({
  onSaved,
  onCancel,
  wizardLabel,
}: {
  onSaved: () => void;
  onCancel: () => void;
  wizardLabel?: string;
}): React.ReactElement {
  const { config, credentials, setConfig, setCredentials } = useConfig();

  const [v, setV] = useState<FormValues>({
    endpoint: config.s3?.endpoint ?? '',
    region: config.s3?.region ?? 'us-east-1',
    bucket: config.s3?.bucket ?? '',
    prefix: config.s3?.prefix ?? '',
    pathStyle: config.s3?.forcePathStyle ?? true,
    accessKeyId: credentials?.accessKeyId ?? '',
    secretAccessKey: credentials?.secretAccessKey ?? '',
  });
  const [focus, setFocus] = useState(0);
  const [test, setTest] = useState<TestState>({ status: 'idle' });
  const [saveErr, setSaveErr] = useState<string | null>(null);

  const toSettings = (): S3Settings => ({
    endpoint: normalizeEndpoint(v.endpoint),
    region: v.region.trim() || 'us-east-1',
    bucket: v.bucket.trim(),
    prefix: v.prefix.trim(),
    forcePathStyle: v.pathStyle,
  });
  const toCreds = (): Credentials => ({
    accessKeyId: v.accessKeyId.trim(),
    secretAccessKey: v.secretAccessKey,
  });

  const runTest = (): void => {
    if (!v.bucket.trim()) {
      setTest({ status: 'error', message: 'bucket is required' });
      return;
    }
    setTest({ status: 'testing' });
    const client = makeS3Client(toSettings(), toCreds());
    testConnection(client, toSettings()).then(
      () => setTest({ status: 'ok', message: 'bucket reachable' }),
      (e: unknown) => setTest({ status: 'error', message: e instanceof Error ? e.message : String(e) }),
    );
  };

  const doSave = (): void => {
    if (!v.bucket.trim()) {
      setSaveErr('bucket is required');
      return;
    }
    if (!v.accessKeyId.trim() || !v.secretAccessKey) {
      setSaveErr('access key id and secret are both required');
      return;
    }
    setConfig({ ...config, s3: toSettings() });
    setCredentials(toCreds());
    onSaved();
  };

  useScreenInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }
    if ((key.tab && key.shift) || key.upArrow) {
      setFocus((f) => (f + ROW_COUNT - 1) % ROW_COUNT);
      return;
    }
    if (key.tab || key.downArrow) {
      setFocus((f) => (f + 1) % ROW_COUNT);
      return;
    }
    if (focus === 4) {
      if (input === ' ') setV((s) => ({ ...s, pathStyle: !s.pathStyle }));
      return;
    }
    if (focus === TEST_ROW) {
      if (key.return) runTest();
      return;
    }
    if (focus === SAVE_ROW) {
      if (key.return) doSave();
      return;
    }
    if (key.return) {
      setFocus((f) => (f + 1) % ROW_COUNT);
      return;
    }
    const fkey = TEXT_KEYS[focus];
    if (fkey) {
      setV((s) => ({ ...s, [fkey]: applyTextKey(s[fkey] as string, input, key) }));
      setTest({ status: 'idle' });
      setSaveErr(null);
    }
  });

  const field = (idx: number, label: string, key: keyof FormValues, mask = false): React.ReactElement => (
    <Box>
      <Text color={focus === idx ? theme.brand : theme.dim}>{focus === idx ? '❯ ' : '  '}</Text>
      <Text color={focus === idx ? theme.text : theme.dim}>{label.padEnd(16)}</Text>
      <TextInput value={v[key] as string} focused={focus === idx} mask={mask} placeholder="—" />
    </Box>
  );

  return (
    <ScreenFrame
      title="S3 settings"
      subtitle={wizardLabel ?? 'S3-compatible upload target'}
      footer={
        <HintBar
          hints={[
            ['↑↓/tab', 'move'],
            ['space', 'toggle'],
            ['enter', 'activate'],
            ['esc', 'back'],
          ]}
        />
      }
    >
      <Box flexDirection="column">
        {field(0, 'endpoint', 'endpoint')}
        {field(1, 'region', 'region')}
        {field(2, 'bucket', 'bucket')}
        {field(3, 'key prefix', 'prefix')}
        <Box>
          <Text color={focus === 4 ? theme.brand : theme.dim}>{focus === 4 ? '❯ ' : '  '}</Text>
          <Text color={focus === 4 ? theme.text : theme.dim}>{'path style'.padEnd(16)}</Text>
          <Text>{v.pathStyle ? '[x]' : '[ ]'}</Text>
          <Text color={theme.dim}>{'  (on for MinIO / R2 / most non-AWS)'}</Text>
        </Box>
        {field(5, 'access key id', 'accessKeyId')}
        {field(6, 'secret key', 'secretAccessKey', true)}

        <Box marginTop={1}>
          <Text color={focus === TEST_ROW ? theme.brand : theme.dim}>
            {focus === TEST_ROW ? '❯ ' : '  '}
          </Text>
          <Text color={focus === TEST_ROW ? theme.text : theme.dim} bold={focus === TEST_ROW}>
            Test connection
          </Text>
          <Text>{'   '}</Text>
          {test.status === 'testing' ? <Spinner label="testing…" /> : null}
          {test.status === 'ok' ? <Text color={theme.ok}>{`✓ ${test.message}`}</Text> : null}
          {test.status === 'error' ? <Text color={theme.err}>{`✗ ${test.message}`}</Text> : null}
        </Box>
        <Box>
          <Text color={focus === SAVE_ROW ? theme.brand : theme.dim}>
            {focus === SAVE_ROW ? '❯ ' : '  '}
          </Text>
          <Text color={focus === SAVE_ROW ? theme.text : theme.dim} bold={focus === SAVE_ROW}>
            Save
          </Text>
          {saveErr ? <Text color={theme.err}>{`   ✗ ${saveErr}`}</Text> : null}
        </Box>
      </Box>
    </ScreenFrame>
  );
}

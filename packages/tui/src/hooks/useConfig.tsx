/** Config + credentials, loaded once at startup and mutated through this context. */
import { createContext, useContext } from 'react';

import type { Config, Credentials } from '../config/config';

export interface ConfigStore {
  config: Config;
  credentials: Credentials | null;
  /** persist a new config to disk and update state */
  setConfig: (config: Config) => void;
  /** persist new credentials to disk (0600) and update state */
  setCredentials: (credentials: Credentials) => void;
}

const ConfigContext = createContext<ConfigStore | null>(null);
export const ConfigProvider = ConfigContext.Provider;

export function useConfig(): ConfigStore {
  const store = useContext(ConfigContext);
  if (!store) throw new Error('useConfig() used outside <ConfigProvider>');
  return store;
}

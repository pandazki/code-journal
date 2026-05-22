/**
 * Navigation is deliberately tiny: the app is one persistent Board, and the
 * only thing that genuinely "navigates" is drilling into a transcript (and,
 * from there, into a subagent). Everything else is a Board-owned modal.
 */
import type { SessionRef } from '@code-journal/core';
import { createContext, useContext } from 'react';

/** Tells a transcript view where to load a session's content from. */
export type SessionLocator =
  | { kind: 'local'; ref: SessionRef }
  | { kind: 'remote'; projectId: string; sessionId: string; sizeBytes: number };

export type TranscriptRoute =
  | { kind: 'transcript'; projectId: string; locator: SessionLocator }
  | {
      kind: 'subagent';
      projectId: string;
      parent: SessionLocator;
      /** sidecar-relative path, e.g. "subagents/agent-a1.jsonl" */
      relPath: string;
      title: string;
    };

export interface Nav {
  /** push a transcript (or subagent) drill-in over the Board */
  openTranscript: (route: TranscriptRoute) => void;
  /** pop back — to the previous transcript, or to the Board */
  back: () => void;
}

const NavContext = createContext<Nav | null>(null);
export const NavProvider = NavContext.Provider;

export function useNav(): Nav {
  const nav = useContext(NavContext);
  if (!nav) throw new Error('useNav() used outside <NavProvider>');
  return nav;
}

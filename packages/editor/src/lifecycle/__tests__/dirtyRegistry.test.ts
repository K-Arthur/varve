import { describe, expect, it } from 'vitest';
import {
  collectUnsavedDocuments,
  displayName,
  hasUnsavedDocuments,
  scopeForIntent,
  scopeSessionIds,
} from '../dirtyRegistry';
import { createFakeApi } from './testHarness';

describe('dirty registry', () => {
  it('maps intents to scopes', () => {
    expect(scopeForIntent('close-document')).toBe('document');
    expect(scopeForIntent('close-window')).toBe('window');
    expect(scopeForIntent('quit-application')).toBe('application');
    expect(scopeForIntent('reload')).toBe('application');
    expect(scopeForIntent('restart')).toBe('application');
  });

  it('document scope inspects only the active session', () => {
    const controls = createFakeApi([
      { id: 'a', name: 'A.varve', dirty: true, filePath: '/p/a.varve' },
      { id: 'b', name: 'B.varve', dirty: true, filePath: '/p/b.varve' },
    ]);
    controls.setActive('a');
    const docs = collectUnsavedDocuments(controls.api, 'document');
    expect(docs.map((d) => d.sessionId)).toEqual(['a']);
  });

  it('window and application scopes see every session, visible or hidden', () => {
    const controls = createFakeApi([
      { id: 'a', name: 'A.varve', dirty: false, filePath: '/p/a.varve' },
      { id: 'b', name: 'B.varve', dirty: true, filePath: '/p/b.varve' },
      { id: 'c', name: 'Untitled', dirty: true },
    ]);
    const docs = collectUnsavedDocuments(controls.api, 'application');
    expect(docs.map((d) => d.sessionId)).toEqual(['b', 'c']);
    expect(docs[0]?.untitled).toBe(false);
    expect(docs[1]?.untitled).toBe(true);
  });

  it('ignores clean sessions', () => {
    const controls = createFakeApi([
      { id: 'a', name: 'A.varve', dirty: false, filePath: '/p/a.varve' },
      { id: 'b', name: 'B.varve', dirty: true, filePath: '/p/b.varve' },
    ]);
    expect(collectUnsavedDocuments(controls.api, 'window')).toHaveLength(1);
  });

  it('returns an empty document scope when nothing is active', () => {
    const controls = createFakeApi([
      { id: 'a', name: 'A.varve', dirty: true, filePath: '/p/a.varve' },
    ]);
    controls.setActive(null);
    expect(collectUnsavedDocuments(controls.api, 'document')).toHaveLength(0);
    expect(scopeSessionIds(controls.api, 'document')).toHaveLength(0);
  });

  it('hasUnsavedDocuments is a fast dirty check per scope', () => {
    const controls = createFakeApi([
      { id: 'a', name: 'A.varve', dirty: false, filePath: '/p/a.varve' },
      { id: 'b', name: 'B.varve', dirty: true, filePath: '/p/b.varve' },
    ]);
    controls.setActive('a');
    expect(hasUnsavedDocuments(controls.api, 'document')).toBe(false);
    expect(hasUnsavedDocuments(controls.api, 'window')).toBe(true);
  });

  it('disambiguates duplicate Untitled names by session order', () => {
    const sessions = [
      { id: 'a', name: 'Untitled' },
      { id: 'b', name: 'Untitled' },
      { id: 'c', name: 'Poster.varve' },
      { id: 'd', name: 'Untitled' },
    ];
    expect(displayName(sessions, sessions[0]!)).toBe('Untitled');
    expect(displayName(sessions, sessions[1]!)).toBe('Untitled 2');
    expect(displayName(sessions, sessions[2]!)).toBe('Poster.varve');
    expect(displayName(sessions, sessions[3]!)).toBe('Untitled 3');
  });

  it('keeps an editor-numbered Untitled name stable', () => {
    const sessions = [
      { id: 'a', name: 'Untitled' },
      { id: 'b', name: 'Untitled 2' },
    ];
    expect(displayName(sessions, sessions[0]!)).toBe('Untitled');
    expect(displayName(sessions, sessions[1]!)).toBe('Untitled 2');
  });

  it('counts a persisted browser save handle as not untitled', () => {
    const controls = createFakeApi([
      { id: 'a', name: 'Downloaded', dirty: true, saveHandleId: 'handle-1' },
      { id: 'b', name: 'Plain', dirty: true },
    ]);
    const docs = collectUnsavedDocuments(controls.api, 'window');
    expect(docs[0]?.untitled).toBe(false);
    expect(docs[1]?.untitled).toBe(true);
  });

  it('does not leak file paths into display names', () => {
    const controls = createFakeApi([
      { id: 'a', name: 'Poster.varve', dirty: true, filePath: '/home/user/Secret/Poster.varve' },
    ]);
    const [doc] = collectUnsavedDocuments(controls.api, 'window');
    expect(doc?.name).toBe('Poster.varve');
    expect(doc?.filePath).toBe('/home/user/Secret/Poster.varve');
  });
});

import { HomeShell } from '@strata/home';
import { createMemoryPlatform, makeFileEntry, makeProject, uuid } from '@strata/platform';
import React from 'react';
import { createRoot } from 'react-dom/client';

const PROJECTS = [
  makeProject({ id: uuid(), name: 'Brand', color: '#39d0c6' }),
  makeProject({ id: uuid(), name: 'Marketing', color: '#ff6b6b' }),
  makeProject({ id: uuid(), name: 'App UI', color: '#4ecdc4' }),
];

const TEMPLATE_JSON = JSON.stringify({
  id: 't1',
  name: 'Template',
  rootChildren: [],
  nodes: {},
  components: {},
  nextId: 1,
});

const FILES = Array.from({ length: 20 }, (_, i) => {
  const id = uuid();
  const now = Date.now() - i * 86_400_000;
  return {
    entry: makeFileEntry({
      id,
      name: `Design ${i + 1}`,
      kind: i % 5 === 0 ? 'image' : i % 5 === 1 ? 'figma' : 'strata',
      projectId: i < 8 ? PROJECTS[0]!.id : i < 14 ? PROJECTS[1]!.id : null,
      createdAt: now,
      updatedAt: now + 3_600_000,
      openedAt: i < 5 ? now + 1_800_000 : 0,
      size: 1024 * (i + 1),
      pinned: i < 2,
    }),
    json: TEMPLATE_JSON,
  };
});

const platform = createMemoryPlatform({ files: FILES, projects: PROJECTS });
const root = createRoot(document.getElementById('root')!);
root.render(
  React.createElement(HomeShell, {
    platform,
    onOpenFile: (entry) => {
      (window as unknown as Record<string, unknown>).__TEST_LAST_OPENED__ = entry;
    },
  }),
);

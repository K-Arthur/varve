/**
 * Command actions for comic callouts (speech, thought, caption, etc.)
 */

import type { CalloutKind } from '@varve/scene';
import { wrapTextInCallout } from '@varve/scene';
import type { EditorContextValue } from '../context';
import { getActionRegistry, type ActionCategory } from './ActionRegistry';

interface CalloutCommandDef {
  id: string;
  kind: CalloutKind;
  label: string;
  keywords: string[];
}

const CALLOUT_COMMANDS: readonly CalloutCommandDef[] = [
  {
    id: 'createSpeechBalloon',
    kind: 'speech',
    label: 'Add Speech Balloon',
    keywords: ['comic', 'lettering', 'dialogue', 'balloon', 'speech bubble'],
  },
  {
    id: 'createThoughtBalloon',
    kind: 'thought',
    label: 'Add Thought Balloon',
    keywords: ['comic', 'lettering', 'internal', 'thinking', 'cloud'],
  },
  {
    id: 'createCaptionBox',
    kind: 'caption',
    label: 'Add Caption Box',
    keywords: ['comic', 'narration', 'caption', 'text box'],
  },
  {
    id: 'createWhisperBalloon',
    kind: 'whisper',
    label: 'Add Whisper Balloon',
    keywords: ['comic', 'lettering', 'quiet', 'whisper', 'dashed'],
  },
  {
    id: 'createShoutBalloon',
    kind: 'shout',
    label: 'Add Shout Balloon',
    keywords: ['comic', 'lettering', 'loud', 'yell', 'shout', 'emphasis'],
  },
  {
    id: 'createBurstBalloon',
    kind: 'burst',
    label: 'Add Burst Balloon',
    keywords: ['comic', 'lettering', 'explosion', 'impact', 'burst', 'star'],
  },
  {
    id: 'createCloudBalloon',
    kind: 'cloud',
    label: 'Add Cloud Balloon',
    keywords: ['comic', 'lettering', 'weak', 'distant', 'scalloped'],
  },
] as const;

export function registerCalloutActions(editor: EditorContextValue): void {
  const registry = getActionRegistry();
  const category: ActionCategory = 'insert';

  for (const def of CALLOUT_COMMANDS) {
    const handler = () => {
      const textNodes = editor
        .selectedNodes()
        .filter((n): n is import('@varve/scene').TextNode => n.kind === 'text');
      const textNode = textNodes[0];

      // If a text node is selected, wrap it; otherwise, do nothing yet
      // (the user can use the Typography section button for new balloons)
      if (!textNode) {
        // For now, just skip if no text is selected
        // TODO: Consider creating a new text+balloon at canvas center
        return;
      }

      let groupId: string | null = null;
      editor.groupCompoundOperation(`Create ${def.kind} balloon`, () => {
        editor.updateDoc((document) => {
          const result = wrapTextInCallout(document, textNode.id, { kind: def.kind });
          if (!result) return document;
          groupId = result.groupId;
          return result.document;
        });
      });

      if (groupId) {
        editor.setSelectionRefs([groupId], { primary: groupId, origin: 'api' });
      }
    };

    registry.register(
      {
        id: def.id,
        label: def.label,
        category,
        keywords: def.keywords,
        context: 'always',
      },
      handler,
    );
  }
}

import type { ActionTracker } from './actionTracker';

export interface WorkflowPattern {
  sequence: string[];
  frequency: number;
  suggestion: string;
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function generateSuggestion(sequence: string[]): string {
  if (sequence.includes('copy') && sequence.includes('paste')) {
    return 'Use duplicate (Ctrl+D) instead';
  }

  if (
    sequence.some(
      (a) => a.startsWith('createShape') || a.startsWith('setFill') || a.startsWith('setStroke'),
    )
  ) {
    if (
      sequence.some((a) => a.startsWith('setFill')) ||
      sequence.some((a) => a.startsWith('setStroke'))
    ) {
      return 'Create a style?';
    }
  }

  const tools = sequence.filter((a) => a.startsWith('tool:'));
  if (
    tools.length >= 2 &&
    tools[0] === 'tool:select' &&
    tools[tools.length - 1] === 'tool:select'
  ) {
    const middleTool = tools.slice(1, -1).find((t) => t !== 'tool:select');
    if (middleTool) {
      const toolName = middleTool.slice(5);
      return `Add shortcut for ${toolName} tool`;
    }
  }

  return `Consider batching: ${sequence.join(' \u2192 ')}`;
}

export function detectPatterns(tracker: ActionTracker, windowMs?: number): WorkflowPattern[] {
  const window = windowMs ?? SEVEN_DAYS_MS;
  const sequence = tracker.getActionSequence(window);

  if (sequence.length < 2) return [];

  const patterns: WorkflowPattern[] = [];

  // Build trigram frequency map
  const trigramFreq = new Map<string, number>();
  for (let i = 0; i < sequence.length - 2; i++) {
    const key = `${sequence[i]}|${sequence[i + 1]}|${sequence[i + 2]}`;
    trigramFreq.set(key, (trigramFreq.get(key) ?? 0) + 1);
  }

  // Process trigrams
  const trigramKeys = new Set<string>();
  for (const [key, frequency] of trigramFreq) {
    if (frequency < 3) continue;
    if (trigramKeys.has(key)) continue;
    trigramKeys.add(key);

    const parts = key.split('|');
    const seq: string[] = [parts[0]!, parts[1]!, parts[2]!];
    const distinct = new Set(seq);
    if (distinct.size >= 2) {
      patterns.push({ sequence: seq, frequency, suggestion: generateSuggestion(seq) });
    }
  }

  // Build set of bigrams that are part of a found trigram (to avoid double-counting)
  const bigramsInTrigrams = new Set<string>();
  for (const p of patterns) {
    bigramsInTrigrams.add(`${p.sequence[0]}|${p.sequence[1]}`);
    if (p.sequence.length >= 3) {
      bigramsInTrigrams.add(`${p.sequence[1]}|${p.sequence[2]}`);
    }
  }

  // Build bigram frequency map (excluding bigrams covered by trigrams)
  const bigramFreq = new Map<string, number>();
  for (let i = 0; i < sequence.length - 1; i++) {
    const key = `${sequence[i]}|${sequence[i + 1]}`;
    if (bigramsInTrigrams.has(key)) continue;
    bigramFreq.set(key, (bigramFreq.get(key) ?? 0) + 1);
  }

  // Process bigrams
  for (const [key, frequency] of bigramFreq) {
    if (frequency < 3) continue;

    const parts = key.split('|');
    const seq: string[] = [parts[0]!, parts[1]!];
    const distinct = new Set(seq);
    if (distinct.size >= 2) {
      patterns.push({ sequence: seq, frequency, suggestion: generateSuggestion(seq) });
    }
  }

  return patterns.sort((a, b) => b.frequency - a.frequency);
}

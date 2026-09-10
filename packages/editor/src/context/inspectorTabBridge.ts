import type { InspectorTab, IntelligenceTab } from './types';

interface InspectorTabRequest {
  tab: InspectorTab;
  subTab?: IntelligenceTab;
}

let inspectorTabHandler: ((request: InspectorTabRequest) => void) | null = null;

export function setInspectorTabHandler(
  handler: ((request: InspectorTabRequest) => void) | null,
): void {
  inspectorTabHandler = handler;
}

export function requestInspectorTab(tab: InspectorTab, subTab?: IntelligenceTab): void {
  inspectorTabHandler?.({ tab, subTab });
}

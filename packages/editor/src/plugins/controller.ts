import type { Document } from '@varve/scene';
import type { ReactNode } from 'react';
import { getActionRegistry } from '../actions/ActionRegistry';
import {
  disablePlugin,
  enablePlugin,
  getRegisteredPlugins,
  hideContribution,
  onContributionsChange,
  registerPlugin,
  retryPlugin,
  showContribution,
  unregisterPlugin,
} from '../components/Inspector/pluginSections';
import type { EditorContextValue } from '../context/types';
import { renameIfUnlocked } from '../intelligence/autoNamer';
import { isNodeEffectivelyLocked } from '../scene/world';
import type { GuestInput, GuestOutput, RenameProposal, SelectedNodeSnapshot } from './contract';
import { parseGuestOutput } from './contract';
import {
  type PluginCommandManifest,
  type PluginPackage,
  type PluginPackageManifest,
  type PluginPermission,
  parsePluginPackage,
  pluginThumbnailDataUrl,
} from './package';
import {
  deleteStoredPlugin,
  getStoredPluginState,
  listStoredPluginInventory,
  PluginStoreConflictError,
  putStoredPlugin,
  type StoredPlugin,
  type StoredPluginState,
  subscribeStoredPluginChanges,
  withStoredPluginGuard,
} from './store';
import { type GuestJob, startGuestJob } from './wasmRuntime';

const MAX_SELECTED_NODES = 100;
const MAX_RUNNING_JOBS = 2;

type RuntimeStatus =
  | 'ready'
  | 'disabled'
  | 'awaiting-permission'
  | 'running'
  | 'failed'
  | 'safe-mode';

interface ResultContext {
  documentId: string;
  sessionId: string;
  revision: number;
  selectionRevision: number;
  generation: number;
  pluginRevision: number;
}

export type PluginRunOutcome = { status: 'completed' | 'stopped' | 'stale' };

interface SavedResult {
  output: GuestOutput;
  context: ResultContext;
}

export interface PluginView {
  id: string;
  manifest: PluginPackageManifest;
  sha256: string;
  source: 'local-file';
  installedAt: number;
  enabled: boolean;
  grants: PluginPermission[];
  status: RuntimeStatus;
  lastError?: string;
  previousVersion?: string;
  /** Contribution IDs of Inspector panels the user chose to hide. */
  hiddenPanels: string[];
  /** Data URL made from the validated static PNG in the installed archive. */
  thumbnailUrl?: string;
  results: Record<string, GuestOutput>;
}

export interface PluginSnapshot {
  loading: boolean;
  error?: string;
  safeModeDisabled: boolean;
  plugins: PluginView[];
}

type SectionRenderer = (pluginId: string, commandId: string) => ReactNode;

function requestedPermissions(manifest: PluginPackageManifest): PluginPermission[] {
  return [...manifest.permissions.required, ...manifest.permissions.optional];
}

function checkedGrants(
  manifest: PluginPackageManifest,
  grants: PluginPermission[],
): PluginPermission[] {
  const allowed = new Set(requestedPermissions(manifest));
  if (grants.some((grant) => !allowed.has(grant)) || new Set(grants).size !== grants.length) {
    throw new Error('Permission grants do not match the package request');
  }
  return [...grants];
}

function compareVersions(a: string, b: string): number {
  const parse = (version: string) => {
    const match = /^(\d+\.\d+\.\d+)(?:-([^+]+))?(?:\+.*)?$/u.exec(version);
    if (!match) throw new Error('Invalid plugin version');
    return { core: match[1]!.split('.').map(BigInt), pre: match[2]?.split('.') };
  };
  const left = parse(a);
  const right = parse(b);
  for (let i = 0; i < 3; i++) {
    const l = left.core[i] ?? 0n;
    const r = right.core[i] ?? 0n;
    if (l !== r) return l > r ? 1 : -1;
  }
  if (!left.pre) return right.pre ? 1 : 0;
  if (!right.pre) return -1;
  for (let i = 0; i < Math.max(left.pre.length, right.pre.length); i++) {
    const l = left.pre[i];
    const r = right.pre[i];
    if (l === undefined) return -1;
    if (r === undefined) return 1;
    if (l === r) continue;
    const lNumber = /^\d+$/u.test(l);
    const rNumber = /^\d+$/u.test(r);
    if (lNumber && rNumber) return BigInt(l) > BigInt(r) ? 1 : -1;
    if (lNumber !== rNumber) return lNumber ? -1 : 1;
    return l < r ? -1 : 1;
  }
  return 0;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Returns the same document on any conflict; all proposed renames succeed together. */
export function applyRenameProposal(
  doc: Document,
  documentId: string,
  proposal: readonly RenameProposal[],
): Document {
  if (
    doc.id !== documentId ||
    proposal.length === 0 ||
    !proposal.every((item) => {
      const node = doc.nodes[item.id];
      return node?.name === item.expectedName && !isNodeEffectivelyLocked(doc, item.id);
    })
  )
    return doc;
  return proposal.reduce(
    (next, item) =>
      renameIfUnlocked(next, item.id, item.name, isNodeEffectivelyLocked(next, item.id)),
    doc,
  );
}

class ApplicationPluginController {
  private editor: EditorContextValue | null = null;
  private sectionRenderer: SectionRenderer | null = null;
  private records = new Map<string, StoredPlugin>();
  private thumbnailUrls = new Map<string, string>();
  private revisions = new Map<string, number>();
  private preparedArchives = new WeakMap<PluginPackage, Uint8Array>();
  private jobs = new Map<string, GuestJob>();
  private results = new Map<string, Map<string, SavedResult>>();
  private generations = new Map<string, number>();
  private pending = new Map<string, Promise<void>>();
  private actions = new Map<string, Map<string, (ctx: unknown) => void>>();
  private sections = new Set<string>();
  private sectionHashes = new Map<string, string>();
  private listeners = new Set<() => void>();
  private initialization: Promise<void> | null = null;
  private inspectorListening = false;
  private storeListening = false;
  private snapshot: PluginSnapshot = { loading: true, safeModeDisabled: false, plugins: [] };
  private safeModeDisabled = false;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): PluginSnapshot => this.snapshot;

  setEditor(editor: EditorContextValue | null): void {
    this.editor = editor;
  }

  /** Suppress all third-party runtime surfaces without changing saved choices. */
  setSafeModeDisabled(disabled: boolean): void {
    if (this.safeModeDisabled === disabled) return;
    this.safeModeDisabled = disabled;
    if (disabled) {
      for (const id of this.records.keys()) this.stop(id);
    }
    this.reconcileAll();
    this.emit();
  }

  setSectionRenderer(renderer: SectionRenderer | null): void {
    this.sectionRenderer = renderer;
    this.reconcileAll();
  }

  initialize(): Promise<void> {
    if (this.initialization) return this.initialization;
    this.initialization = listStoredPluginInventory()
      .then(async ({ plugins, revisions }) => {
        this.revisions = revisions;
        const checked: StoredPlugin[] = [];
        for (const record of plugins) {
          checked.push(
            await this.checkStoredRecord(record, this.revisions.get(record.manifest.id) ?? 1),
          );
        }
        this.records = new Map(checked.map((record) => [record.manifest.id, record]));
        if (!this.inspectorListening) {
          this.inspectorListening = true;
          onContributionsChange(() => this.handleInspectorFailures());
        }
        if (!this.storeListening) {
          this.storeListening = true;
          subscribeStoredPluginChanges((change) => this.handleStoreChange(change.id));
        }
        this.reconcileAll();
        this.emit(false);
      })
      .catch((error: unknown) => {
        this.emit(false, message(error));
      });
    return this.initialization;
  }

  async prepare(bytes: Uint8Array): Promise<PluginPackage> {
    const pkg = await parsePluginPackage(bytes);
    await startGuestJob(pkg.wasm, 'validate').result;
    this.preparedArchives.set(pkg, new Uint8Array(bytes));
    return pkg;
  }

  async install(pkg: PluginPackage, grants: PluginPermission[], enabled: boolean): Promise<void> {
    await this.initialize();
    const archive = this.preparedArchives.get(pkg);
    if (!archive) throw new Error('Review this package before installation');
    const verified = await parsePluginPackage(archive);
    if (
      verified.sha256 !== pkg.sha256 ||
      JSON.stringify(verified.manifest) !== JSON.stringify(pkg.manifest)
    ) {
      throw new Error('Package changed after review');
    }
    const accepted = checkedGrants(verified.manifest, grants);
    await startGuestJob(verified.wasm, 'validate').result;
    await this.enqueue(verified.manifest.id, async () => {
      const current = this.records.get(verified.manifest.id);
      if (!current && this.records.size >= 32)
        throw new Error('The 32-plugin local limit is reached');
      if (current && current.manifest.publisher !== verified.manifest.publisher) {
        throw new Error('A different publisher already owns this plugin ID');
      }
      if (current && compareVersions(verified.manifest.version, current.manifest.version) <= 0) {
        throw new Error('Choose a newer version, or use Roll back for the previous version');
      }
      if (current) this.stop(verified.manifest.id);
      const panelIds = new Set((verified.manifest.inspector ?? []).map((panel) => panel.id));
      const retainedPanels = current?.hiddenPanels?.filter((panelId) => panelIds.has(panelId));
      const next: StoredPlugin = {
        archive: new Uint8Array(archive),
        manifest: verified.manifest,
        wasm: verified.wasm,
        sha256: verified.sha256,
        grants: accepted,
        enabled,
        source: 'local-file',
        installedAt: Date.now(),
        ...(retainedPanels && retainedPanels.length > 0 ? { hiddenPanels: retainedPanels } : {}),
        previous: current?.lastError
          ? current.previous
          : current
            ? {
                archive: current.archive,
                manifest: current.manifest,
                wasm: current.wasm,
                sha256: current.sha256,
                grants: current.grants,
                installedAt: current.installedAt,
              }
            : undefined,
      };
      const nextRevision = await putStoredPlugin(
        next,
        this.revisions.get(verified.manifest.id) ?? 0,
      );
      this.revisions.set(verified.manifest.id, nextRevision);
      this.preparedArchives.delete(pkg);
      if (current) this.removeOwned(verified.manifest.id, true);
      this.records.set(verified.manifest.id, next);
      const thumbnailUrl = pluginThumbnailDataUrl(verified.thumbnail);
      if (thumbnailUrl) this.thumbnailUrls.set(verified.manifest.id, thumbnailUrl);
      else this.thumbnailUrls.delete(verified.manifest.id);
      this.reconcileOne(verified.manifest.id);
      this.emit();
    });
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    if (!enabled) this.stop(id);
    await this.enqueue(id, async () => {
      const current = this.requireRecord(id);
      if (current.enabled === enabled) return;
      const next = { ...current, enabled };
      await this.persist(next);
      this.records.set(id, next);
      this.reconcileOne(id);
      this.emit();
    });
  }

  async setGrants(id: string, grants: PluginPermission[]): Promise<void> {
    const active = this.requireRecord(id);
    if (active.grants.some((grant) => !grants.includes(grant))) this.stop(id);
    await this.enqueue(id, async () => {
      const current = this.requireRecord(id);
      const accepted = checkedGrants(current.manifest, grants);
      if (current.grants.some((grant) => !accepted.includes(grant))) this.stop(id);
      const next = { ...current, grants: accepted };
      await this.persist(next);
      this.records.set(id, next);
      this.reconcileOne(id);
      this.emit();
    });
  }

  /**
   * Hide or show one contributed Inspector panel. Pure display preference:
   * it never touches the document, history, permissions, or runtime state,
   * and it survives restarts because it lives with the installation record.
   */
  async setPanelHidden(id: string, panelId: string, hidden: boolean): Promise<void> {
    await this.enqueue(id, async () => {
      const current = this.requireRecord(id);
      if (!current.manifest.inspector?.some((panel) => panel.id === panelId)) {
        throw new Error('This plugin does not contribute that Inspector panel');
      }
      const hiddenSet = new Set(current.hiddenPanels ?? []);
      if (hidden) hiddenSet.add(panelId);
      else hiddenSet.delete(panelId);
      const next: StoredPlugin = {
        ...current,
        hiddenPanels: hiddenSet.size > 0 ? [...hiddenSet].sort() : undefined,
      };
      await this.persist(next);
      this.records.set(id, next);
      this.reconcileOne(id);
      this.emit();
    });
  }

  async run(id: string, commandId: string): Promise<PluginRunOutcome> {
    await this.pending.get(id);
    const expectedRevision = this.revisions.get(id);
    if (expectedRevision === undefined) throw new Error('Plugin is not installed');
    let prepared!: {
      record: StoredPlugin;
      command: PluginCommandManifest;
      selection: SelectedNodeSnapshot[];
      context: ResultContext;
      job: GuestJob;
    };
    try {
      await withStoredPluginGuard(id, expectedRevision, (state) => {
        const record = state.plugin;
        if (!record) throw new Error('Plugin is not installed');
        const command = record.manifest.commands.find((entry) => entry.id === commandId);
        if (!command) throw new Error('Command is no longer installed');
        this.assertRunnable(record, command);
        if (this.jobs.has(id)) throw new Error('This plugin is already running');
        if (this.jobs.size >= MAX_RUNNING_JOBS) {
          throw new Error('At most two plugin commands may run at once');
        }
        const editor = this.editor;
        if (!editor) throw new Error('Open a document to run this plugin');
        const selection = this.selectedSnapshot(editor);
        const context = this.captureContext(editor, id, state.revision);
        const input: GuestInput = {
          apiVersion: 1,
          commandId,
          documentId: context.documentId,
          revision: context.revision,
          selection,
        };
        const encoded = JSON.stringify(input);
        if (new TextEncoder().encode(encoded).byteLength > 64 * 1024) {
          throw new Error('Selection snapshot exceeds 64 KiB');
        }
        const job = startGuestJob(record.wasm, 'run', encoded);
        this.jobs.set(id, job);
        this.results.get(id)?.delete(commandId);
        prepared = { record, command, selection, context, job };
        this.emit();
      });
    } catch (error) {
      if (error instanceof PluginStoreConflictError) await this.refreshStoredPlugin(id);
      throw error;
    }

    const { record, command, selection, context, job } = prepared;
    let outcome: PluginRunOutcome;
    try {
      const result = await job.result;
      const output = parseGuestOutput(result.output ?? '', command, selection);
      const accepted = await withStoredPluginGuard(id, context.pluginRevision, (state) => {
        if (!state.plugin || !this.isCurrent(id, context)) return false;
        const saved = this.results.get(id) ?? new Map<string, SavedResult>();
        saved.set(commandId, { output, context });
        this.results.set(id, saved);
        return true;
      });
      outcome = accepted ? { status: 'completed' } : { status: 'stale' };
    } catch (error) {
      if (this.jobs.get(id) !== job || !this.isRuntimeCurrent(id, record, context, job)) {
        outcome = { status: 'stopped' };
      } else if (error instanceof PluginStoreConflictError) {
        await this.refreshStoredPlugin(id);
        outcome = { status: 'stale' };
      } else {
        const persisted = await this.recordRuntimeFailure(id, record, context, job, error);
        if (persisted) throw error;
        outcome = { status: 'stale' };
      }
    } finally {
      if (this.jobs.get(id) === job) this.jobs.delete(id);
      this.emit();
    }
    return outcome;
  }

  stop(id: string): { status: 'stopped' | 'idle' } {
    const wasRunning = this.jobs.has(id);
    this.generations.set(id, (this.generations.get(id) ?? 0) + 1);
    this.jobs.get(id)?.stop();
    this.jobs.delete(id);
    this.results.delete(id);
    this.emit();
    return { status: wasRunning ? 'stopped' : 'idle' };
  }

  async apply(id: string, commandId: string): Promise<void> {
    const saved = this.results.get(id)?.get(commandId);
    if (!saved) throw new Error('No rename preview is ready');
    await withStoredPluginGuard(id, saved.context.pluginRevision, (state) => {
      const record = state.plugin;
      const command = record?.manifest.commands.find((entry) => entry.id === commandId);
      if (!record || command?.kind !== 'rename' || saved.output.renames.length === 0) {
        throw new Error('No rename preview is ready');
      }
      this.assertRunnable(record, command);
      if (!this.isCurrent(id, saved.context)) throw new Error('The preview is stale; run it again');
      const editor = this.editor;
      if (!editor || !this.proposalMatches(editor, saved.output.renames, saved.context)) {
        throw new Error('The document changed; run the preview again');
      }
      editor.beginTransaction();
      // Document mutation remains synchronous inside the authoritative IDB
      // guard. No revoke, update, or removal can commit between this check and
      // the undoable document commit, even when Web Locks is unavailable.
      let updaterRan = false;
      let changed = false;
      try {
        editor.updateDoc((doc) => {
          updaterRan = true;
          if (!this.isCurrent(id, saved.context)) return doc;
          const next = applyRenameProposal(doc, saved.context.documentId, saved.output.renames);
          changed = next !== doc;
          return next;
        });
        if (updaterRan && !changed) {
          throw new Error('The document changed; run the preview again');
        }
        editor.commitTransaction();
        this.results.get(id)?.delete(commandId);
        this.emit();
      } catch (error) {
        editor.abortTransaction();
        throw error;
      }
    });
  }

  async rollback(id: string): Promise<void> {
    this.stop(id);
    await this.enqueue(id, async () => {
      const current = this.requireRecord(id);
      if (!current.previous) throw new Error('No previous version is available');
      const previous = current.previous;
      const verified = await parsePluginPackage(previous.archive);
      if (verified.sha256 !== previous.sha256 || verified.manifest.id !== id) {
        throw new Error('Previous package failed its integrity check');
      }
      await startGuestJob(verified.wasm, 'validate').result;
      const rolledBackPanels = current.hiddenPanels?.filter((panelId) =>
        (verified.manifest.inspector ?? []).some((panel) => panel.id === panelId),
      );
      const next: StoredPlugin = {
        ...previous,
        manifest: verified.manifest,
        wasm: verified.wasm,
        source: 'local-file',
        enabled: current.enabled,
        grants: current.grants.filter((grant) =>
          requestedPermissions(verified.manifest).includes(grant),
        ),
        ...(rolledBackPanels && rolledBackPanels.length > 0
          ? { hiddenPanels: rolledBackPanels }
          : {}),
        previous: undefined,
      };
      await this.persist(next);
      const actions = this.actions.get(id);
      if (actions) {
        const registry = getActionRegistry();
        for (const [actionId, handler] of actions) {
          if (registry.get(actionId)?.handler === handler) registry.remove(actionId);
        }
        this.actions.delete(id);
      }
      this.records.set(id, next);
      const thumbnailUrl = pluginThumbnailDataUrl(verified.thumbnail);
      if (thumbnailUrl) this.thumbnailUrls.set(id, thumbnailUrl);
      else this.thumbnailUrls.delete(id);
      this.reconcileOne(id);
      this.emit();
    });
  }

  async uninstall(id: string): Promise<void> {
    this.requireRecord(id);
    this.stop(id);
    await this.enqueue(id, async () => {
      this.requireRecord(id);
      const revision = await deleteStoredPlugin(id, this.revisions.get(id) ?? 0);
      this.revisions.set(id, revision);
      this.records.delete(id);
      this.thumbnailUrls.delete(id);
      this.reconcileOne(id);
      this.emit();
    });
  }

  async retry(id: string): Promise<void> {
    await this.enqueue(id, async () => {
      const record = this.requireRecord(id);
      const next = { ...record, lastError: undefined };
      await this.persist(next);
      this.records.set(id, next);
      retryPlugin(id);
      this.reconcileOne(id);
      this.emit();
    });
  }

  private enqueue<T>(id: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.pending.get(id) ?? Promise.resolve();
    const checked = async () => {
      const latest = await getStoredPluginState(id);
      if (latest.revision !== (this.revisions.get(id) ?? 0)) {
        this.stop(id);
        await this.applyFreshState(id, latest);
        throw new PluginStoreConflictError();
      }
      return operation();
    };
    const result = previous.then(() => {
      // Origin-scoped Web Locks coordinate windows when their WebView supports
      // the API. The local queue still preserves order in every runtime.
      if (typeof navigator !== 'undefined' && navigator.locks) {
        return navigator.locks.request(`varve-plugin:${id}`, checked);
      }
      return checked();
    });
    const settled = result.then(
      () => {},
      () => {},
    );
    this.pending.set(id, settled);
    void settled.then(() => {
      if (this.pending.get(id) === settled) this.pending.delete(id);
    });
    return result;
  }

  private requireRecord(id: string): StoredPlugin {
    const record = this.records.get(id);
    if (!record) throw new Error('Plugin is not installed');
    return record;
  }

  private async checkStoredRecord(
    record: StoredPlugin,
    expectedRevision: number,
  ): Promise<StoredPlugin> {
    try {
      // Not `instanceof`: a stored view may come back from another realm
      // (structured clone), and parsePluginPackage normalizes before use.
      if (!ArrayBuffer.isView(record.archive)) throw new Error('Package bytes are missing');
      const pkg = await parsePluginPackage(record.archive);
      if (pkg.sha256 !== record.sha256 || pkg.manifest.id !== record.manifest.id) {
        throw new Error('Stored package identity or checksum changed');
      }
      const thumbnailUrl = pluginThumbnailDataUrl(pkg.thumbnail);
      if (thumbnailUrl) this.thumbnailUrls.set(record.manifest.id, thumbnailUrl);
      else this.thumbnailUrls.delete(record.manifest.id);
      return {
        ...record,
        manifest: pkg.manifest,
        wasm: pkg.wasm,
        grants: checkedGrants(pkg.manifest, record.grants),
      };
    } catch (error) {
      this.thumbnailUrls.delete(record.manifest.id);
      const disabled: StoredPlugin = {
        ...record,
        enabled: false,
        grants: [],
        lastError: `Stored package needs repair: ${message(error)}`.slice(0, 300),
      };
      try {
        await this.persist(disabled, expectedRevision);
      } catch (writeError) {
        if (!(writeError instanceof PluginStoreConflictError)) throw writeError;
        const latest = await getStoredPluginState(record.manifest.id);
        if (!latest.plugin) throw writeError;
        this.revisions.set(record.manifest.id, latest.revision);
        return this.checkStoredRecord(latest.plugin, latest.revision);
      }
      return disabled;
    }
  }

  private async persist(
    record: StoredPlugin,
    expectedRevision = this.revisions.get(record.manifest.id) ?? 0,
  ) {
    const revision = await putStoredPlugin(record, expectedRevision);
    this.revisions.set(record.manifest.id, revision);
    return revision;
  }

  private async handleStoreChange(id: string): Promise<void> {
    const localRevision = this.revisions.get(id) ?? 0;
    this.stop(id);
    try {
      const latest = await getStoredPluginState(id);
      if (latest.revision < localRevision) return;
      await this.applyFreshState(id, latest);
    } catch (error) {
      this.emit(false, `Could not refresh ${id}: ${message(error)}`);
    }
  }

  private async refreshStoredPlugin(id: string): Promise<void> {
    const latest = await getStoredPluginState(id);
    await this.applyFreshState(id, latest);
  }

  private async applyFreshState(id: string, state: StoredPluginState): Promise<void> {
    this.revisions.set(id, state.revision);
    if (state.plugin) {
      const checked = await this.checkStoredRecord(state.plugin, state.revision);
      if (this.records.get(id)?.sha256 !== checked.sha256) this.removeOwned(id, true);
      this.records.set(id, checked);
    } else {
      this.records.delete(id);
      this.thumbnailUrls.delete(id);
    }
    this.reconcileOne(id);
    this.emit(false);
  }

  private async recordRuntimeFailure(
    id: string,
    record: StoredPlugin,
    context: ResultContext,
    job: GuestJob,
    error: unknown,
  ): Promise<boolean> {
    if (!this.isRuntimeCurrent(id, record, context, job)) return false;
    try {
      return await this.enqueue(id, async () => {
        const current = this.records.get(id);
        if (
          !current ||
          current.sha256 !== record.sha256 ||
          !this.isRuntimeCurrent(id, record, context, job)
        )
          return false;
        const failed = { ...current, lastError: message(error).slice(0, 300) };
        await this.persist(failed, context.pluginRevision);
        this.records.set(id, failed);
        this.reconcileOne(id);
        this.emit();
        return true;
      });
    } catch (writeError) {
      if (writeError instanceof PluginStoreConflictError) await this.refreshStoredPlugin(id);
      else this.emit(false, `Could not save plugin failure: ${message(writeError)}`);
      return false;
    }
  }

  private assertRunnable(record: StoredPlugin, command: PluginCommandManifest): void {
    if (this.safeModeDisabled) throw new Error('Plugins are disabled in safe mode');
    if (!record.enabled) throw new Error('Enable this plugin first');
    if (record.lastError) throw new Error('Retry this plugin after its failure');
    if (record.manifest.permissions.required.some((grant) => !record.grants.includes(grant))) {
      throw new Error('Grant every required permission before running this plugin');
    }
    if (!record.grants.includes('selection.read'))
      throw new Error('Selection read access is required');
    if (command.kind === 'rename' && !record.grants.includes('document.write')) {
      throw new Error('Document write access is required for this command');
    }
  }

  private selectedSnapshot(editor: EditorContextValue): SelectedNodeSnapshot[] {
    const ids = editor.state.selection;
    if (ids.length === 0) throw new Error('Select at least one layer first');
    if (ids.length > MAX_SELECTED_NODES) throw new Error('Select at most 100 layers');
    return ids.flatMap((id) => {
      const node = editor.state.document.nodes[id];
      return node
        ? [
            {
              id,
              name: node.name,
              kind: node.kind,
              locked: isNodeEffectivelyLocked(editor.state.document, id),
              style: {
                opacity: Number.isFinite(node.opacity) ? node.opacity : 1,
                blendMode: node.blendMode,
                paintCount: node.paintRefs?.length ?? node.fills?.length ?? 0,
                strokeCount:
                  'strokes' in node && Array.isArray(node.strokes) ? node.strokes.length : 0,
                ...(node.kind === 'text'
                  ? {
                      fontFamily: node.fontFamily?.slice(0, 120),
                      fontSize: Number.isFinite(node.fontSize) ? node.fontSize : undefined,
                    }
                  : {}),
              },
            },
          ]
        : [];
    });
  }

  private captureContext(
    editor: EditorContextValue,
    id: string,
    pluginRevision: number,
  ): ResultContext {
    return {
      documentId: editor.state.document.id,
      sessionId: editor.state.activeId,
      revision: editor.state.revision,
      selectionRevision: editor.state.selectionRevision,
      generation: this.generations.get(id) ?? 0,
      pluginRevision,
    };
  }

  private isCurrent(id: string, context: ResultContext): boolean {
    const editor = this.editor;
    return Boolean(
      editor &&
        this.records.has(id) &&
        this.revisions.get(id) === context.pluginRevision &&
        (this.generations.get(id) ?? 0) === context.generation &&
        editor.state.activeId === context.sessionId &&
        editor.state.document.id === context.documentId &&
        editor.state.revision === context.revision &&
        editor.state.selectionRevision === context.selectionRevision,
    );
  }

  private isRuntimeCurrent(
    id: string,
    record: StoredPlugin,
    context: ResultContext,
    job: GuestJob,
  ): boolean {
    const current = this.records.get(id);
    return Boolean(
      current &&
        current.sha256 === record.sha256 &&
        this.revisions.get(id) === context.pluginRevision &&
        (this.generations.get(id) ?? 0) === context.generation &&
        this.jobs.get(id) === job,
    );
  }

  private proposalMatches(
    editor: EditorContextValue,
    proposal: RenameProposal[],
    context: ResultContext,
  ): boolean {
    if (editor.state.document.id !== context.documentId) return false;
    return proposal.every((item) => {
      const node = editor.state.document.nodes[item.id];
      return (
        node?.name === item.expectedName && !isNodeEffectivelyLocked(editor.state.document, item.id)
      );
    });
  }

  private status(record: StoredPlugin): RuntimeStatus {
    if (!record.enabled) return 'disabled';
    if (record.lastError) return 'failed';
    if (this.safeModeDisabled) return 'safe-mode';
    if (
      record.manifest.permissions.required.some((grant) => !record.grants.includes(grant)) ||
      !record.grants.includes('selection.read')
    ) {
      return 'awaiting-permission';
    }
    if (this.jobs.has(record.manifest.id)) return 'running';
    return 'ready';
  }

  private reconcileAll(): void {
    for (const id of new Set([...this.records.keys(), ...this.actions.keys(), ...this.sections])) {
      this.reconcileOne(id);
    }
  }

  private reconcileOne(id: string): void {
    const record = this.records.get(id);
    const status = record ? this.status(record) : 'disabled';
    const ready = record && (status === 'ready' || status === 'running');
    if (!ready) {
      this.removeOwned(id, Boolean(record));
      return;
    }
    const registry = getActionRegistry();
    const owned = this.actions.get(id) ?? new Map<string, (ctx: unknown) => void>();
    const actionPrefix = `plugin:${id}:`;
    const commands = new Set(record.manifest.commands.map((command) => command.id));
    for (const [actionId, handler] of owned) {
      if (!commands.has(actionId.slice(actionPrefix.length))) {
        if (registry.get(actionId)?.handler === handler) registry.remove(actionId);
        owned.delete(actionId);
      }
    }
    for (const command of record.manifest.commands) {
      const actionId = `plugin:${id}:${command.id}`;
      if (owned.has(actionId)) continue;
      if (registry.has(actionId)) throw new Error(`Action collision: ${actionId}`);
      const handler = () => {
        void this.run(id, command.id).catch(() => {
          window.dispatchEvent(new Event('varve:open-plugin-settings'));
        });
      };
      registry.register(
        { id: actionId, label: `${record.manifest.name}: ${command.title}`, category: 'tools' },
        handler,
      );
      owned.set(actionId, handler);
    }
    this.actions.set(id, owned);
    if (!this.sectionRenderer && this.sections.has(id)) disablePlugin(id);
    if (this.sectionRenderer && !this.sections.has(id)) {
      if (getRegisteredPlugins().some((item) => item.manifest.id === id)) {
        throw new Error(`Inspector contribution collision: ${id}`);
      }
      registerPlugin(this.inspectorManifest(record));
      this.sections.add(id);
      this.sectionHashes.set(id, record.sha256);
    } else if (this.sectionRenderer && this.sectionHashes.get(id) !== record.sha256) {
      registerPlugin(this.inspectorManifest(record));
      this.sectionHashes.set(id, record.sha256);
    }
    if (this.sectionRenderer && this.sections.has(id)) {
      this.syncHiddenPanels(record);
      enablePlugin(id);
    }
  }

  /** The registry's hidden-panel state mirrors the installation record. */
  private syncHiddenPanels(record: StoredPlugin): void {
    const hidden = new Set(record.hiddenPanels ?? []);
    for (const panel of record.manifest.inspector ?? []) {
      if (hidden.has(panel.id)) hideContribution(record.manifest.id, panel.id);
      else showContribution(record.manifest.id, panel.id);
    }
  }

  private inspectorManifest(record: StoredPlugin) {
    const id = record.manifest.id;
    return {
      id,
      name: record.manifest.name,
      version: record.manifest.version,
      contributions: (record.manifest.inspector ?? []).map((section) => ({
        pluginId: id,
        contributionId: section.id,
        targetTab: section.tab,
        display: { title: section.title },
        availability: { modes: section.modes, minSelection: 1 },
        render: () => this.sectionRenderer?.(id, section.command) ?? null,
      })),
    };
  }

  private handleInspectorFailures(): void {
    for (const state of getRegisteredPlugins()) {
      const id = state.manifest.id;
      const record = this.records.get(id);
      if (!this.sections.has(id) || !record || state.status !== 'error' || record.lastError)
        continue;
      this.stop(id);
      const failed = {
        ...record,
        lastError: `Inspector section failed: ${state.error ?? 'Unknown error'}`.slice(0, 300),
      };
      void this.enqueue(id, async () => {
        if (this.records.get(id) !== record) return;
        await this.persist(failed);
        this.records.set(id, failed);
        this.reconcileOne(id);
        this.emit();
      }).catch((error: unknown) =>
        this.emit(false, `Could not quarantine ${id}: ${message(error)}`),
      );
      this.reconcileOne(id);
      this.emit();
    }
  }

  private removeOwned(id: string, preserveSection = false): void {
    const registry = getActionRegistry();
    for (const [actionId, handler] of this.actions.get(id) ?? []) {
      if (registry.get(actionId)?.handler === handler) registry.remove(actionId);
    }
    this.actions.delete(id);
    if (this.sections.has(id)) {
      if (preserveSection) disablePlugin(id);
      else {
        this.sections.delete(id);
        this.sectionHashes.delete(id);
        unregisterPlugin(id);
      }
    }
  }

  private emit(loading = false, error?: string): void {
    this.snapshot = {
      loading,
      error,
      safeModeDisabled: this.safeModeDisabled,
      plugins: [...this.records.values()].map((record) => ({
        id: record.manifest.id,
        manifest: record.manifest,
        sha256: record.sha256,
        source: record.source,
        installedAt: record.installedAt,
        enabled: record.enabled,
        grants: [...record.grants],
        status: this.status(record),
        lastError: record.lastError,
        previousVersion: record.previous?.manifest.version,
        hiddenPanels: [...(record.hiddenPanels ?? [])],
        thumbnailUrl: this.thumbnailUrls.get(record.manifest.id),
        results: Object.fromEntries(
          [...(this.results.get(record.manifest.id) ?? new Map()).entries()].map(([key, value]) => [
            key,
            value.output,
          ]),
        ),
      })),
    };
    for (const listener of this.listeners) listener();
  }
}

export const pluginController = new ApplicationPluginController();

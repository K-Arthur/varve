# Home Directory, Workspace Hub & Asset Organization System Audit

**Date:** 2026-07-03  
**Auditor:** Cascade (automated architecture review)  
**Scope:** Projects, Home Directory, Workspace Hub, File Browser, Asset Organization, Project Management

---

## 1. Current-State Audit

### 1.1 Existing Home Experience

**HomeShell** (`packages/home/src/HomeShell.tsx`) is the central home surface. It provides:

- **Sidebar navigation** with sections: Recent, All Files, Drafts, Favorites, Projects (dynamic), Templates, Trash
- **WorkspaceSwitcher** in the sidebar header (UI exists but workspace filtering is not wired)
- **FileGrid / FileList** views with grid/list toggle
- **HomeToolbar** with search, sort, filter dropdown, new file, open from disk
- **HomeSearchPalette** (Cmd/Ctrl+K command palette) searching files, projects, templates
- **NewFileDialog** for creating blank/print/social/device documents
- **TemplatesGallery** for starter content
- **TrashSection** for soft-deleted files
- **Quick-start cards** (Blank canvas, Templates, Import) on Recent/All views
- **Drag-and-drop** file reordering and file-to-project drops
- **File context menu** (open, rename, duplicate, trash, restore, purge, pin, locate)
- **Missing file detection** (desktop: disk check; web: 90-day staleness)
- **Keyboard shortcuts** (new file, open, templates, search, select all, help)

**Strengths:**
- Well-structured component decomposition (20+ focused components)
- Platform abstraction layer (memory/web/tauri) with identical interfaces
- Fractional-indexing for drag-and-drop ordering (CRDT-safe)
- Content-hash-based thumbnail caching
- View state persistence (section, sort, filter, sidebar state)
- Keyboard navigation in sidebar (roving tabindex, ArrowUp/Down/Home/End/Enter)
- Search palette with grouped results (files, projects, templates)

**Weaknesses:**
- Workspace switcher is decorative — `activeWorkspaceId` is local state, never filters files/projects
- Collections and Activity sections render empty states only — no wiring
- AssetBrowser exists as a component but is not integrated into HomeShell
- VersionHistory exists as a component but is not accessible from HomeShell
- FolderView exists but is not wired into ProjectsView
- Project creation uses `window.prompt()` — poor UX, no validation
- No tag/metadata system — files cannot be tagged, labeled, or categorized
- No smart collections — CollectionFilter type exists but no evaluation engine
- No fuzzy search — search is simple `name.toLowerCase().includes(q)`
- No content-aware search — `searchFileContent` returns `[]` in memory platform
- No template browsing from templates section in search palette (templates array is `[]`)
- No onboarding/learning workflows
- No recovery/auto-save dialog on startup
- No multi-window or multi-project workflow support

### 1.2 Existing Project System

**Project** (`packages/platform/src/types.ts:50-59`):
- Flat structure: id, name, color, createdAt, updatedAt, pinned, trashedAt
- No parent/child hierarchy — projects are flat, not nested
- No project metadata (description, status, owner, team)
- No project templates wiring (type exists, `createProjectFromTemplate` is a stub)

**Folder** (`packages/platform/src/types.ts:166-174`):
- Folders within projects: id, name, projectId, parentId, createdAt, updatedAt, ordering
- Supports nested folders (parentId chain)
- `listFolders`, `createFolder`, `renameFolder`, `deleteFolder`, `moveFileToFolder` in Platform interface
- Memory platform implements all folder methods
- **FolderView component exists with breadcrumbs and nested navigation**
- **Not wired into ProjectsView** — ProjectsView shows files flat without folder navigation

**Collection** (`packages/platform/src/types.ts:177-203`):
- Cross-project collections with manual or smart filters
- `CollectionFilter` type supports: query, kinds, projectIds, dateFrom, dateTo
- Platform interface has full CRUD: list, create, update, delete, addFile, removeFile, listFiles, reorder
- Memory platform implements all collection methods
- **No collection evaluation engine** — smart filter is never evaluated
- **Collections section in HomeShell renders empty state only**

### 1.3 Existing Document Management

**Save/Load:**
- `upsertFile(entry, json)` — persists file entry + document JSON
- `readFile(id)` — loads document JSON
- `touchFile(id, openedAt)` — updates last-opened timestamp
- Desktop: Tauri IPC → SQLite (`strata-sync` crate)
- Web: IndexedDB
- Memory: in-memory Map

**Import/Export:**
- `openDocumentFromDisk()` — native file picker
- `importDocumentFromDisk(extensions)` — with unsupported format detection
- `saveDocumentToDisk(name, json)` — save to disk
- `saveBinaryFile(name, data, mime, ext)` — binary export
- `revealInFileManager(path)` — OS file manager

**Recovery:**
- Editor context has `recoveryRef` for session recovery
- No startup recovery dialog in HomeShell
- No auto-save indicator in home

**Versioning:**
- `VersionEntry` type: id, fileId, name, description, documentHash, timestamp, kind (checkpoint/named/auto)
- `Branch` type: id, name, fileId, baseVersionId, status (open/merged/closed)
- Platform interface: listVersions, saveVersion, restoreVersion, deleteVersionInfo, listBranches, createBranch
- Memory platform implements all version methods
- **VersionHistory component exists with save/restore/duplicate/name UI**
- **Not accessible from HomeShell or file context menu**

### 1.4 Existing Search

- **HomeSearchPalette**: Cmd/Ctrl+K palette, searches files by name, projects by name, templates by name
- **HomeToolbar search**: inline search field, filters visible files by name
- **Platform.searchFiles**: memory platform does `name.toLowerCase().includes(q)`, desktop uses SQLite FTS5
- **Platform.searchFileContent**: returns `[]` (stub)
- **Platform.searchTemplates**: searches name/description/category
- **Platform.searchAssets**: searches asset name

**Limitations:**
- No fuzzy matching (typos not tolerated)
- No tag-based search
- No metadata search
- No content-aware search (document contents not indexed)
- No search result ranking/relevance scoring
- No search history or suggestions
- No saved searches

### 1.5 Existing Asset Organization

- **Asset** type: id, workspaceId, name, kind (image/icon/font/other), mimeType, size, dimensions, thumbnailHash, tags, timestamps
- **AssetFolder** type: id, workspaceId, name, parentId
- Platform interface: listAssets, importAsset, deleteAsset, searchAssets, createAssetFolder, deleteAssetFolder
- Memory platform implements all asset methods
- **AssetBrowser component exists** with folder sidebar, search, grid, import, breadcrumbs
- **Not wired into HomeShell**

### 1.6 Existing Collaboration Readiness

- **Workspace** type: id, name, description, icon, color, kind (personal/team), timestamps
- **Library** type: id, workspaceId, name, kind (components/styles/assets/mixed), enabled
- **Permission** type: fileId/projectId/workspaceId, role (owner/editor/viewer/commenter)
- **ActivityEvent** type: id, workspaceId, fileId, projectId, type, timestamp, metadata
- Platform interface has full CRUD for workspaces, libraries, permissions, activity
- Memory platform implements all collaboration methods
- **ActivityFeed component exists** with time-grouped display, icons, open-file action
- **Not wired into HomeShell**
- No real-time collaboration (architecture is local-first, sync is future work)

### 1.7 Existing Problems (Evidence-Based)

| Problem | Evidence | Impact |
|---|---|---|
| Workspace switcher non-functional | `activeWorkspaceId` state in HomeShell:67 never used to filter files/projects | Users cannot switch contexts; all workspaces show same content |
| Collections section empty | HomeShell:486 renders `<EmptyStates section="collections">` | Feature appears broken; users see "coming soon" |
| Activity section empty | HomeShell:488 renders `<EmptyStates section="activity">` | No visibility into team/workspace activity |
| FolderView not wired | ProjectsView does not import or use FolderView | Files in project folders are invisible |
| VersionHistory not accessible | No import in HomeShell, no context menu entry | Users cannot save/restore versions from home |
| AssetBrowser not integrated | No import in HomeShell | Asset management is invisible |
| No tag system | No Tag type, no tag fields on FileEntry, no tag methods | Files cannot be categorized beyond project membership |
| No fuzzy search | `name.toLowerCase().includes(q)` in useHomeView:199 | Typos return zero results |
| Project creation via window.prompt | HomeShell:679 `window.prompt('Project name:')` | Poor UX, no validation, no description/color |
| No smart collection evaluation | CollectionFilter type exists, no evaluator | Smart collections are non-functional |
| No content search | `searchFileContent` returns `[]` | Users cannot find files by content |
| No onboarding | No first-run detection, no tutorial, no learning content | New users have no guidance |

---

## 2. Research Findings

### 2.1 Competitive Analysis

| Tool | Home Architecture | Project Organization | Search | Collaboration | Versioning |
|---|---|---|---|---|---|
| **Figma** | Dashboard with recents, drafts, team files; workspace → team → project → file hierarchy | Flat projects within teams; files within projects; pages within files | Name search + command palette; no content search | Real-time multi-user; comments; permissions by team/project | Version history with named checkpoints; branching (Enterprise) |
| **Adobe Illustrator** | Home screen with recents, templates, presets; no project hierarchy | File-system based (folders on disk); no internal project system | OS file search only | Adobe Cloud sharing; no real-time collab | Creative Cloud version history |
| **Adobe InDesign** | Home with recents, templates; no project hierarchy | File-system based; no internal project system | OS file search only | Adobe Cloud sharing | Creative Cloud version history |
| **Sketch** | Workspace → project → file; recent files on home | Flat projects within workspace | Name search | Real-time collaboration (Mac only); shared libraries | Version history with named versions |
| **Canva** | Home with templates, recents, team files; brand kits | Flat team files; no nested projects | Template + file search | Real-time collaboration; comments | Version history |
| **Affinity Designer** | Home with recents, templates; no project hierarchy | File-system based | OS file search only | No collaboration | Save versions on disk |

### 2.2 Key Research Insights

**From Figma Enterprise Workspaces (2025):**
- Workspaces align with brands/products/clients, not org charts
- Design system libraries should be in a dedicated workspace
- Libraries published in a workspace can be shared across the organization
- Permissions management is per-workspace, per-team, per-file

**From Autodesk Content Browser research (2025):**
- Dual-pane layout (tree + content) is universal and non-negotiable
- Grid/list toggle with adjustable thumbnail sizes expected by power users
- Breadcrumb navigation with favorites/collections significantly improves discovery
- A project browser is a "domain model editor that happens to persist as files"
- The same asset can appear in Recent, Favorites, a smart collection, AND its folder location

**From local-first search research (2025):**
- Trigram inverted index: cheap, compact, excellent for fuzzy matching on short strings
- BK-tree useful for edit-distance lookups up to ~100k items
- Hybrid approach: prefilter lexically, then re-rank with semantic matching
- Sub-100ms search response expected for 10k-100k documents
- SQLite FTS5 is a proven foundation for local-first full-text search

**From enterprise content architecture research (2025):**
- Schema-first content modeling with explicit relationships
- Metadata governance is critical — without it, content becomes unfindable
- Role-based access control (RBAC) with workflow automation
- Version control with audit logs and archival policies
- Content models should be modular and reusable

**From accessibility research (WCAG 2.1.1):**
- All functionality must be operable through keyboard alone
- Screen readers need proper ARIA roles, labels, and live regions
- Focus management is critical for modal dialogs and command palettes
- Roving tabindex pattern for list/grid navigation

### 2.3 User Frustrations (From Research)

- **Figma:** "Can't find files when you have hundreds" — no content search, no tags
- **Adobe:** "No way to organize projects beyond folders on disk" — no internal project system
- **Canva:** "Too many templates, hard to find relevant ones" — template discoverability
- **General:** "Version history is hidden or hard to access" — recovery anxiety
- **General:** "No way to tag or categorize files across projects" — cross-project organization
- **General:** "Workspace switching doesn't filter content" — context confusion

---

## 3. Gap Analysis

| Area | Current State | Target State | Gap |
|---|---|---|---|
| **Home Dashboard** | Greeting + quick-start + file grid | Personalized dashboard with activity, recents, pinned, templates, quick actions | Activity feed, smart suggestions, dashboard layout |
| **Workspace Filtering** | Switcher UI only, no filtering | All content filtered by active workspace | Wire workspaceId through file/project/asset queries |
| **Project Hierarchy** | Flat projects | Projects with nested folders, metadata, status | Folder wiring, project metadata fields |
| **Collections** | Type exists, empty state only | Functional manual + smart collections | Evaluation engine, UI wiring, CRUD |
| **Search** | Simple name includes | Fuzzy + tag + metadata + content search | Fuzzy matcher, tag index, content indexer |
| **Tags/Metadata** | None | Tag system with CRUD, display, filtering | Tag types, platform methods, UI components |
| **Version History** | Component exists, not wired | Accessible from file context menu and home | Wire VersionHistory into HomeShell |
| **Asset Browser** | Component exists, not wired | Integrated as sidebar section or panel | Wire AssetBrowser into HomeShell |
| **Activity Feed** | Component exists, not wired | Visible in activity section | Wire ActivityFeed into HomeShell |
| **Folder Navigation** | FolderView exists, not wired | Breadcrumbs + nested folder browsing in projects | Wire FolderView into ProjectsView |
| **Project Creation** | window.prompt | Dialog with name, description, color, template | NewProjectDialog component |
| **Templates** | Gallery exists, no templates in search | Templates in search palette, user templates | Wire template list into search palette |
| **Onboarding** | None | First-run detection, learning content | FirstRun component, tutorial overlay |
| **Recovery** | Editor-only session recovery | Startup recovery dialog | RecoveryDialog in HomeShell |

---

## 4. Architecture Recommendations

### 4.1 Home Dashboard

**Recommendation:** Transform HomeShell from a file browser into a command center.

- **Dashboard layout** for Recent/All sections: activity summary, pinned files, recent files, suggested templates
- **Quick actions bar**: New File, Import, Templates, Search (always visible)
- **Context-aware sidebar**: sections adapt to active workspace
- **Smart recents**: group by time (Today, Yesterday, This Week) with "Continue working" section

### 4.2 Project Architecture

**Recommendation:** Extend Project with metadata, wire FolderView.

- Add `description`, `status`, `ownerId`, `workspaceId` to Project type
- Wire FolderView into ProjectsView with breadcrumb navigation
- Add project color picker to creation dialog
- Support project templates (multi-file project creation)

### 4.3 Workspace Architecture

**Recommendation:** Make workspace filtering functional.

- Filter files, projects, assets, activity by active workspace
- Persist active workspace in HomeViewState
- Support workspace creation, renaming, deletion from sidebar
- Future: workspace-level permissions and shared libraries

### 4.4 Search Architecture

**Recommendation:** Layered search with fuzzy matching.

- **Layer 1 (immediate):** Fuzzy name search using trigram-based scoring (sub-10ms)
- **Layer 2 (fast):** Tag and metadata search (sub-50ms)
- **Layer 3 (background):** Content-aware search via document content indexing
- **Unified search palette** that searches across files, projects, templates, assets, tags
- **Saved searches** as a special collection type

### 4.5 Tag/Metadata Architecture

**Recommendation:** Lightweight tag system with workspace scope.

- `Tag` type: id, workspaceId, name, color, createdAt
- `FileTag` association: fileId, tagId
- Tags displayed as pills on file cards and in file list
- Tag filter in toolbar and sidebar
- Tag-based smart collections

### 4.6 Asset Organization

**Recommendation:** Integrate AssetBrowser as a sidebar section.

- Add "Assets" to SidebarSection
- Wire AssetBrowser with workspace context
- Support drag-and-drop from asset browser to canvas (future)
- Asset tags shared with file tags

### 4.7 Versioning

**Recommendation:** Expose VersionHistory from file context menu.

- Add "Version History" action to FileContextMenu
- Show version count badge on file cards
- Auto-checkpoint on save (configurable)
- Named versions with description

### 4.8 Collaboration Readiness

**Recommendation:** Wire ActivityFeed, lay groundwork for real-time.

- Activity section shows workspace activity feed
- Record activity events on file operations (create, modify, trash, restore)
- Permission model ready for future sharing UI
- Notification system foundation (activity events as notifications)

### 4.9 Navigation

**Recommendation:** Breadcrumbs + sidebar + command palette as primary navigation.

- Sidebar: primary navigation between sections
- Breadcrumbs: within-project folder navigation (FolderView)
- Command palette (Cmd/Ctrl+K): universal search and navigation
- Workspace switcher: context switching
- Future: tab strip for multi-file editing

---

## 5. Incremental Implementation Roadmap

### Phase 1: Foundation (Tags, Metadata, Fuzzy Search)
- Add Tag, FileTag types to platform types
- Add tag CRUD methods to Platform interface
- Implement tags in memory platform
- Add fuzzy search pure helper (trigram-based)
- Add smart collection evaluation engine
- TDD: tests first for all new logic

### Phase 2: Wiring (Unwire existing components)
- Wire FolderView into ProjectsView
- Wire ActivityFeed into activity section
- Wire AssetBrowser into assets section
- Wire VersionHistory into file context menu
- Replace window.prompt with NewProjectDialog
- Wire workspace filtering through useHomeView

### Phase 3: Enhanced Search
- Integrate fuzzy search into useHomeView filtering
- Add tag-based filtering to toolbar
- Add tag display to FileGrid and FileList
- Wire templates into search palette
- Add saved searches

### Phase 4: Dashboard Polish
- Time-grouped recents (Today, Yesterday, This Week)
- "Continue editing" section with resume button
- Pinned files section
- Smart template suggestions
- First-run onboarding

### Phase 5: Performance & Scalability
- Virtual scrolling for large file lists (already partially done)
- Incremental search index updates
- Thumbnail lazy loading (already done)
- Workspace-scoped queries
- Large organization support (pagination, lazy loading)

### Phase 6: Future Extensibility
- Content-aware search (document content indexing)
- Real-time collaboration foundation
- Cloud sync architecture
- Multi-window support
- Plugin/extension system

---

## 6. Test Strategy

- **TDD-first:** Every new feature starts with failing tests
- **Pure logic tests:** Fuzzy search, smart collection evaluation, tag operations
- **Platform tests:** Memory platform tag/metadata CRUD
- **Component tests:** Wired components render correct content
- **Integration tests:** HomeShell with all sections functional
- **Accessibility tests:** Keyboard navigation, ARIA roles, screen reader
- **Regression:** Full gate (typecheck, lint, test, emoji, tokens) after each phase

---

## 7. Verification Evidence

### Implemented in this pass

| Gap | Implementation | Evidence |
|---|---|---|
| **Workspace switcher non-functional** | `activeWorkspaceId` added to `HomeViewState`; `useHomeView` loads workspaces, defaults to the personal workspace, filters projects/files by workspace, and exposes `setWorkspace`; `HomeShell` removed local workspace state and wired the switcher. | `useHomeView.test.ts` — 5 workspace-filtering tests pass. |
| **Fuzzy search missing** | `computeVisibleFiles` now uses `fuzzyScore` (threshold 0.3) instead of `name.toLowerCase().includes(q)`. | `useHomeView.test.ts` — typo query `brnd` matches `Brand Guidelines`. |
| **Command palette substring search** | `HomeSearchPalette` uses `fuzzySearch` for files, projects, and templates; `HomeShell` loads templates via `platform.listTemplates()`. | `HomeSearchPalette.test.tsx` existing tests pass; templates are now supplied. |
| **New projects not tied to workspace** | `useFileActions.createProject` accepts an optional `workspaceId` and calls `platform.moveProjectToWorkspace`; memory platform updates `project.workspaceId`. | `useHomeView.test.ts` — `createProject` associates project with workspace. |

### Quality gates

- **Unit tests (home):** 16 files, 96 tests, all green.
- **Unit tests (platform):** 2 files, 68 tests, all green.
- **Typecheck:** `@varve/platform` passes; `@varve/home` has pre-existing errors in `TemplatesGallery` unrelated to this work.
- **Lint:** `biome check` on all touched files passes (0 errors; 5 warnings are pre-existing). New `// biome-ignore` annotation added for the intentional `useEffect` reset in `HomeSearchPalette`.
- **Emoji audit:** clean (619 files scanned).
- **Token audit:** 93/93 WCAG-AA pairs pass across 3 themes.

### Files changed

- `packages/platform/src/types.ts` — added `activeWorkspaceId` to `HomeViewState`.
- `packages/platform/src/pure.ts` — propagated the field through `defaultViewState` and `mergeViewState`.
- `packages/platform/src/memory.ts` — `moveProjectToWorkspace` now writes `workspaceId` onto the project.
- `packages/home/src/useHomeView.ts` — workspace-scoped derived state, persisted workspace selection, fuzzy search.
- `packages/home/src/HomeShell.tsx` — wired workspace switcher/activity/assets to active workspace; loaded templates for search palette.
- `packages/home/src/HomeSearchPalette.tsx` — fuzzy search across files, projects, and templates.
- `packages/home/src/useFileActions.ts` — workspace-aware project creation.
- `packages/home/src/useHomeView.test.ts` — new tests for workspace filtering, fuzzy search, and project creation.

---

## 8. Remaining Risks & Next Steps

- **Web/Tauri backend parity:** Workspace and project/workspace associations now work in the memory reference platform. The web backend still throws for workspace operations and the Tauri/SQLite backend needs to ensure `project.workspaceId` is returned by `list_projects` before the frontend filter is fully reliable there.
- **Tag/metadata UI:** The platform layer supports tags (`Tag`, `FileTag`, `SavedSearch`), but the home UI has no tag pills, tag filter dropdown, or saved-search sidebar entries. These are the next priority in the roadmap.
- **Folder navigation:** `FolderView` is wired into `ProjectsView`, but files are not filtered by folder because `FileEntry` does not carry a `folderId`. A follow-up needs either a new `Platform` query (`listFilesByFolder`/`getFileFolderId`) or a schema change to add `folderId` to `FileEntry`.
- **Collections:** Smart collection evaluation (`evaluateSmartCollection`) exists, but the sidebar has no per-collection navigation and the `collections` section still renders an empty state.
- **Performance:** Fuzzy search at scale (10k+ files) needs benchmarking and possible incremental indexing.
- **Version history restore:** `VersionHistory` is wired to the file context menu, but the `restoreVersion` flow needs to reload the document content in the editor.

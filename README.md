# Happy Friday Lite

## 3.0.6.02-preview.20 AI Core task controls and global assistant dock

- Technical version: `3.0.6-preview.20`; release label: `3.0.6.02-preview.20`.
- Adds checkpoint-safe pause/resume/cancel controls for AI Core tasks, including the note-to-Word flow. Cancellation and approval use the existing Friday confirmation dialog.
- Adds a root-level Friday Assistant dock that lists AI Core tasks across routes and reuses the same task runtime for approval, pause, resume and cancel actions.
- Keeps the Preview.19 installer and checksum links below as historical release evidence. A local unsigned Preview.20 x64 installer was generated with `npm run electron:build:win`; checksum and build metadata are in `release/SHA256SUMS-preview.20.txt` and `release/preview.20-build-info.txt`. It has not been uploaded or signed.
- Design records: [iteration plan](docs/ai-core-next-iteration-plan.md), [Preview.20 PRD](docs/Friday-AI-Core-Global-Assistant-Preview20-PRD.md) and [technical design](docs/Friday-AI-Core-Global-Assistant-Preview20-Technical-Design.md).

## 3.0.6.02-preview.19 AI Core runtime and conversation continuity

- Completes the AI Core task runtime with live readiness checks, capability planning, approvals, cancellation, verification, idempotency and safe undo.
- Routes Office AI inference through the shared sensitive capability while preserving request/thread context, streaming callbacks and cancellation.
- Adds scoped conversation-history access across Friday AI chats and Docs, Sheets, Slides, PDF, Markdown and HTML AI panels; history reloads from project storage.
- Automatically names AI-created Office files from their generated title or content across Docs, Sheets, Slides, PDF, Markdown and HTML.
- Adds a verified note-to-Word task flow with source links, read-back verification and guarded undo.
- Uses technical version `3.0.6-preview.19` and release label `3.0.6.02-preview.19`.

## 3.0.6.01-preview.18 AI Core foundation

- Adds the Friday AI Core v1 contracts for actor, space, session, thread, task, request, resource, and capability.
- Adds structured plan/execute foundations with Runtime injection and task transitions that cannot skip verification.
- Adds a repeatable DeepSeek connectivity check: `node scripts/check-deepseek-connection.mjs`.
- Uses the release label `3.0.6.01-preview.18` without occupying the official `3.0.7` release line. npm/Electron uses the valid technical version `3.0.6-preview.18`; the Windows artifact keeps the requested release label.

## Preview 17: terminal colors, settings access and note navigation

Fixes xterm bright-color mapping and transparent-background contrast calculations, live terminal ink/fonts, visible settings entries, and shared Settings typography for the palette/plugins/shortcuts. Removes the duplicate sidebar command button and connects Office commands to real menu channels. Note references navigate from the main Notes page, standalone editor and Typewriter; the links panel includes usage help.

See the [Preview 17 root-cause and validation report](docs/typewriter/07-preview17-root-cause-report.md) for evidence and limits.

Windows x64 installer: [3.0.6.02-preview.19](https://github.com/yingchao4399/happy-friday-lite/releases/download/3.0.6.02-preview.19/Happy-Friday-Lite-3.0.6.02-preview.19-win-x64-setup.exe); SHA256: [preview.19 checksum](https://github.com/yingchao4399/happy-friday-lite/releases/download/3.0.6.02-preview.19/SHA256SUMS-preview.19.txt). The package uses technical version `3.0.6-preview.19` for Electron semver compatibility.

## Preview 16: commands, plugins and Obsidian compatibility

Four Windows x64 iterations are available as `3.0.6-preview.13` through `.16`. The latest package includes previous batches and preserves the existing Office work.

- **Preview 13:** shared Nocturne ink, bundled fonts including Sarasa Mono SC, directed note references, WikiLink completion and revision-checked saves to the same note ID.
- **Preview 14:** a persistent command button, categorized bilingual/pinyin search, recent commands, shortcut recording/conflicts/import/export, and native Office overlay/focus coordination. Command palette: `Ctrl+Shift+P`; Press: `Ctrl+Alt+P`.
- **Preview 15:** plugin management/market, ZIP import, isolated sandbox hosts, settings, lifecycle cleanup, updates and rollback. Native examples use real note/Office APIs; agent tools retain approval requirements.
- **Preview 16:** the official Obsidian community directory and release downloads, the unmodified official sample package, a controlled Vault/MetadataCache/Workspace/Editor subset, and an optional CodeMirror 6 Markdown window. Unsupported Node/private APIs report explicit errors.

To use the compatibility editor, enable an Obsidian plugin, open a note in Notes or Typewriter, then search the command palette for “Markdown compatibility editor”. It saves to the same note ID. Tables, charts, media and styled nodes remain protected; removing protection tokens blocks the save and retains a recovery draft.

Verified scope: official sample **1.0.0** lifecycle/commands/modal/settings and **Sort and Permute Lines 0.9.0** alphabetical sorting in CM6. Download availability does not imply complete plugin/API compatibility. Typewriter keeps its original input/feedback structure. macOS/Linux have not been run-tested.

See the [four-batch delivery report](docs/typewriter/06-preview13-16-delivery.md) for validation and limits.

## Preview 13: typewriter typography and note links

Adds shared paper ink controls, bundled JetBrains Mono/Fira Code/Sarasa Mono SC, app-local font import/download, directed note links, WikiLink completion, and revision checks for note saves. Original Nocturne shell and feedback remain in use.

[中文](README.zh-CN.md)

<a id="english"></a>

An Electron + Vue 3 desktop personal knowledge assistant that combines an AI agent, RAG knowledge retrieval, rich-text notes, and a calendar. All data is stored locally with privacy as a priority.

## 3.0.6-preview.12 Typewriter Nocturne original-shell integration

- Adds the original Typewriter Nocturne shell at `/typewriter`, pinned to upstream commit `e19d64ef42b9241b462439e22d7b905b266633e1`.
- Keeps the original 3D machine, paper shaders, lamp, sounds, ink, cursors, Press, Archive, Studio and paper-clip scrollbar.
- Notes and Terminal are separate content plugins. Notes edit the same Friday note ID and autosave back to the Notes module; Terminal uses a real PowerShell/Bash/Zsh PTY.
- Includes Chinese/English settings labels, Markdown/code import into Notes, Archive PNG export, terminal restart, and crash-safe local draft recovery.

## 3.0.6-preview.11 header/footer and note image interaction fixes

- Header/footer editing uses a separate coordinate layer on every sheet. Double-click the top/bottom margin to enter, use ribbon menus without leaving, and double-click the body or close to exit.
- Distance inputs accept full decimal values. Section settings target the page being edited, with separate first-page and odd/even content.
- Header, footer, page number, date/time, fields, rules and navigation expose working menus. Header rules offer color, width and text spacing controls.
- Header and footer galleries each offer eight previews: blank, three columns, title, ruled, color band, title/date, page number, and page/total. Page numbers support top, bottom and current position, with plain, total, dash and accent styles.
- Date/time offers eight formats, language selection and Word-updatable fields. Document info inserts author, filename, path, title, subject, keywords and comments, with editable display values for missing properties.
- Local header/footer templates can be saved, applied and removed, with storage errors shown. Explicit template replacement/removal clears old tables and logos; ordinary text edits preserve them. Date and filename field instructions survive save/reopen.
- Manual zoom remains selected; page-width and whole-page fit modes continue following window changes.
- Note images use a dedicated NodeView with four corner resize handles, persisted dimensions and double-click access to the image editor.
- Charts now use an on-demand Apache ECharts renderer: horizontal bars, columns, lines, areas, pie, real X/Y scatter, histogram, cumulative waterfall, funnel, radar, combo, grouped columns, box, violin, error bars, stem-and-leaf, and three-line tables each use their own semantics. The editor reuses Friday dialogs and buttons, preserves series/X/samples/error data, and supports live preview, validation, alignment, axes, legends, resize, and save/reopen.
- Video and audio NodeViews provide inline controls, modal preview, open-original, and reveal-in-folder actions. Windows/UNC paths, spaces, and special characters round-trip safely, with visible playback errors.
- Development acceptance reports: `docs-header-footer.json`, `note-image-resize.json`, `note-chart.json`, and `note-media.json`; all 138 application tests, the frontend build, and Office typecheck pass.

## 3.0.6-preview.10 note resources, charts, and per-page headers/footers

- Every page header and footer now has its own double-click hit area. Editing shows the local Header/Footer marker and dashed boundary, then switches the official Header & Footer ribbon tab; the misleading hover-only first-page chip is gone.
- Images can be resized directly in the note body by dragging the bottom-right handle, with aspect ratio preserved by default and Shift for free resizing. Fit-to-page, original size, and the full image editor remain available.
- Charts use a data-table-first editor with row insertion/removal, label/value/error editing, axis and label visibility controls, and a direct resize handle.
- Note attachment preview is unified: PDF, Markdown, text, and database files use the preview window; Word, Excel, and PowerPoint files open in the built-in Office reader/editor. Media and attachments keep open-original and open-location actions.

## 3.0.6-preview.9 note resource editing

- Note images open in a dedicated editor with zoom, pan, crop, rotation, drawing, mosaic, text annotations, and output sizing.
- Video, audio, and attachment nodes share preview, open-file, and open-containing-folder actions.
- Notes can insert editable chart nodes for bar, column, line, area, pie, scatter, histogram, waterfall, funnel, radar, combo, and three-line table layouts.
- Note references create bidirectional resource links and expose backlinks; structured media and chart nodes remain readable to the AI note tools.

## 3.0.6-preview.8 official integration and note/header-footer enhancements

- Fully integrates the official 3.0.6 tab/session isolation, streaming isolation, uncontrolled inputs, streaming renderer, sidebar performance, Office bundle and HarfBuzz fixes.
- Note insertion now supports local images, video, audio, file attachments, notes and knowledge-base content, including drag-and-drop, clipboard paste and clickable links.
- Word header/footer editing opens by double-click and provides page numbers, date/time, filename, borders, different-first/odd-even pages and distance controls.

## 3.0.6-preview.7 performance repair

- Use Electron's built-in disk SQLite instead of keeping and exporting the entire database in WebAssembly. Existing SQLite files remain readable; backups use consistent online snapshots.
- Bound capability audit summaries before serialization, omit UI payload content, and limit reads of oversized legacy audit records. Tool results and permission checks remain intact.
- Restore native Windows clipboard monitoring across apps for text, rich text, images and files, with shared deduplication for internal copy/cut events. Persist only changed entries and provide a native editing menu for unhandled editable content. Monitoring failures show a recovery message and fall back to text and image capture.
- Restore Chromium background throttling for hidden Office views. Empty existing databases stop initialization with a recovery message.
- Load Office attachment parsers through one shared optional bundle. Opening Word, Excel or Slides no longer synchronously loads legacy Office encodings and the PDF attachment engine. Load the Word AI panel asynchronously while preserving its layout width, conversation and draft behavior.
- Reproducible whole-process memory comparisons and validation limits are recorded in [the performance report](docs/Memory-performance-2026-10-24.md).

## ✨ Key Features

### 📑 Office

- Integrated office suite with AI Docs, AI Sheets, AI Slides, and AI PDF
- Rich document editing: headings, lists, links, tables, images, and formulas
- Friday sidebar for AI writing, polishing, translation, and one-click slide generation
- Create new files or open local `.docx` / `.xlsx` / `.csv` / `.pptx` / `.pdf` files
- Recent files with filtering by type (documents / sheets / slides / PDF)

### 🤖 Friday AI Assistant

- Built with [DeepAgent SDK](https://github.com/frost-beta/deepagents) and LangChain
- 12+ built-in tools: knowledge-base search, note and schedule management, file operations, shell execution, Python REPL, HTTP requests, web scraping, JSON processing, calculator, and more
- Human-in-the-Loop (HITL) support for approval before sensitive operations
- SKILL system that loads Markdown skill descriptions from the `SKILL/` directory
- Subagents and cross-session memory powered by SQLite and InMemoryStore

### 📚 Knowledge Base

- Personal, local, and agent knowledge bases
- Full RAG pipeline: document loading -> parent-child chunking -> embedding -> vector search
- Unified [Zvec](https://github.com/zvec/zvec) vector storage, separated by `kb_type`
- File watching, scheduled incremental indexing, and manual updates
- PDF, Word, Excel, Markdown, HTML, EPUB, and plain-text support

### 📝 Notes

- [TipTap](https://tiptap.dev/) rich-text editor
- Syntax-highlighted code blocks, tables, task lists, images, links, and more
- AI Fill-in-the-Middle (FIM) completion
- Version history and diff comparison

### ✏️ Drawing

- Built-in shape libraries: general shapes, lines, mind maps, flowcharts, ER diagrams, UML diagrams, system architecture, sequence diagrams, timelines, and data-flow diagrams
- One-click templates for mind maps and flowcharts, with canvas categories, search, and import
- Customizable styles (fill, text, stroke width, font); connectors with orthogonal, polyline, and curved routing
- Shape animations: pulse, breathe, bounce, and flow
- Export to PNG / SVG / JSON, plus read-only share links

### 📅 Schedule

- Custom-built calendar with month / week / year / list views
- Lunar calendar support
- Create and update schedules with natural language through Friday

### 🎨 More

- Light, dark, and system themes
- Simplified Chinese and English localization
- Automatic data backups
- Multi-tab interface

## 🖼️ Screenshots

### Friday AI Assistant

![Friday assistant home](docs/resource/PixPin_2026-08-15_16-51-10.png)

![Friday chat and code execution](docs/resource/PixPin_2026-09-22_23-43-29.png)

### Office

![Office home with AI Docs, Sheets, Slides, and PDF entries](docs/resource/PixPin_2026-09-22_23-11-03.png)

![AI Docs editor with Friday sidebar](docs/resource/PixPin_2026-09-22_23-13-35.png)

![AI Slides editor with Friday sidebar](docs/resource/PixPin_2026-09-22_23-14-07.png)

![AI Sheets editor with Friday sidebar](docs/resource/PixPin_2026-09-22_23-15-21.png)

### Knowledge Base

![Knowledge base file cards](docs/resource/4.png)

### Notes

![Rich-text note editor](docs/resource/PixPin_2026-09-22_23-45-35.png)

### Drawing

![Drawing canvas](docs/resource/PixPin_2026-09-13_20-39-53.png)

### Schedule

![Schedule calendar](docs/resource/5.png)

### Automated Tasks

![Automated tasks](docs/resource/6.png)

### DeepSeek Harness

![DeepSeek Harness](docs/resource/7.png)

### Settings

![Settings and feature overview](docs/resource/8.png)

## 🚀 Quick Start

### Requirements

- Node.js >= 20 (22 recommended)
- npm >= 10
- macOS, Windows, or Linux

### Install Dependencies

```bash
npm install --legacy-peer-deps
```

### Run in Development

```bash
# Frontend only
npm run dev

# Electron + frontend (starts Electron automatically)
npm run electron:dev
```

### Build a Release Package

```bash
# Build an installer for the current platform
npm run electron:build

# Build for arm64
npm run electron:build:arm64
```

Build artifacts are written to `release/`.

> Configure Python under **Settings -> General -> Python Environment**:
> 1. Use **Auto Detect** to find an installed interpreter, or select its executable manually.
> 2. Missing dependencies can be installed automatically by the AI assistant from `python/requirements.txt` using pip/pip3.

## 📦 Download

Download the installer for your platform from [Releases](../../releases):

| Platform | Artifact |
| --- | --- |
| macOS (Apple Silicon) | `*-mac-arm64.dmg` |
| Windows | `*-win-x64-setup.exe` |
| Linux | `*-linux-*.AppImage` |

## 🛠️ Tech Stack

| Layer | Technology |
| --- | --- |
| Desktop framework | Electron 42 |
| Frontend framework | Vue 3 + Vite 6 |
| State management | Pinia |
| Routing | Vue Router |
| Internationalization | Vue I18n |
| Rich-text editor | TipTap |
| Calendar | Custom Vue calendar component |
| AI agent | DeepAgents + LangChain |
| Vector database | Zvec |
| Local database | SQLite (sql.js) |
| Python runtime | Bundled portable Python for the Agent `python_repl` tool |

## 📂 Project Structure

```text
happy-friday-lite/
├── main.js                  # Electron main-process entry
├── preload.cjs              # Preload script
├── src/                     # Vue frontend source
│   ├── components/          # Shared components (chat / layout)
│   ├── views/               # Page views
│   │   ├── friday/          # Friday assistant
│   │   ├── office/          # Office suite (Docs / Sheets / Slides / PDF)
│   │   ├── knowledge/       # Knowledge base
│   │   ├── note/            # Notes
│   │   ├── drawing/         # Drawing
│   │   ├── schedule/        # Schedule
│   │   ├── history/         # Version history
│   │   └── settings/        # Settings
│   ├── store/               # Pinia state modules
│   ├── i18n/                # Localization resources
│   └── router/              # Router configuration
├── src-electron/            # Electron backend
│   ├── agent/               # Agent core (tools / skills / subagents / permissions / memory)
│   ├── rag/                 # RAG pipeline (loading / chunking / embedding / retrieval)
│   ├── db.js                # SQLite database
│   ├── llm.js               # LLM adapter
│   └── python-env.js        # Python runtime environment
├── python/                  # Python runtime download scripts
├── scripts/                 # Build helper scripts
└── .github/workflows/       # CI build workflows
```

## 🔧 Configure an AI Model

On first use, go to **Settings -> Model Configuration** and enter an API Base URL (for example, `https://api.openai.com/v1`), API key, and model name.

Any OpenAI-compatible provider is supported, including OpenAI, DeepSeek, Qwen, Zhipu AI, Kimi, and Doubao.

## 🤝 Contributing

Issues and pull requests are welcome. Please ensure the project builds successfully, changes follow the existing code style, and documentation is updated with new features.

## 📄 License

This project is released under the [PolyForm Noncommercial License 1.0.0](./LICENSE).

- ✅ Allowed: personal use, learning and research, modifying the code, and distributing the source code
- ❌ Prohibited: commercial use in any form
- ⚠️ Required: retain the original author's attribution and copyright notice when using or distributing the project

Read [LICENSE](./LICENSE) for details.

## 🙏 Acknowledgments

- [Electron](https://www.electronjs.org/)
- [Vue.js](https://vuejs.org/)
- [LangChain](https://github.com/langchain-ai/langchain)
- [DeepAgents](https://github.com/frost-beta/deepagents)
- [TipTap](https://tiptap.dev/)
- [Zvec](https://github.com/zvec/zvec)

## 📧 Contact


## 3.0.6-preview.2 Clipboard capabilities

The tray and quick panel support Ctrl+Shift+V from external apps. Selection supports filtered select-all, Shift ranges, Ctrl+A outside text inputs, and sequential paste. Queues lock the destination, advance only after success, pause on failure, and offer resume/skip/cancel. Closing exits by default; background mode requires an available tray. The optional queue shortcut starts disabled. A separate test runtime passed actual external paste and two-item ordered delivery; final installed-build acceptance remains pending.

Note archival preserves rich structure, all supported images and source metadata. The original note editor accepts managed PNG content, and edits/appends can create fresh snapshots. Existing DeepSeek configuration passed real text and multi-image OCR archival against temporary data without writing keys into reports. Ordinary file contents now use the existing RAG loaders; completed audio/video transcripts can be analyzed. Full file/media acceptance and transcription of untranscribed media remain pending. See `docs/Friday-preview-delivery-status.md` for the complete checklist.

Rich-text images now use the same preview and image editor as bitmap and file entries. Embedded images render locally; website/file references require a click before loading. Edits preserve surrounding text, and QR sharing includes the actual images. Canceling rich-text editing restores the saved content and images. Preview zoom follows the cursor, panning stays within image bounds, and dialog footers wrap on narrow windows. `scripts/probe-clipboard-media-ui.mjs` checks real Canvas pixels, pen/undo/redo/text/mosaic/crop/rotate, original preservation, rich image preview/edit/share, code and link editing, and actual WAV/WebM playback and seeking through temporary Electron data. These are development checks, not installed-build acceptance.

Multi-select supports row checkboxes, Shift range selection, select/deselect all current filtered results, Ctrl/Cmd+A outside text fields, and Escape to exit. Batch actions include favorites, additive tags and category assignment, merge-and-copy (originals retained), and confirmed deletion to Recently Deleted. All selected IDs and tag limits are validated before changes; sensitive entries cannot be merged or organized. The toolbar is checked at 1280, 640 and 420 pixels.

File and folder QR sharing prepares Unicode ZIP archives in a worker, offers network address selection and explicit revocation, and expires after ten minutes. Limits are 100 selected files/folders, 20,000 archive entries and 256 MiB; unsupported links, missing sources and limits fail explicitly. Real phone/LAN acceptance is still pending. Missing or unreadable configured recording directories now show actionable feedback; actual recorder completion and playback still need acceptance.

Windows capture reads text, HTML and file paths under one native clipboard lock and retries transient contention. Native file copying waits up to 100 ms for the clipboard lock; exhausted retries report failure. `scripts/probe-clipboard-electron.mjs` exercises the actual system clipboard and restores its prior contents, covering mixed-format copying, sensitive batch rejection and self-write deduplication.

Phrase management now sends plain tag arrays across Electron IPC, fixing failed creation and editing. Saving a phrase opens the phrases list and clears filters that could hide it. Category and tag creation have visible entry points and a fixed creation form in the management dialog footer. Recording folder settings also send a plain array. For development acceptance, start `npm run dev`, then run `node_modules/.bin/electron.cmd scripts/probe-clipboard-creation-ui.mjs`. It uses a temporary database and hidden test window to cover real preload/IPC, creation and editing, duplicate feedback, reload persistence, and narrow window button visibility. This does not replace mouse acceptance in an installed build.

Clipboard now supports image thumbnails and full preview, separate file and path copying, context menus, categories, tags, favorites, pins, phrases and Recently Deleted. Settings control capture, images, sensitive retention, capacity, global shortcut and cleanup. Optional AI classification can save important non-sensitive content to notes; it is off by default and sensitive content is excluded from search and models.

The history toolbar keeps phrase, category and tag creation directly visible. Category, tag and date filters expand on demand and remain visible as removable summaries when collapsed; multi-select actions use a separate expandable row. The existing Friday controls and theme transitions are retained. Development checks cover 420/640/1280px layouts, light and dark themes, English labels, selection state and the existing creation/batch/QR flows. Final installed-window acceptance is still pending; see `docs/Clipboard-density-acceptance-2026-10-24.md`.

File context menus now expose AI analysis through the existing document parser. Audio and video without a valid transcript are transcribed automatically before classification, using Windows local speech by default. Clipboard settings offer a separate transcription engine selector and exclude known chat-only models such as DeepSeek. Unknown-sensitivity transcripts stay in memory; privacy changes, edits, expiry and cancellation prevent stale archiving. See `docs/Clipboard-media-ai-acceptance-2026-10-24.md` for real model and UI development evidence; final installed-system acceptance remains pending.

Screen pins now synchronize their compact/expanded content when an existing pin is reopened, refresh open menus with the latest item state, and reject stale thumbnail responses after image edits. Existing pin windows hide the redundant pin-to-screen command. The independent-window development probe covers menus, image preview, memo refresh, work-area bounds and cleanup; visible Windows topmost behavior and physical dragging remain separate system checks. See `docs/Clipboard-pins-acceptance-2026-10-24.md`.

## 3.0.6 preview development

Windows packaging preserves Electron's Chromium notices, regenerates the upstream Office/font/native notices and aggregates licenses from the collected application dependencies. A machine-readable audit records packages with missing published license text; these still require review before release. The app license is included explicitly. This packaging work does not certify the installer or close the delivery gates.

Windows cleanup now uses a shared API that never follows directory links. This fixes a reproduced Electron 42.2.0 issue where recursively deleting a DSH profile traversed junctions and removed runtime dependencies. Backup restore, Recently Deleted, skills, RAG and share cleanup use the same API. Repeated real DSH startup and a DeepSeek conversation preserved SHA256 hashes of 7,103 dependency files; real Electron backup/restore and permanent-delete probes preserved external link targets. These are development checks; installed-build acceptance remains pending. See `docs/DSH-runtime-root-cause-2026-10-24.md`.

The note context menu now uses the original knowledge directory picker. The main process validates the note and destination, rejects conflicts, and records the reference. A knowledge reference can open its original note. Long press and multi-select in the original note sidebar support select-all and batch pin, move, add to knowledge, and confirmed delete; an isolated Electron UI probe covers the flow. The mouse wheel also scrolls real horizontal overflow areas, including note tables and code blocks; installed-build interaction checks remain pending.

Knowledge categories can be created, renamed, reordered, sent to Recently Deleted, and restored with their original names. Knowledge bases can move between categories while preserving their files; invalid and duplicate names are rejected. The sidebar uses the existing dialogs and context menus. An isolated Electron probe checks creation, rename, move, deletion, and restoration through real preload/IPC; installed-build acceptance remains pending.

The DSH CLI entry check now resolves the declared `bin.dsh` entry, and the built-in MCP client sends Friday's local authorization header. A real Electron probe using a copied, isolated model configuration synchronized 29 tools, selected a workspace, sent a prompt and received a persisted DeepSeek reply. Installed-build acceptance is still pending.

Recently Deleted stores deleted notes (including knowledge references), knowledge files and folders, and clipboard records. It supports batch restore, alternate restore locations, exporting notes/resources, and confirmed permanent deletion with content-free audit records. Expired sensitive clipboard content cannot be recovered. This preview is under development; installation, system integrations, and the complete iteration acceptance gates are not yet certified.

Module settings support stable-ID order, drag events, keyboard buttons and reset. Office visibility now survives reloading, and the displayed count uses the actual supported modules. Isolated preload/IPC checks cover these settings and the Recently Deleted recovery flow. An isolated copy of the installed 3.0.6 database passed upgrade, legacy reopen and reupgrade while preserving all original rows and model configuration; installer lifecycle acceptance remains pending.

For questions or suggestions, open an [Issue](../../issues) or email chenjie.plus@qq.com.

## Office preview: shared file commands and source preservation

The original Word context menu now includes Select All, Find, Undo and Redo. Read-only mode disables writing commands with a reason while keeping copy, selection and search available. Arrow keys, Home/End and Escape support menu navigation and returning to the editor. Word output through the Windows system print dialog has development acceptance evidence; other printing paths and installed-build acceptance remain on the delivery checklist.

Slides keeps its original context menu and adds canvas/object Select All, Find/Replace, Undo and Redo, with availability based on document history. Long table menus scroll and support arrow keys, Home/End and Escape without sending destructive keys to the canvas. Successful shared transactions now preserve the unsaved state after archive updates; paste and undo/redo maintain the state used by close warnings and recovery copies. Final installed-build acceptance remains pending.

Excel adds whole-sheet Select All, Find, Undo and Redo to Univer's original cell, row-header and column-header menus, using its existing selection model, commands and history service. An isolated real-workbook probe covers whole-sheet selection, edit undo/redo, the original find panel, preserved header insert commands, language switching and narrow dark layouts. The native grid now switches language with the toolbar; stale or canceled locale imports cannot overwrite the latest choice. Final installed-build acceptance remains tracked work.

PDF document context menus now connect selected-text copy, search, AI references, highlight/underline/strikeout, TXT selection export, page navigation/rotation and undo/redo. They reuse the original PDF menu styling and dismissal behavior; encrypted documents disable modification with a reason. Full-document selection uses the text index, includes unmounted pages, and supports Ctrl+A/Ctrl+C, TXT export and AI references while preserving virtual rendering. TXT export protects the source file, including hard-link aliases. Final installed-build acceptance remains tracked work.

Office initializes the document engine for shared recent-file support, then loads the other engines on first use with one shared loading promise per type. The isolated startup comparison shows lower host initialization and total launch time, but opening a document after initialization still misses the planned 20% improvement; the performance gate remains open.

Word now mounts its empty editor before opening, reads source bytes alongside renderer startup, resets document history with one view update, and avoids repeated style-gallery layout. Source changes during startup trigger a fresh read; password and recovery prompts retain the original flow. Real copy/history/read-only and complete style cards pass development checks; detailed timing evidence and the unfinished performance gate are recorded in docs/Office-startup-acceptance-2026-10-24.md.

The four editors share the original Office menu/dialog styles and theme tokens. Word exports the current document to DOCX/TXT/Markdown; Sheets exports the current journal to XLSX/TXT/Markdown without committing it; Slides exports PPTX and illustrated Word handouts with notes. System Microsoft Office handles DOC/XPS, spreadsheet PDF/XPS, presentation PDF/XPS/video/animated GIF, and PPT/POT/POTX/PPS/PPSX/ODP file types. Missing or busy converters return an actionable capability error. Cancelled and failed exports preserve existing targets and source files.

PDF selection now reports page, text item and character positions, and annotation geometry uses selected text fragments. Double-click/Shift selection and OCR rotation handling are corrected. Windows OCR is compiled and staged by the Friday build; bundled resource paths resolve at runtime and recognition runs asynchronously. Development acceptance and remaining installation/printing/performance gates are tracked in `docs/Office-menu-export-selection-acceptance-2026-10-24.md` and `docs/Friday-preview-delivery-status.md`; this is not a delivered installer.

## Recitation preview: local transcription and correction

Audio import, managed playback, Windows local transcription, timestamps/confidence, reference alignment, study plans and three question types are connected. Users can correct segments while retaining original recognition, timestamps and model confidence. Retry cancellation preserves valid earlier results. Questions jump to their audio source; sessions survive reopening. DeepSeek chat-only models are not offered as speech models. Local recognition can be inaccurate and needs review; no-reference sessions do not invent accuracy or repetition counts. See `docs/Recitation-acceptance-2026-10-24.md` for development evidence and remaining installation gates.
# Typewriter workspace

Happy Friday Lite includes an independent `/typewriter` workspace. It reuses Typewriter Nocturne's paper, lighting, 3D typewriter, sound and terminal surface, while running local PowerShell/Bash sessions through Friday's Electron IPC boundary. The workspace includes bilingual settings, Markdown/code entry points, Press and Archive, and remains independent from Friday's AI, RAG and note business logic.

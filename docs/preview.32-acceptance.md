# Preview.32 acceptance record

Date 2026-11-04 Asia/Shanghai. The source branch is `codex/friday-3.0.7-preview.28` and the release target is `3.0.7.01-preview.32`.

## User data audit

A read-only SQLite audit of the existing profile found 61 notes, 4 notebooks, 254 clipboard items, 0 recitation sessions and 4 file-status rows. The knowledge directory contains 252 files. Configuration was inspected only for the configured Python executable and was not copied into release assets. The four personal index records initially reported a missing Embedding model. The new local keyword-vector fallback rebuilt all four records successfully with 34 vectors, without changing configuration or source documents.

## Root fixes

- `src-electron/commands.js` had a duplicate screenshot IPC registration. The duplicate group was removed so later clipboard, recitation, Python and RAG handlers register.
- `main.js` now reports a startup registration failure and exits instead of presenting a window with missing handlers.
- The clipboard share server now imports its file-packaging, network-address, crypto and media-type dependencies.
- Note asset protocol loading uses Electron's default namespace and remains compatible with Electron and Node contract-test loaders.
- DeepSeek chat-only profiles now use a deterministic local keyword embedding fallback, while explicitly configured remote Embedding models keep priority. This removes the unusable missing-model state for local knowledge indexing.
- Settings displays the preview release version and the Windows package is named with preview.32.

## Verification

- Vite production build completed and produced `dist/index.html`.
- Packaged startup smoke passed. It checked the real renderer, preload, clipboard list/settings, recitation list, Python status, and knowledge-base summary IPC.
- Packaged native-module verifier passed for x64 and verified Harness imports, the Node addon binding and three Windows PE helpers.
- `node --test scripts/tests/*.test.mjs` passed all 310 tests. The Windows Electron junction probe and the new local-embedding test also pass in the focused run.
- `node scripts/probe-rag-recovery.mjs` passed isolated missing-embedding recovery, HTTP embedding protocol, indexing, vector retrieval, database/vector-store reopen, unchanged skipping and deletion cleanup.
- The existing personal knowledge base was rebuilt in place with `changed: 4, failed: 0` and summary `success: 4, failed: 0, vectorCount: 34`.
- The Windows x64 installer is `Happy-Friday-Lite-3.0.7.01-preview.32-win-x64-setup.exe`, 268869232 bytes, SHA256 `8b63a6e8359f36c39a94ca5dd631b3ca6c7246e928b4dfd2b108e0a1f9b54603`.

## Official and preview.27 comparison

The current source contains official master/3.0.6 commit `1ad99a7` and official feature-automation/3.0.7 commit `670f22b` through merge `a911838`. Preview.27 commit `253b3e9` is an ancestor of the current source. The preview.27 delta retains Typewriter, plugins, Office, recitation, module settings, routes, clipboard, file-backed note images, paste compression, notebook duplicate protection and IME fixes. The source comparison contained no deletion of those feature paths.

## Release acceptance

Installer metadata in `release/latest.yml` matches the generated installer size and SHA-512. The separate SHA-256 list and release notes are generated under `release/` for upload. User data and configuration are excluded from the repository and release assets.

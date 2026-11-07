"use strict";
const electron = require("electron");
const DROP_OPEN_CHANNEL = "app:open-dropped-files";
const OPENABLE_DOC_RE = /\.(docx|odt|ott|xlsx|xlsm|xls|csv|tsv|ods|ots|pptx|odp|otp|pdf|md|markdown|html|htm)$/i;
const KNOWN_UNSUPPORTED_DOC_RE = /\.(doc|rtf|ppt|pps|xlsb|pages|key|numbers)$/i;
const MAX_DROPPED_FILES = 20;
function tryResolvePath(file, getPathForFile) {
  try {
    return getPathForFile(file).trim();
  } catch {
    return "";
  }
}
const MAX_RESOLVED_DROP_PATHS = 100;
const MAX_DROP_PATH_CHARS = 4096;
function droppableFilePaths(ev, getPathForFile) {
  const transfer = ev.dataTransfer;
  if (!transfer || !transfer.types.includes("Files")) return null;
  const paths = [];
  for (const file of Array.from(transfer.files)) {
    if (paths.length >= MAX_RESOLVED_DROP_PATHS) break;
    const path = tryResolvePath(file, getPathForFile);
    if (!path || path.length > MAX_DROP_PATH_CHARS) continue;
    paths.push(path);
  }
  return paths;
}
const INSTALLED = /* @__PURE__ */ Symbol.for("genoffice.drop-open-installed");
function installDropOpenBridge() {
  const holder = globalThis;
  if (typeof window === "undefined" || holder[INSTALLED]) return;
  holder[INSTALLED] = true;
  window.addEventListener("dragover", (ev) => {
    if (ev.defaultPrevented) return;
    if (!ev.dataTransfer?.types.includes("Files")) return;
    ev.preventDefault();
  });
  window.addEventListener("drop", (ev) => {
    if (ev.defaultPrevented) return;
    const paths = droppableFilePaths(ev, (file) => electron.webUtils.getPathForFile(file));
    if (!paths) return;
    const payload = paths.filter((p) => OPENABLE_DOC_RE.test(p) || KNOWN_UNSUPPORTED_DOC_RE.test(p));
    ev.preventDefault();
    if (payload.length === 0) return;
    electron.ipcRenderer.send(DROP_OPEN_CHANNEL, payload.slice(0, MAX_DROPPED_FILES));
  });
}
const HTML_CHANNELS = {
  consumePending: "html:consume-pending",
  previewUpdate: "html:preview-update",
  previewInfo: "html:preview-info",
  presentFullScreen: "html:present-fullscreen",
  presentNewTab: "html:present-new-tab",
  readFile: "html:read-file",
  save: "html:save",
  saveRequest: "html:save-request",
  saveRequestAck: "html:save-request-ack",
  readTextRequest: "html:read-text-request",
  readTextResult: "html:read-text-result",
  dirtyChanged: "html:dirty-changed",
  closeSaveRequest: "html:close-save-request",
  closeSaveResult: "html:close-save-result",
  fileRenamed: "html:file-renamed",
  fileChangedOnDisk: "html:file-changed-on-disk",
  ackFileChangedOnDisk: "html:ack-file-changed-on-disk",
  provisionalTitle: "html:provisional-title",
  pickImage: "html:pick-image",
  saveImage: "html:save-image",
  readImage: "html:read-image",
  fetchImage: "html:fetch-image",
  exportRequest: "html:export-request",
  exportDocx: "html:export-docx",
  exportPdf: "html:export-pdf",
  exportHtml: "html:export-html",
  consumeHeadlessExport: "html:consume-headless-export",
  headlessExportDone: "html:headless-export-done",
  printRequest: "html:print-request",
  printHtml: "html:print-html",
  aiGenerateImage: "html:ai-generate-image",
  filesPick: "html:files-pick",
  filesAdd: "html:files-add",
  filesAddPastedImage: "html:files-add-pasted-image",
  filesRead: "html:files-read",
  filesReadImage: "html:files-read-image",
  getLanguage: "app:get-language",
  languageChanged: "app:language-changed",
  getTheme: "app:get-theme",
  themeChanged: "app:theme-changed",
  getAutoSaveDefault: "app:get-auto-save-default",
  autoSaveDefaultChanged: "app:auto-save-default-changed",
  getAiPanelPrefs: "app:get-ai-panel-prefs",
  aiPanelPrefsChanged: "app:ai-panel-prefs-changed"
};
const AI_CHANNELS = {
  getSettings: "ai:get-settings",
  setSettings: "ai:set-settings",
  settingsChanged: "ai:settings-changed",
  openModelSettings: "ai:open-model-settings",
  gskStatus: "ai:gsk-status",
  stream: "ai:stream",
  streamChunk: "ai:stream-chunk",
  streamCancel: "ai:stream-cancel",
  webSearch: "ai:web-search",
  imageSearch: "ai:image-search"
};
const api = {
  consumePending: () => electron.ipcRenderer.invoke(HTML_CHANNELS.consumePending),
  openSourcePath: (path) => electron.ipcRenderer.invoke("home:open-path", path),
  consumeHeadlessExport: () => electron.ipcRenderer.invoke(HTML_CHANNELS.consumeHeadlessExport),
  headlessExportDone: (result) => electron.ipcRenderer.send(HTML_CHANNELS.headlessExportDone, result),
  readFile: (path) => electron.ipcRenderer.invoke(HTML_CHANNELS.readFile, path),
  updatePreview: (text) => electron.ipcRenderer.send(HTML_CHANNELS.previewUpdate, text),
  getPreviewInfo: () => electron.ipcRenderer.invoke(HTML_CHANNELS.previewInfo),
  setPresentFullScreen: (on) => electron.ipcRenderer.invoke(HTML_CHANNELS.presentFullScreen, on),
  presentInNewTab: (title) => electron.ipcRenderer.invoke(HTML_CHANNELS.presentNewTab, title),
  save: (request) => electron.ipcRenderer.invoke(HTML_CHANNELS.save, request),
  setDirty: (dirty) => electron.ipcRenderer.send(HTML_CHANNELS.dirtyChanged, dirty),
  onSaveRequest: (handler) => {
    const listener = (_e, mode) => handler(mode);
    electron.ipcRenderer.on(HTML_CHANNELS.saveRequest, listener);
    return () => electron.ipcRenderer.removeListener(HTML_CHANNELS.saveRequest, listener);
  },
  onCloseSaveRequest: (handler) => {
    const listener = () => handler();
    electron.ipcRenderer.on(HTML_CHANNELS.closeSaveRequest, listener);
    return () => electron.ipcRenderer.removeListener(HTML_CHANNELS.closeSaveRequest, listener);
  },
  sendCloseSaveResult: (ok) => electron.ipcRenderer.send(HTML_CHANNELS.closeSaveResult, ok),
  sendSaveRequestAck: (ok) => electron.ipcRenderer.send(HTML_CHANNELS.saveRequestAck, ok),
  onReadTextRequest: (handler) => {
    const listener = () => handler();
    electron.ipcRenderer.on(HTML_CHANNELS.readTextRequest, listener);
    return () => electron.ipcRenderer.removeListener(HTML_CHANNELS.readTextRequest, listener);
  },
  sendReadTextResult: (result) => electron.ipcRenderer.send(HTML_CHANNELS.readTextResult, result),
  onFileRenamed: (handler) => {
    const listener = (_e, newPath) => handler(newPath);
    electron.ipcRenderer.on(HTML_CHANNELS.fileRenamed, listener);
    return () => electron.ipcRenderer.removeListener(HTML_CHANNELS.fileRenamed, listener);
  },
  onFileChangedOnDisk: (handler) => {
    const listener = (_e, path) => handler(path);
    electron.ipcRenderer.on(HTML_CHANNELS.fileChangedOnDisk, listener);
    return () => electron.ipcRenderer.removeListener(HTML_CHANNELS.fileChangedOnDisk, listener);
  },
  ackFileChangedOnDisk: () => electron.ipcRenderer.send(HTML_CHANNELS.ackFileChangedOnDisk),
  setProvisionalTitle: (title) => electron.ipcRenderer.send(HTML_CHANNELS.provisionalTitle, title),
  pickImage: () => electron.ipcRenderer.invoke(HTML_CHANNELS.pickImage),
  saveImage: (data) => electron.ipcRenderer.invoke(HTML_CHANNELS.saveImage, data),
  readImage: (src) => electron.ipcRenderer.invoke(HTML_CHANNELS.readImage, src),
  pickAttachments: () => electron.ipcRenderer.invoke(HTML_CHANNELS.filesPick),
  addAttachmentPaths: (paths) => electron.ipcRenderer.invoke(HTML_CHANNELS.filesAdd, paths),
  addPastedImage: (data, ext) => electron.ipcRenderer.invoke(HTML_CHANNELS.filesAddPastedImage, data, ext),
  readAttachment: (path, offset, maxChars) => electron.ipcRenderer.invoke(HTML_CHANNELS.filesRead, path, offset, maxChars),
  readAttachmentImage: (path) => electron.ipcRenderer.invoke(HTML_CHANNELS.filesReadImage, path),
  getPathForFile: (file) => electron.webUtils.getPathForFile(file),
  onExportRequest: (handler) => {
    const listener = (_e, format) => handler(format);
    electron.ipcRenderer.on(HTML_CHANNELS.exportRequest, listener);
    return () => electron.ipcRenderer.removeListener(HTML_CHANNELS.exportRequest, listener);
  },
  onPrintRequest: (handler) => {
    const listener = () => handler();
    electron.ipcRenderer.on(HTML_CHANNELS.printRequest, listener);
    return () => electron.ipcRenderer.removeListener(HTML_CHANNELS.printRequest, listener);
  },
  exportDocx: (request) => electron.ipcRenderer.invoke(HTML_CHANNELS.exportDocx, request),
  exportPdf: (request) => electron.ipcRenderer.invoke(HTML_CHANNELS.exportPdf, request),
  exportHtml: (request) => electron.ipcRenderer.invoke(HTML_CHANNELS.exportHtml, request),
  printHtml: (request) => electron.ipcRenderer.invoke(HTML_CHANNELS.printHtml, request),
  getLanguage: () => electron.ipcRenderer.invoke(HTML_CHANNELS.getLanguage),
  onLanguageChanged: (handler) => {
    const listener = (_e, lang) => handler(lang);
    electron.ipcRenderer.on(HTML_CHANNELS.languageChanged, listener);
    return () => electron.ipcRenderer.removeListener(HTML_CHANNELS.languageChanged, listener);
  },
  getTheme: () => electron.ipcRenderer.invoke(HTML_CHANNELS.getTheme),
  onThemeChanged: (handler) => {
    const listener = (_e, theme) => handler(theme);
    electron.ipcRenderer.on(HTML_CHANNELS.themeChanged, listener);
    return () => electron.ipcRenderer.removeListener(HTML_CHANNELS.themeChanged, listener);
  },
  getAutoSaveDefault: () => electron.ipcRenderer.invoke(HTML_CHANNELS.getAutoSaveDefault),
  onAutoSaveDefaultChanged: (handler) => {
    const listener = (_e, value) => handler(value);
    electron.ipcRenderer.on(HTML_CHANNELS.autoSaveDefaultChanged, listener);
    return () => electron.ipcRenderer.removeListener(HTML_CHANNELS.autoSaveDefaultChanged, listener);
  },
  getAiPanelPrefs: () => electron.ipcRenderer.invoke(HTML_CHANNELS.getAiPanelPrefs),
  setAiPanelPrefs: (patch) => electron.ipcRenderer.invoke("app:set-ai-panel-prefs", patch),
  onAiPanelPrefsChanged: (handler) => {
    const listener = (_event, prefs) => handler(prefs);
    electron.ipcRenderer.on(HTML_CHANNELS.aiPanelPrefsChanged, listener);
    return () => electron.ipcRenderer.removeListener(HTML_CHANNELS.aiPanelPrefsChanged, listener);
  },
  onChromePressed: (handler) => {
    const listener = () => handler();
    electron.ipcRenderer.on("app:chrome-pressed", listener);
    return () => electron.ipcRenderer.removeListener("app:chrome-pressed", listener);
  },
  getAiSettings: () => electron.ipcRenderer.invoke(AI_CHANNELS.getSettings),
  setAiSettings: (settings) => electron.ipcRenderer.invoke(AI_CHANNELS.setSettings, settings),
  onAiSettingsChanged: (handler) => {
    const listener = () => handler();
    electron.ipcRenderer.on(AI_CHANNELS.settingsChanged, listener);
    return () => electron.ipcRenderer.removeListener(AI_CHANNELS.settingsChanged, listener);
  },
  openAiModelSettings: () => electron.ipcRenderer.invoke(AI_CHANNELS.openModelSettings),
  openSkillsSettings: () => electron.ipcRenderer.invoke("ai:open-skills-settings"),
  skillsList: () => electron.ipcRenderer.invoke("ai:skills-list"),
  skillText: (name) => electron.ipcRenderer.invoke("ai:skill-text", name),
  aiGskStatus: () => electron.ipcRenderer.invoke(AI_CHANNELS.gskStatus),
  aiStream: (request) => electron.ipcRenderer.invoke(AI_CHANNELS.stream, request),
  aiStreamCancel: (requestId) => electron.ipcRenderer.invoke(AI_CHANNELS.streamCancel, requestId),
  onAiStream: (handler) => {
    const listener = (_e, chunk) => handler(chunk);
    electron.ipcRenderer.on(AI_CHANNELS.streamChunk, listener);
    return () => electron.ipcRenderer.removeListener(AI_CHANNELS.streamChunk, listener);
  },
  webSearch: (query, maxResults) => electron.ipcRenderer.invoke(AI_CHANNELS.webSearch, query, maxResults),
  imageSearch: (query, maxResults) => electron.ipcRenderer.invoke(AI_CHANNELS.imageSearch, query, maxResults),
  fetchImage: (url) => electron.ipcRenderer.invoke(HTML_CHANNELS.fetchImage, url),
  aiGenerateImage: (op) => electron.ipcRenderer.invoke(HTML_CHANNELS.aiGenerateImage, op)
};
const projectApi = {
  resolveChat: (args) => electron.ipcRenderer.invoke("project:resolveChat", args),
  appendChat: (args) => electron.ipcRenderer.invoke("project:appendChat", args),
  loadChat: (args) => electron.ipcRenderer.invoke("project:loadChat", args),
  rebindChat: (args) => electron.ipcRenderer.invoke("project:rebindChat", args),
  listChatsForFile: (args) => electron.ipcRenderer.invoke("project:listChatsForFile", args),
  createChat: (args) => electron.ipcRenderer.invoke("project:createChat", args),
  selectChatForFile: (args) => electron.ipcRenderer.invoke("project:selectChatForFile", args),
  updateChatForFile: (args) => electron.ipcRenderer.invoke("project:updateChatForFile", args),
  copyChatsToFile: (args) => electron.ipcRenderer.invoke("project:copyChatsToFile", args)
};
const aiNamingApi = {
  suggestFileName: (input) => electron.ipcRenderer.invoke("ai:suggest-file-name", input)
};
electron.contextBridge.exposeInMainWorld("htmlApi", api);
electron.contextBridge.exposeInMainWorld("aiNamingApi", aiNamingApi);
electron.contextBridge.exposeInMainWorld("projectApi", projectApi);
installDropOpenBridge();
electron.contextBridge.exposeInMainWorld("fridayHtmlHost", {
  cancelServices: () => electron.ipcRenderer.invoke("ai:services-cancel"),
  flushPreview: () => electron.ipcRenderer.invoke("friday:html-preview-sync"),
  setPresentationSource: (text) => electron.ipcRenderer.send("friday:html-presentation-source", text),
  onPresentationChanged(handler) {
    const listener = () => handler();
    electron.ipcRenderer.on("friday:html-preview-updated", listener);
    return () => electron.ipcRenderer.removeListener("friday:html-preview-updated", listener);
  },
  mayCommit: (id) => electron.ipcRenderer.invoke("friday:html-document-commit", id),
  subscribe(handler) {
    const listener = async (_event, request) => {
      try {
        electron.ipcRenderer.send("friday:html-document-result", { id: request.id, result: await handler(request) });
      } catch (error) {
        electron.ipcRenderer.send("friday:html-document-result", { id: request.id, error: String(error?.message || error) });
      }
    };
    electron.ipcRenderer.on("friday:html-document-request", listener);
    return () => electron.ipcRenderer.removeListener("friday:html-document-request", listener);
  }
});

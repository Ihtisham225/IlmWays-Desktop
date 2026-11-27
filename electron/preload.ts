import { contextBridge, ipcRenderer } from "electron";
import type { AppState, DesktopApi, NativeScreen, SyncStatus, UpdateState, WebNav } from "../shared/types";

function listen<T>(channel: string, listener: (value: T) => void) {
  const handler = (_event: unknown, value: T) => listener(value);
  ipcRenderer.on(channel, handler);
  return () => void ipcRenderer.removeListener(channel, handler);
}

/**
 * The window's only way to the main process. The device token never comes
 * through here: the window asks the main process to sign in, sign out or
 * check the connection, and is told the resulting state.
 */
const api: DesktopApi = {
  getState: () => ipcRenderer.invoke("state:get"),
  onState: (listener) => {
    const handler = (_event: unknown, state: AppState) => listener(state);
    ipcRenderer.on("state", handler);
    return () => ipcRenderer.removeListener("state", handler);
  },
  login: (identifier, password) => ipcRenderer.invoke("auth:login", identifier, password),
  logout: () => ipcRenderer.invoke("auth:logout"),
  retryConnection: () => ipcRenderer.invoke("connection:retry"),
  getUpdateState: () => ipcRenderer.invoke("update:get"),
  onUpdateState: (listener) => {
    const handler = (_event: unknown, state: UpdateState) => listener(state);
    ipcRenderer.on("update-state", handler);
    return () => ipcRenderer.removeListener("update-state", handler);
  },
  installUpdate: () => ipcRenderer.send("update:install"),
  appVersion: () => ipcRenderer.invoke("app:version"),
  setScreen: (screen) => ipcRenderer.send("screen:set", screen),
  onScreen: (listener) => listen<NativeScreen | null>("screen", listener),
  onWebNav: (listener) => listen<WebNav>("web-nav", listener),
  webBack: () => ipcRenderer.send("web:back"),
  webForward: () => ipcRenderer.send("web:forward"),
  webReload: () => ipcRenderer.send("web:reload"),
  openAccountMenu: (at, labels) => ipcRenderer.send("menu:account", at, labels),

  getSyncStatus: () => ipcRenderer.invoke("sync:status"),
  onSyncStatus: (listener) => listen<SyncStatus>("sync-status", listener),
  syncNow: () => ipcRenderer.invoke("sync:now"),
  retryIssue: (opId) => ipcRenderer.invoke("sync:retry", opId),
  discardIssue: (opId) => ipcRenderer.invoke("sync:discard", opId),

  attendanceSetup: () => ipcRenderer.invoke("attendance:setup"),
  attendanceRegister: (sectionId, date) => ipcRenderer.invoke("attendance:register", sectionId, date),
  saveRegister: (input) => ipcRenderer.invoke("attendance:save", input),

  platform: process.platform,
  locale: navigator.language,
};

contextBridge.exposeInMainWorld("ilmways", api);

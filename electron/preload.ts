import { contextBridge, ipcRenderer } from "electron";
import type { AppState, DesktopApi, UpdateState } from "../shared/types";

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
  platform: process.platform,
  locale: navigator.language,
};

contextBridge.exposeInMainWorld("ilmways", api);

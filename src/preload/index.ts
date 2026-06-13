import { contextBridge, ipcRenderer } from "electron"
import {
  IPC,
  type AgentEvent,
  type DirectAction,
  type DispatchApi,
  type DispatchConfig,
  type DispatchSource,
  type PermissionStatus,
  type PreflightResult,
} from "../shared/types"

const api: DispatchApi = {
  send: (text: string, source?: DispatchSource) => ipcRenderer.send(IPC.send, text, source),
  runDirect: (action: DirectAction) => ipcRenderer.send(IPC.runDirect, action),
  computerTask: (instruction: string) => ipcRenderer.send(IPC.computer, instruction),
  interrupt: () => ipcRenderer.send(IPC.interrupt),
  cancelLast: () => ipcRenderer.send(IPC.cancelLast),
  onAgentEvent: (cb: (e: AgentEvent) => void) => {
    const handler = (_e: unknown, payload: AgentEvent) => cb(payload)
    ipcRenderer.on(IPC.agentEvent, handler)
    return () => ipcRenderer.removeListener(IPC.agentEvent, handler)
  },
  getConfig: (): Promise<DispatchConfig> => ipcRenderer.invoke(IPC.config),
  preflight: (): Promise<PreflightResult> => ipcRenderer.invoke(IPC.preflight),
  getPermissions: (): Promise<PermissionStatus> => ipcRenderer.invoke(IPC.getPermissions),
  requestMic: (): Promise<boolean> => ipcRenderer.invoke(IPC.requestMic),
  requestScreen: (): Promise<void> => ipcRenderer.invoke(IPC.requestScreen),
  requestAccessibility: (): Promise<boolean> => ipcRenderer.invoke(IPC.requestAccessibility),
  openScreenSettings: () => void ipcRenderer.invoke(IPC.openScreenSettings),
  openAutomationSettings: () => void ipcRenderer.invoke(IPC.openAutomationSettings),
}

contextBridge.exposeInMainWorld("dispatch", api)


import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("betterSiri", {
  transcribeAudio: (audioBase64: string) =>
    ipcRenderer.invoke("transcribe-audio", audioBase64),
});

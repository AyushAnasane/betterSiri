import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("betterSiri", {
  transcribeAudio: (audioBase64: string) =>
    ipcRenderer.invoke("transcribe-audio", audioBase64),

  chat: (
    messages: Array<{
      role: "user" | "assistant";
      content: string;
    }>
  ) => ipcRenderer.invoke("chat-with-assistant", messages),

  dismiss: () => ipcRenderer.invoke("dismiss-assistant"),

  onSummoned: (callback: () => void) => {
    const listener = () => callback();

    ipcRenderer.on("assistant-summoned", listener);

    return () => {
      ipcRenderer.removeListener("assistant-summoned", listener);
    };
  },
});
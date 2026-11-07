import { app, BrowserWindow, ipcMain, globalShortcut, screen } from "electron";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

process.env.APP_ROOT = path.join(__dirname, "..");

export const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
export const RENDERER_DIST = path.join(process.env.APP_ROOT, "dist");

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, "public")
  : RENDERER_DIST;

let win: BrowserWindow | null = null;


type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

function summonAssistant() {
  if (!win || win.isDestroyed()) return;

  if (win.webContents.isLoading()) {
    win.webContents.once("did-finish-load", () => {
      if (!win || win.isDestroyed()) return;
      win.show();
      win.focus();
      win.webContents.send("assistant-summoned");
    });
    return;
  }

  win.show();
  win.focus();
  win.webContents.send("assistant-summoned");
}

function createWindow() {
  const width = 190;
  const height = 155;

  win = new BrowserWindow({
    width,
    height,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    alwaysOnTop: true,
    resizable: false,
    movable: true,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.setAlwaysOnTop(true, "floating");
  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(RENDERER_DIST, "index.html"));
  }

  win.once("ready-to-show", () => {
    const { workArea } = screen.getPrimaryDisplay();
    win?.setPosition(
      Math.round(workArea.x + (workArea.width - width) / 2),
      Math.round(workArea.y + workArea.height / 2 - (12 + 72 / 2))
    );
    win?.show();
  });
}

ipcMain.handle("dismiss-assistant", () => {
  if (win && !win.isDestroyed()) {
    win.hide();
  }
});

ipcMain.handle("transcribe-audio", async (_event, audioBase64: string) => {
  if (typeof audioBase64 !== "string" || !audioBase64.length) {
    throw new Error("No audio data received.");
  }

  const buffer = Buffer.from(audioBase64, "base64");

  if (buffer.length < 44) {
    throw new Error("The recording is empty or invalid.");
  }

  if (buffer.length > 25 * 1024 * 1024) {
    throw new Error("Recording is too large.");
  }

  const modelPath = path.join(
    process.env.APP_ROOT!,
    "models",
    "ggml-base.en.bin"
  );

  if (!existsSync(modelPath)) {
    throw new Error("Whisper model not found in the models folder.");
  }

  const tempDirectory = await mkdtemp(
    path.join(tmpdir(), "bettersiri-")
  );

  const audioPath = path.join(tempDirectory, "recording.wav");

  try {
    await writeFile(audioPath, buffer);

    const { stdout } = await execFileAsync(
      "whisper-cli",
      [
        "-m",
        modelPath,
        "-f",
        audioPath,
        "-l",
        "en",
        "-nt",
        "-np",
      ],
      {
        timeout: 120000,
        maxBuffer: 10 * 1024 * 1024,
      }
    );

    return stdout.trim();
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Whisper transcription failed.";

    throw new Error(message);
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
});

ipcMain.handle(
  "chat-with-assistant",
  async (_event, messages: ChatMessage[]) => {
    if (!Array.isArray(messages) || messages.length === 0) {
      throw new Error("No conversation messages received.");
    }

    const validMessages = messages
      .filter(
        (message) =>
          message &&
          (message.role === "user" || message.role === "assistant") &&
          typeof message.content === "string"
      )
      .slice(-20);

    if (validMessages.length === 0) {
      throw new Error("No valid conversation messages received.");
    }

    try {
      const response = await fetch("http://127.0.0.1:11434/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "llama3.2:3b",
          stream: false,
          messages: [
            {
              role: "system",
              content:
                "You are betterSiri, a helpful desktop voice assistant. " +
                "Be conversational, concise, natural, and useful. " +
                "Your responses will be spoken aloud, so avoid markdown, " +
                "long lists, and unnecessary explanations. " +
                "Do not claim to have performed actions you cannot perform.",
            },
            ...validMessages,
          ],
          options: {
            temperature: 0.7,
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`Ollama returned HTTP ${response.status}.`);
      }

      const data = await response.json();
      const answer = data.message?.content?.trim();

      if (!answer) {
        throw new Error("Ollama returned an empty response.");
      }

      return answer;
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Could not reach Ollama.";

      throw new Error(
        message.includes("fetch failed")
          ? "Could not connect to Ollama. Make sure Ollama is running."
          : message
      );
    }
  }
);

app.whenReady().then(() => {
  createWindow();

  const registered = globalShortcut.register(
    "Alt+Space",
    summonAssistant
  );

  if (!registered) {
    console.error("Could not register the Option + Space shortcut.");
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

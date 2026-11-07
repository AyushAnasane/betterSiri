
import { app, BrowserWindow, ipcMain } from "electron";
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
      error instanceof Error ? error.message : "Whisper transcription failed.";

    throw new Error(message);
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
});

function createWindow() {
  win = new BrowserWindow({
    width: 1000,
    height: 700,
    webPreferences: {
      preload: path.join(__dirname, "preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(RENDERER_DIST, "index.html"));
  }
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
    win = null;
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.whenReady().then(createWindow);


/// <reference types="vite-plugin-electron/electron-env" />

declare namespace NodeJS {
  interface ProcessEnv {
    APP_ROOT: string;
    VITE_PUBLIC: string;
    VITE_DEV_SERVER_URL?: string;
    OPENAI_API_KEY?: string;
  }
}

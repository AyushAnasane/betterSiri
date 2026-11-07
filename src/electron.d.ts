export {};

declare global {
  interface Window {
    betterSiri: {
      transcribeAudio: (audioBase64: string) => Promise<string>;
    };
  }
}
export {};

declare global {
  interface Window {
    betterSiri: {
      transcribeAudio: (audioBase64: string) => Promise<string>;

      chat: (
        messages: Array<{
          role: "user" | "assistant";
          content: string;
        }>
      ) => Promise<string>;

      dismiss: () => Promise<void>;

      onSummoned: (callback: () => void) => () => void;
    };
  }
}
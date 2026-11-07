
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";

export default function AssistantCore() {
  const [visible, setVisible] = useState(true);
  const [listening, setListening] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [floatingText, setFloatingText] = useState("");
  const [error, setError] = useState("");
  const [voiceLevel, setVoiceLevel] = useState(0);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioAnalyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const historyRef = useRef<
    Array<{ role: "user" | "assistant"; content: string }>
  >([]);

  const startListening = useCallback(async () => {
    try {
      setError("");
      setFloatingText("Listening...");

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });

      const types = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/mp4",
      ];

      const mimeType = types.find((type) =>
        MediaRecorder.isTypeSupported(type)
      );

      if (!mimeType) throw new Error("Audio recording is unsupported.");

      const recorder = new MediaRecorder(stream, { mimeType });

      const monitorContext = new AudioContext();
      if (monitorContext.state === "suspended") {
        await monitorContext.resume();
      }
      const analyser = monitorContext.createAnalyser();
      analyser.fftSize = 512;
      monitorContext.createMediaStreamSource(stream).connect(analyser);
      audioContextRef.current = monitorContext;
      audioAnalyserRef.current = analyser;

      const audioSamples = new Uint8Array(analyser.fftSize);
      let lastUpdate = 0;
      const updateVoiceLevel = (time: number) => {
        const activeAnalyser = audioAnalyserRef.current;
        if (!activeAnalyser) return;

        if (time - lastUpdate >= 33) {
          activeAnalyser.getByteTimeDomainData(audioSamples);
          let energy = 0;
          for (const sample of audioSamples) {
            const amplitude = (sample - 128) / 128;
            energy += amplitude * amplitude;
          }

          const rms = Math.sqrt(energy / audioSamples.length);
          const level = Math.min(1, Math.max(0, (rms - 0.018) * 18));
          setVoiceLevel((current) => {
            const response = level > current ? 0.48 : 0.2;
            return current + (level - current) * response;
          });
          lastUpdate = time;
        }

        animationFrameRef.current = requestAnimationFrame(updateVoiceLevel);
      };
      animationFrameRef.current = requestAnimationFrame(updateVoiceLevel);

      chunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };

      recorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: mimeType });

        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        if (animationFrameRef.current !== null) {
          cancelAnimationFrame(animationFrameRef.current);
          animationFrameRef.current = null;
        }
        audioAnalyserRef.current = null;
        setVoiceLevel(0);
        if (audioContextRef.current) {
          await audioContextRef.current.close();
          audioContextRef.current = null;
        }

        try {
          setProcessing(true);
          setFloatingText("Understanding...");

          const context = new AudioContext();
          audioContextRef.current = context;

          const decoded = await context.decodeAudioData(
            await blob.arrayBuffer()
          );

          const samples = decoded.length;
          const channels = decoded.numberOfChannels;
          const sampleRate = decoded.sampleRate;
          const wav = new ArrayBuffer(44 + samples * 2);
          const view = new DataView(wav);

          const write = (offset: number, value: string) => {
            for (let i = 0; i < value.length; i++) {
              view.setUint8(offset + i, value.charCodeAt(i));
            }
          };

          write(0, "RIFF");
          view.setUint32(4, 36 + samples * 2, true);
          write(8, "WAVE");
          write(12, "fmt ");
          view.setUint32(16, 16, true);
          view.setUint16(20, 1, true);
          view.setUint16(22, 1, true);
          view.setUint32(24, sampleRate, true);
          view.setUint32(28, sampleRate * 2, true);
          view.setUint16(32, 2, true);
          view.setUint16(34, 16, true);
          write(36, "data");
          view.setUint32(40, samples * 2, true);

          const channelData = Array.from(
            { length: channels },
            (_, i) => decoded.getChannelData(i)
          );

          for (let i = 0; i < samples; i++) {
            let sample = 0;

            for (let channel = 0; channel < channels; channel++) {
              sample += channelData[channel][i] / channels;
            }

            sample = Math.max(-1, Math.min(1, sample));

            view.setInt16(
              44 + i * 2,
              sample < 0 ? sample * 32768 : sample * 32767,
              true
            );
          }

          const bytes = new Uint8Array(wav);
          let binary = "";

          for (let i = 0; i < bytes.length; i += 0x8000) {
            binary += String.fromCharCode(
              ...bytes.subarray(i, Math.min(i + 0x8000, bytes.length))
            );
          }

          await context.close();
          audioContextRef.current = null;

          const transcript = await window.betterSiri.transcribeAudio(
            btoa(binary)
          );

          if (!transcript.trim()) {
            setFloatingText("I didn't catch that. Try again.");
            return;
          }

          historyRef.current.push({
            role: "user",
            content: transcript,
          });

          setFloatingText(transcript);

          const answer = await window.betterSiri.chat(
            historyRef.current
          );

          historyRef.current.push({
            role: "assistant",
            content: answer,
          });

          setFloatingText(answer);
        } catch (err) {
          setError(
            err instanceof Error ? err.message : "Something went wrong."
          );
          setFloatingText("");
        } finally {
          setProcessing(false);
          setListening(false);
        }
      };

      streamRef.current = stream;
      recorderRef.current = recorder;
      recorder.start(250);
      setListening(true);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Microphone unavailable."
      );
      setFloatingText("");
      setListening(false);
    }
  }, []);

  const stopListening = useCallback(() => {
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop();
    }
  }, []);

  const dismiss = useCallback(() => {
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.onstop = null;
      recorderRef.current.stop();
    }

    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    audioAnalyserRef.current = null;
    setVoiceLevel(0);

    if (audioContextRef.current) {
      void audioContextRef.current.close();
      audioContextRef.current = null;
    }

    setListening(false);
    setProcessing(false);
    setVisible(false);
    setFloatingText("");
    setError("");
    void window.betterSiri.dismiss();
  }, []);

  useEffect(() => {
    const unsubscribe = window.betterSiri.onSummoned(() => {
      setVisible(true);
      setFloatingText("");
      setError("");
    });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };

    window.addEventListener("keydown", onKeyDown);

    return () => {
      unsubscribe();
      window.removeEventListener("keydown", onKeyDown);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      audioAnalyserRef.current = null;

      if (audioContextRef.current) {
        void audioContextRef.current.close();
      }
    };
  }, [dismiss]);

  return (
    <main className={`orb-interface ${visible ? "visible" : ""}`}>
      <div className="orb-atmosphere" />

      <div
        className={`glass-orb ${
          listening ? "orb-listening" : ""
        } ${processing ? "orb-thinking" : ""}`}
        style={{
          "--voice-level": String(listening ? voiceLevel : 0),
          "--voice-scale": String(1 + (listening ? voiceLevel * 0.1 : 0)),
          "--voice-brightness": String(
            1 + (listening ? voiceLevel * 0.4 : 0)
          ),
        } as CSSProperties}
        onClick={() => {
          if (processing) return;

          if (listening) {
            stopListening();
          } else {
            void startListening();
          }
        }}
        role="button"
        tabIndex={0}
        aria-label="Activate betterSiri"
      >
        <div className="orb-inner">
          <div className="orb-core" />
          <div className="orb-light" />
          <div className="orb-rim" />
        </div>
      </div>

      <div className="floating-response" key={floatingText}>
        {error || floatingText}
      </div>
    </main>
  );
}

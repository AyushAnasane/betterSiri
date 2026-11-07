
import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import AssistantShader from "./AssistantShader";

type AudioRef = React.MutableRefObject<{ value: number }>;

function HaloArc({ audioLevelRef }: { audioLevelRef: AudioRef }) {
  const groupRef = useRef<THREE.Group>(null);

  const geometry = useMemo(() => {
    const curve = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(-0.85, 0.05, -0.35),
      new THREE.Vector3(0, 1.05, -0.35),
      new THREE.Vector3(0.85, 0.05, -0.35)
    );

    return new THREE.TubeGeometry(curve, 100, 0.008, 8, false);
  }, []);

  useFrame(() => {
    if (!groupRef.current) return;

    const targetScale = 1 + audioLevelRef.current.value * 0.45;

    const nextScale = THREE.MathUtils.lerp(
      groupRef.current.scale.x,
      targetScale,
      0.12
    );

    groupRef.current.scale.setScalar(nextScale);
  });

  return (
    <group ref={groupRef}>
      <mesh geometry={geometry}>
        <meshBasicMaterial color="#438dff" transparent opacity={0.8} />
      </mesh>

      <mesh geometry={geometry} scale={1.5}>
        <meshBasicMaterial color="#246bff" transparent opacity={0.12} />
      </mesh>
    </group>
  );
}

function AudioMeter({
  analyser,
  audioLevelRef,
}: {
  analyser: AnalyserNode;
  audioLevelRef: AudioRef;
}) {
  const data = useMemo(
    () => new Uint8Array(analyser.frequencyBinCount),
    [analyser]
  );

  useFrame(() => {
    analyser.getByteFrequencyData(data);

    let sum = 0;

    for (let i = 0; i < data.length; i++) {
      sum += data[i];
    }

    const average = sum / data.length / 255;
    const target = Math.min(average * 4.5, 1);

    audioLevelRef.current.value = THREE.MathUtils.lerp(
      audioLevelRef.current.value,
      target,
      0.2
    );
  });

  return null;
}

async function blobToWavBase64(blob: Blob): Promise<string> {
  const audioContext = new AudioContext();

  try {
    const arrayBuffer = await blob.arrayBuffer();
    const decoded = await audioContext.decodeAudioData(arrayBuffer);

    const sampleRate = decoded.sampleRate;
    const samples = decoded.length;
    const channels = decoded.numberOfChannels;
    const wavBuffer = new ArrayBuffer(44 + samples * 2);
    const view = new DataView(wavBuffer);

    const writeString = (offset: number, value: string) => {
      for (let i = 0; i < value.length; i++) {
        view.setUint8(offset + i, value.charCodeAt(i));
      }
    };

    writeString(0, "RIFF");
    view.setUint32(4, 36 + samples * 2, true);
    writeString(8, "WAVE");
    writeString(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, "data");
    view.setUint32(40, samples * 2, true);

    const channelData = Array.from(
      { length: channels },
      (_, channel) => decoded.getChannelData(channel)
    );

    let offset = 44;

    for (let i = 0; i < samples; i++) {
      let sample = 0;

      for (let channel = 0; channel < channels; channel++) {
        sample += channelData[channel][i] / channels;
      }

      sample = Math.max(-1, Math.min(1, sample));

      view.setInt16(
        offset,
        sample < 0 ? sample * 0x8000 : sample * 0x7fff,
        true
      );

      offset += 2;
    }

    const bytes = new Uint8Array(wavBuffer);
    let binary = "";
    const chunkSize = 0x8000;

    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(
        ...bytes.subarray(i, Math.min(i + chunkSize, bytes.length))
      );
    }

    return btoa(binary);
  } finally {
    await audioContext.close();
  }
}

export default function AssistantCore() {
  const [isListening, setIsListening] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState("");

  const audioLevelRef = useRef({ value: 0 });
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const transcribeRecording = async (blob: Blob) => {
    if (!blob.size) {
      setError("No audio captured. Try speaking again.");
      return;
    }

    try {
      setIsTranscribing(true);
      setError("");

      const wavBase64 = await blobToWavBase64(blob);
      const text = await window.betterSiri.transcribeAudio(wavBase64);

      setTranscript(text || "I couldn't detect any speech.");
    } catch (err) {
      console.error("Local transcription error:", err);

      setError(
        err instanceof Error ? err.message : "Transcription failed."
      );
    } finally {
      setIsTranscribing(false);
    }
  };

  const stopMicrophone = async () => {
    const recorder = recorderRef.current;

    if (recorder && recorder.state === "recording") {
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType,
        });

        void transcribeRecording(blob);
      };

      recorder.stop();
    }

    recorderRef.current = null;

    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    if (audioContextRef.current) {
      await audioContextRef.current.close();
      audioContextRef.current = null;
    }

    setAnalyser(null);
    audioLevelRef.current.value = 0;
    setIsListening(false);
  };

  const startMicrophone = async () => {
    try {
      setError("");
      setTranscript("");

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });

      const audioContext = new AudioContext();
      await audioContext.resume();

      const source = audioContext.createMediaStreamSource(stream);
      const analyserNode = audioContext.createAnalyser();

      analyserNode.fftSize = 512;
      analyserNode.smoothingTimeConstant = 0.75;

      source.connect(analyserNode);

      const mimeTypes = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/mp4",
      ];

      const mimeType = mimeTypes.find((type) =>
        MediaRecorder.isTypeSupported(type)
      );

      if (!mimeType) {
        throw new Error("Audio recording is not supported.");
      }

      const recorder = new MediaRecorder(stream, { mimeType });

      chunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.start(250);

      streamRef.current = stream;
      audioContextRef.current = audioContext;
      recorderRef.current = recorder;

      setAnalyser(analyserNode);
      setIsListening(true);
    } catch (err) {
      console.error("Microphone error:", err);

      streamRef.current?.getTracks().forEach((track) => track.stop());

      if (audioContextRef.current) {
        await audioContextRef.current.close();
        audioContextRef.current = null;
      }

      setError(
        err instanceof Error ? err.message : "Microphone could not start."
      );

      setIsListening(false);
    }
  };

  const toggleMicrophone = () => {
    if (isListening) {
      void stopMicrophone();
    } else if (!isTranscribing) {
      void startMicrophone();
    }
  };

  useEffect(() => {
    return () => {
      if (recorderRef.current?.state === "recording") {
        recorderRef.current.stop();
      }

      streamRef.current?.getTracks().forEach((track) => track.stop());

      if (audioContextRef.current) {
        void audioContextRef.current.close();
      }
    };
  }, []);

  return (
    <div
      className="assistant-core"
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
      }}
    >
      <Canvas
        camera={{ position: [0, 0, 5], fov: 50 }}
        gl={{ alpha: true, antialias: true }}
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
        }}
      >
        <HaloArc audioLevelRef={audioLevelRef} />

        <AssistantShader audioLevelRef={audioLevelRef} />

        {analyser && (
          <AudioMeter
            analyser={analyser}
            audioLevelRef={audioLevelRef}
          />
        )}
      </Canvas>

      <div
        style={{
          position: "absolute",
          top: "70%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: "80%",
          maxWidth: 420,
          textAlign: "center",
          color: "#dce8ff",
          zIndex: 10,
          pointerEvents: "none",
        }}
      >
        {isTranscribing ? (
          <p>Understanding...</p>
        ) : transcript ? (
          <p>{transcript}</p>
        ) : error ? (
          <p style={{ color: "#ff9999" }}>{error}</p>
        ) : null}
      </div>

      <button
        onClick={toggleMicrophone}
        disabled={isTranscribing}
        style={{
          position: "absolute",
          bottom: 24,
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 20,
          pointerEvents: "auto",
          padding: "11px 20px",
          borderRadius: 30,
          border: "1px solid rgba(120,160,255,0.3)",
          background: "rgba(15,25,50,0.8)",
          color: "#dce8ff",
          cursor: isTranscribing ? "wait" : "pointer",
          fontSize: 13,
          backdropFilter: "blur(12px)",
          opacity: isTranscribing ? 0.6 : 1,
        }}
      >
        {isListening
          ? "Stop & transcribe"
          : isTranscribing
            ? "Transcribing locally..."
            : "Start listening"}
      </button>
    </div>
  );
}

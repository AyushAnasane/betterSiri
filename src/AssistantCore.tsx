
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

    const audio = audioLevelRef.current.value;
    const targetScale = 1 + audio * 0.45;

    const currentScale = groupRef.current.scale.x;
    const nextScale = THREE.MathUtils.lerp(
      currentScale,
      targetScale,
      0.12
    );

    groupRef.current.scale.setScalar(nextScale);
  });

  return (
    <group ref={groupRef}>
      <mesh geometry={geometry}>
        <meshBasicMaterial
          color="#438dff"
          transparent
          opacity={0.8}
        />
      </mesh>

      <mesh geometry={geometry} scale={1.5}>
        <meshBasicMaterial
          color="#246bff"
          transparent
          opacity={0.12}
        />
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

export default function AssistantCore() {
  const [isListening, setIsListening] = useState(false);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);

  const audioLevelRef = useRef({ value: 0 });
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  const stopMicrophone = async () => {
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

      streamRef.current = stream;
      audioContextRef.current = audioContext;

      setAnalyser(analyserNode);
      setIsListening(true);
    } catch (error) {
      console.error("Microphone error:", error);
      await stopMicrophone();
    }
  };

  const toggleMicrophone = () => {
    if (isListening) {
      void stopMicrophone();
    } else {
      void startMicrophone();
    }
  };

  useEffect(() => {
    return () => {
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

      <button
        onClick={toggleMicrophone}
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
          cursor: "pointer",
          fontSize: 13,
          backdropFilter: "blur(12px)",
        }}
      >
        {isListening ? "Turn microphone off" : "Enable microphone"}
      </button>
    </div>
  );
}

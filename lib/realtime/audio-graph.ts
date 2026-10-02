/**
 * Audio plumbing for the Gemini Live API.
 *
 * The Live API exchanges raw 16-bit PCM at a fixed sample rate, while browsers
 * capture and play back through the Web Audio API. These helpers convert
 * between the two, so the session layer can stay free of audio detail.
 */

import { INPUT_SAMPLE_RATE } from "@/lib/gemini/config";
import {
  detectSpeechActivity,
  type SpeechActivityState,
} from "@/lib/realtime/speech-activity";

/** Base64-encode a byte buffer without blowing the call stack on long input. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Convert a Float32 sample frame ([-1,1]) into little-endian 16-bit PCM. */
export function floatTo16BitPcm(input: Float32Array): Uint8Array {
  const out = new Uint8Array(input.length * 2);
  const view = new DataView(out.buffer);
  for (let i = 0; i < input.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, input[i]));
    view.setInt16(
      i * 2,
      clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff,
      true,
    );
  }
  return out;
}

/** Convert little-endian 16-bit PCM back into Float32 samples for playback. */
export function pcm16ToFloat(input: Uint8Array): Float32Array<ArrayBuffer> {
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  const frames = Math.floor(input.byteLength / 2);
  const out = new Float32Array(new ArrayBuffer(frames * 4));
  for (let i = 0; i < frames; i += 1)
    out[i] = view.getInt16(i * 2, true) / 0x8000;
  return out;
}

/** Linear-interpolation resampler — enough for speech at these rates. */
function resample(
  input: Float32Array,
  fromRate: number,
  toRate: number,
): Float32Array {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const length = Math.round(input.length / ratio);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    const position = i * ratio;
    const lower = Math.floor(position);
    const upper = Math.min(lower + 1, input.length - 1);
    const weight = position - lower;
    out[i] = input[lower] * (1 - weight) + input[upper] * weight;
  }
  return out;
}

export type MicStreamer = {
  stop: () => void;
  /** True while audio is actually being sent (false when muted). */
  setEnabled: (enabled: boolean) => void;
};

/**
 * Frames buffered inside the worklet before one is posted upstream.
 *
 * The Web Audio render quantum is 128 frames — about 2.7 ms at 48 kHz. Posting
 * every quantum means roughly 375 individual WebSocket messages per second, each
 * carrying a 256-byte payload after base64. That is mostly overhead: it burns
 * main-thread time in the worklet message handler and in JSON/base64 encoding,
 * and the extra scheduling jitter shows up as lag between the caller and the
 * model.
 *
 * 2048 frames is about 43 ms at 48 kHz — still well under the perceptual
 * threshold for speech onset, at roughly 1/20th of the message count.
 */
const WORKLET_BLOCK_FRAMES = 2048;

/**
 * Capture microphone audio and emit 16 kHz PCM frames via `onChunk`.
 *
 * An AudioWorklet is used rather than the deprecated ScriptProcessorNode, with a
 * ScriptProcessor fallback for browsers that do not expose the worklet API.
 */
export async function startMicStreamer(
  stream: MediaStream,
  onChunk: (pcm: Uint8Array) => void,
  onLevel?: (level: number) => void,
  onActivityChange?: (active: boolean) => void,
): Promise<MicStreamer> {
  const AudioContextCtor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!AudioContextCtor) throw new Error("audio_context_unsupported");

  const context = new AudioContextCtor();
  await context.resume().catch(() => undefined);

  const source = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser();
  analyser.fftSize = 512;
  source.connect(analyser);

  let enabled = true;
  let stopped = false;
  let levelTimer: ReturnType<typeof setInterval> | undefined;
  const levelBuffer = new Uint8Array(analyser.frequencyBinCount);
  let speechState: SpeechActivityState = { active: false, lastSpeechAt: 0 };

  if (onLevel) {
    levelTimer = setInterval(() => {
      analyser.getByteTimeDomainData(levelBuffer);
      let peak = 0;
      for (let i = 0; i < levelBuffer.length; i += 1) {
        peak = Math.max(peak, Math.abs(levelBuffer[i] - 128) / 128);
      }
      onLevel(peak);

      const nextSpeechState = detectSpeechActivity({
        level: peak,
        now: Date.now(),
        active: speechState.active,
        lastSpeechAt: speechState.lastSpeechAt,
      });

      if (nextSpeechState.active !== speechState.active && onActivityChange) {
        onActivityChange(nextSpeechState.active);
      }
      speechState = nextSpeechState;
    }, 100);
  }

  const emit = (frame: Float32Array) => {
    if (stopped || !enabled) return;
    const resampled = resample(frame, context.sampleRate, INPUT_SAMPLE_RATE);
    onChunk(floatTo16BitPcm(resampled));
  };

  const workletUrl = URL.createObjectURL(
    new Blob(
      [
        `const BLOCK = ${WORKLET_BLOCK_FRAMES};
         class PCMForwarder extends AudioWorkletProcessor {
           constructor() {
             super();
             this.buffer = new Float32Array(BLOCK);
             this.filled = 0;
           }
           process(inputs) {
             const channel = inputs[0] && inputs[0][0];
             if (!channel || !channel.length) return true;
             // Accumulate render quanta into a single larger frame so the main
             // thread receives one message per ~43 ms rather than one per 2.7 ms.
             for (let i = 0; i < channel.length; i += 1) {
               this.buffer[this.filled] = channel[i];
               this.filled += 1;
               if (this.filled === BLOCK) {
                 this.port.postMessage(this.buffer.slice(0));
                 this.filled = 0;
               }
             }
             return true;
           }
         }
         registerProcessor('pcm-forwarder', PCMForwarder);`,
      ],
      { type: "application/javascript" },
    ),
  );

  let node: AudioWorkletNode | ScriptProcessorNode | undefined;
  let workletUrlUsed: string | undefined;

  try {
    await context.audioWorklet.addModule(workletUrl);
    const worklet = new AudioWorkletNode(context, "pcm-forwarder");
    worklet.port.onmessage = (event) => emit(event.data as Float32Array);
    source.connect(worklet);
    // Worklets only run when connected to a destination; keep the output silent.
    const silence = context.createGain();
    silence.gain.value = 0;
    worklet.connect(silence).connect(context.destination);
    node = worklet;
    workletUrlUsed = workletUrl;
  } catch {
    // The fallback still batches, via a larger processor buffer.
    const processor = context.createScriptProcessor(8192, 1, 1);
    processor.onaudioprocess = (event) =>
      emit(event.inputBuffer.getChannelData(0));
    source.connect(processor);
    const silence = context.createGain();
    silence.gain.value = 0;
    processor.connect(silence).connect(context.destination);
    node = processor;
  }

  return {
    setEnabled: (next: boolean) => {
      enabled = next;
    },
    stop: () => {
      stopped = true;
      if (levelTimer) clearInterval(levelTimer);
      try {
        node?.disconnect();
      } catch {
        /* already detached */
      }
      try {
        source.disconnect();
      } catch {
        /* already detached */
      }
      if (workletUrlUsed) URL.revokeObjectURL(workletUrlUsed);
      void context.close().catch(() => undefined);
    },
  };
}

/**
 * Plays back streamed 24 kHz PCM from the model, queued so chunks stay gapless.
 */
export class PcmPlayer {
  private context: AudioContext;
  private gain: GainNode;
  private compressor: DynamicsCompressorNode;
  private recordingDestination: MediaStreamAudioDestinationNode;
  private recordingInputSource: MediaStreamAudioSourceNode | null = null;
  private recordingInputGain: GainNode | null = null;
  private nextStartTime = 0;
  private sources = new Set<AudioBufferSourceNode>();

  constructor() {
    const AudioContextCtor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioContextCtor) throw new Error("audio_context_unsupported");
    this.context = new AudioContextCtor();
    this.gain = this.context.createGain();
    this.compressor = this.context.createDynamicsCompressor();
    this.compressor.threshold.value = -18;
    this.compressor.knee.value = 18;
    this.compressor.ratio.value = 2;
    this.compressor.attack.value = 0.008;
    this.compressor.release.value = 0.2;
    this.recordingDestination = this.context.createMediaStreamDestination();
    this.gain.connect(this.compressor);
    this.compressor.connect(this.context.destination);
    this.compressor.connect(this.recordingDestination);
  }

  get recordingStream(): MediaStream {
    return this.recordingDestination.stream;
  }

  connectRecordingInput(stream: MediaStream) {
    this.recordingInputSource = this.context.createMediaStreamSource(stream);
    this.recordingInputGain = this.context.createGain();
    this.recordingInputSource.connect(this.recordingInputGain);
    this.recordingInputGain.connect(this.recordingDestination);
  }

  setRecordingInputMuted(muted: boolean) {
    if (!this.recordingInputGain) return;
    this.recordingInputGain.gain.setTargetAtTime(
      muted ? 0 : 1,
      this.context.currentTime,
      0.015,
    );
  }

  /** Sample rate the server is sending; 24 kHz is the Live API default. */
  play(pcm: Uint8Array, sampleRate = 24000) {
    void this.context.resume().catch(() => undefined);
    const samples = pcm16ToFloat(pcm);
    if (!samples.length) return;

    const buffer = this.context.createBuffer(1, samples.length, sampleRate);
    buffer.copyToChannel(samples, 0);

    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.gain);

    const now = this.context.currentTime;
    /*
     * Play straight away when the queue is empty, and chain only when the
     * model is genuinely ahead of the speaker.
     *
     * A fixed lead-in on every chunk adds a constant, audible delay to the
     * start of every reply — which is exactly the "why is it so slow to answer"
     * feeling on a phone call. The small guard below covers the scheduler case
     * where the next start time has already fallen behind the audio clock.
     */
    if (this.nextStartTime < now) this.nextStartTime = now + 0.012;
    source.start(this.nextStartTime);
    this.nextStartTime += buffer.duration;

    this.sources.add(source);
    source.onended = () => this.sources.delete(source);
  }

  /** Stop everything immediately — used when the caller interrupts. */
  flush() {
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {
        /* already stopped */
      }
    }
    this.sources.clear();
    this.nextStartTime = 0;
  }

  setMuted(muted: boolean) {
    this.gain.gain.value = muted ? 0 : 1;
  }

  close() {
    this.flush();
    try {
      this.recordingInputSource?.disconnect();
      this.recordingInputGain?.disconnect();
    } catch {
      /* already detached */
    }
    this.recordingDestination.stream
      .getTracks()
      .forEach((track) => track.stop());
    void this.context.close().catch(() => undefined);
  }
}

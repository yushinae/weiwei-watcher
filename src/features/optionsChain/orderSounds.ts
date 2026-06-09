type WebAudioWindow = Window & {
  webkitAudioContext?: typeof AudioContext;
};

let audioCtx: AudioContext | null = null;

function getAudioCtx() {
  if (typeof window === 'undefined') return null;
  const AudioCtx = window.AudioContext || (window as WebAudioWindow).webkitAudioContext;
  if (!AudioCtx) return null;
  if (!audioCtx) audioCtx = new AudioCtx();
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

function playTone(freqs: number[], durations: number[], type: OscillatorType = 'sine', vol = 0.15) {
  try {
    const ctx = getAudioCtx();
    if (!ctx) return;
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    gain.gain.value = vol;
    let t = ctx.currentTime;
    freqs.forEach((f, i) => {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = f;
      osc.connect(gain);
      osc.start(t);
      osc.stop(t + durations[i]);
      t += durations[i] + 0.02;
    });
    gain.gain.setValueAtTime(vol, t - 0.05);
    gain.gain.linearRampToValueAtTime(0, t + 0.1);
  } catch {
    // Browser audio can be unavailable before user interaction; fail quietly.
  }
}

export function soundOrderPlaced() {
  playTone([523, 659], [0.08, 0.12], 'sine', 0.12);
}

export function soundOrderFilled() {
  playTone([659, 784, 1047], [0.08, 0.08, 0.16], 'sine', 0.18);
}

export function soundOrderCancelled() {
  playTone([440, 330], [0.1, 0.15], 'triangle', 0.1);
}

export function soundOrderError() {
  playTone([300, 200], [0.12, 0.2], 'sawtooth', 0.08);
}

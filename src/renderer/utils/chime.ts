// A soft two-note chime synthesised on the fly, so no audio file ships with the app.
let ctx: AudioContext | null = null;

const getContext = (): AudioContext | null => {
  if (ctx) {
    return ctx;
  }
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) {
    return null;
  }
  ctx = new Ctor();
  return ctx;
};

// Webviews only allow audio after a user gesture; call this from one.
export const primeAudio = (): void => {
  const audio = getContext();
  if (audio && audio.state === 'suspended') {
    audio.resume().catch(() => undefined);
  }
};

export const playChime = (): void => {
  const audio = getContext();
  if (!audio) {
    return;
  }
  const start = audio.currentTime + 0.02;
  [659.25, 880].forEach((frequency, index) => {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = 'sine';
    osc.frequency.value = frequency;
    const t = start + index * 0.18;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.18, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    osc.connect(gain).connect(audio.destination);
    osc.start(t);
    osc.stop(t + 0.95);
  });
};

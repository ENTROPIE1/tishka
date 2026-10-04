import { computeThreshold, measureNoise, measureSpeech, MIN_LOUD_FRAMES, MIN_THRESHOLD } from '../../voice/calibration';
import { encodeWav, normalizePeak, resample } from '../../voice/wav';
import { rms, trimByThreshold, type Frame } from './calibration-recording';
import {
  DISPLAY_SCALE,
  GOOD_MESSAGE,
  NOISE_MS,
  NOISE_SKIP_MS,
  NOISY_MESSAGE,
  NO_SPEECH_MESSAGE,
  SPEECH_GUARD,
  SPEECH_MAX_MS,
  SPEECH_SILENCE_MS,
  TARGET_RATE,
  WEAK_MESSAGE,
  type CalibrationDeps,
  type CalibrationFlow,
  type CalibrationOutcome,
  type CalibrationState,
  type CalibrationStep
} from './calibration-types';

export * from './calibration-types';
function display(level: number): number {
  return Math.max(0, Math.min(1, level / DISPLAY_SCALE));
}

export function createCalibrationFlow(deps: CalibrationDeps): CalibrationFlow {
  let active = false;
  let finished = false;
  let step: CalibrationStep = 'idle';
  let level = 0;
  let outcome: CalibrationOutcome | undefined;
  let openedAt = 0;
  let speechStartAt = 0;
  let lastLoudAt = 0;
  let hasLoud = false;
  let noisePeak = 0;
  let sourceRate = TARGET_RATE;
  const noiseLevels: number[] = [];
  const speechFrames: Frame[] = [];

  function snapshot(): CalibrationState {
    const current: CalibrationState = { step, level, secondsLeft: 0 };
    if (outcome !== undefined) {
      current.outcome = outcome;
    }
    return current;
  }

  function emit(): void {
    deps.onUpdate(snapshot());
  }

  function speechGuard(): number {
    return Math.max(noisePeak * SPEECH_GUARD, MIN_THRESHOLD);
  }

  function startSpeech(at: number): void {
    step = 'speech';
    speechStartAt = at;
    lastLoudAt = at;
    hasLoud = false;
    noisePeak = measureNoise(noiseLevels).peak;
    speechFrames.length = 0;
  }

  async function finish(): Promise<void> {
    if (finished) {
      return;
    }
    finished = true;
    deps.mic.stop();
    const noiseStats = measureNoise(noiseLevels);
    const speechStats = measureSpeech(
      speechFrames.map((item) => item.level),
      noiseStats.peak
    );
    const info = computeThreshold(noiseStats.peak, speechStats.speech, speechStats.loudFrames);

    let quality = info.quality;
    let message = quality === 'good' ? GOOD_MESSAGE : quality === 'weak' ? WEAK_MESSAGE : NOISY_MESSAGE;
    let threshold: number | null = info.threshold;
    let recognized = '';

    if (speechStats.loudFrames < MIN_LOUD_FRAMES) {
      quality = 'bad';
      message = NO_SPEECH_MESSAGE;
      threshold = null;
    } else {
      const trimmed = trimByThreshold(speechFrames, info.threshold);
      const wav = encodeWav(resample(normalizePeak(trimmed), sourceRate, TARGET_RATE), TARGET_RATE);
      const result = await deps.transcribe(wav);
      recognized = result.ok ? result.text : '';
      if (recognized === '' && quality === 'good') {
        quality = 'weak';
        message = WEAK_MESSAGE;
      }
    }

    if (quality === 'bad') {
      threshold = null;
    }
    outcome = { quality, message, recognized, threshold, noise: noiseStats.peak, speech: speechStats.speech };
    step = 'result';
    level = 0;
    emit();
  }

  function handleFrame(frame: Float32Array, sampleRate: number): void {
    if (!active || step === 'result' || finished) {
      return;
    }
    sourceRate = sampleRate;
    const value = rms(frame);
    level = display(value);
    const at = deps.now();
    if (step === 'noise') {
      if (at - openedAt >= NOISE_SKIP_MS) {
        noiseLevels.push(value);
      }
      if (at - openedAt >= NOISE_MS) {
        startSpeech(at);
      }
      emit();
      return;
    }
    speechFrames.push({ samples: new Float32Array(frame), level: value });
    if (value > speechGuard()) {
      hasLoud = true;
      lastLoudAt = at;
    }
    emit();
    if ((hasLoud && at - lastLoudAt >= SPEECH_SILENCE_MS) || at - speechStartAt >= SPEECH_MAX_MS) {
      void finish();
    }
  }

  async function start(): Promise<void> {
    if (active) {
      return;
    }
    active = true;
    finished = false;
    step = 'noise';
    level = 0;
    outcome = undefined;
    noiseLevels.length = 0;
    speechFrames.length = 0;
    hasLoud = false;
    deps.onPause?.();
    openedAt = deps.now();
    emit();
    const ok = await deps.mic.start(handleFrame);
    if (!ok && active) {
      active = false;
      deps.onResume?.();
      deps.onUpdate({ step: 'idle', level: 0, secondsLeft: 0 });
    }
  }

  function release(): void {
    deps.mic.stop();
    active = false;
    finished = false;
    deps.onResume?.();
  }

  return {
    start,
    cancel(): void {
      if (!active) {
        return;
      }
      release();
      step = 'idle';
      level = 0;
      outcome = undefined;
      emit();
    },
    async save(): Promise<void> {
      const saved = outcome;
      release();
      step = 'idle';
      level = 0;
      outcome = undefined;
      emit();
      if (saved !== undefined && saved.threshold !== null) {
        await deps.save({
          threshold: saved.threshold,
          noise: saved.noise,
          speech: saved.speech,
          calibratedAt: new Date(deps.now()).toISOString()
        });
      }
    },
    isActive: () => active,
    state: snapshot
  };
}

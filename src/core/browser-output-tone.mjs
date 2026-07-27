import { AsyncResourceSlot } from './async-resource-slot.mjs';

export class OutputToneError extends Error {
  constructor(code, cause) {
    super(`output-tone:${code}`, { cause });
    this.name = 'OutputToneError';
    this.code = code;
  }
}

async function disposeOutputTone(resource, clearTimeoutFn) {
  if (resource.timer !== null) {
    clearTimeoutFn(resource.timer);
  }
  if (resource.oscillator !== null) {
    if (resource.oscillatorStarted) {
      resource.oscillator.stop();
    }
    resource.oscillator.disconnect();
  }
  if (resource.gain !== null) {
    resource.gain.disconnect();
  }
  resource.target.pause();
  resource.target.srcObject = null;
  if (resource.context !== null) {
    await resource.context.close();
  }
}

export class BrowserOutputTone {
  #clearTimeoutFn;
  #createAudioContext;
  #durationMs;
  #frequencyHz;
  #gainValue;
  #setTimeoutFn;
  #slot;
  #target;

  constructor({
    target,
    createAudioContext,
    setTimeoutFn,
    clearTimeoutFn,
    durationMs,
    frequencyHz,
    gainValue,
  }) {
    this.#target = target;
    this.#createAudioContext = createAudioContext;
    this.#setTimeoutFn = setTimeoutFn;
    this.#clearTimeoutFn = clearTimeoutFn;
    this.#durationMs = durationMs;
    this.#frequencyHz = frequencyHz;
    this.#gainValue = gainValue;
    this.#slot = new AsyncResourceSlot((resource) =>
      disposeOutputTone(resource, this.#clearTimeoutFn),
    );
  }

  get active() {
    return this.#slot.active;
  }

  start() {
    return this.#slot.start(async () => {
      const resource = {
        target: this.#target,
        context: null,
        oscillator: null,
        oscillatorStarted: false,
        gain: null,
        destination: null,
        timer: null,
      };

      try {
        resource.context = this.#createAudioContext();
        resource.oscillator = resource.context.createOscillator();
        resource.gain = resource.context.createGain();
        resource.destination = resource.context.createMediaStreamDestination();
        resource.oscillator.frequency.value = this.#frequencyHz;
        resource.gain.gain.value = this.#gainValue;
        resource.oscillator.connect(resource.gain);
        resource.gain.connect(resource.destination);
        resource.target.srcObject = resource.destination.stream;
        try {
          await resource.target.play();
        } catch (error) {
          throw new OutputToneError('playback-failed', error);
        }
        resource.oscillator.start();
        resource.oscillatorStarted = true;
        resource.timer = this.#setTimeoutFn(() => this.stop(), this.#durationMs);
        return resource;
      } catch (error) {
        await disposeOutputTone(resource, this.#clearTimeoutFn);
        if (error instanceof OutputToneError) {
          throw error;
        }
        throw new OutputToneError('initialization-failed', error);
      }
    });
  }

  stop() {
    return this.#slot.stop();
  }
}

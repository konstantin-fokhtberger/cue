import { AsyncResourceSlot } from './async-resource-slot.mjs';

export class PcmCaptureStartError extends Error {
  constructor(channel, code, cause) {
    super(`${channel}:${code}`, cause === undefined ? undefined : { cause });
    this.name = 'PcmCaptureStartError';
    this.channel = channel;
    this.code = code;
  }
}

function captureStartError(channel, error) {
  if (error instanceof PcmCaptureStartError) {
    return error;
  }
  let code = 'initialization-failed';
  if (error && error.name === 'NotAllowedError') {
    code = 'permission-denied';
  } else if (error && (error.name === 'NotFoundError' || error.name === 'OverconstrainedError')) {
    code = 'device-unavailable';
  }
  return new PcmCaptureStartError(channel, code, error);
}

async function disposePcmResource(resource) {
  if (resource.processor !== null) {
    resource.processor.port.onmessage = null;
    resource.processor.disconnect();
  }
  if (resource.source !== null) {
    resource.source.disconnect();
  }
  if (resource.sink !== null) {
    resource.sink.disconnect();
  }
  if (resource.context !== null) {
    await resource.context.close();
  }
  if (resource.stream !== null) {
    resource.stream.getTracks().forEach((track) => track.stop());
  }
}

export class BrowserPcmCapture {
  #channel;
  #createAudioContext;
  #createMediaStream;
  #createWorkletNode;
  #onStarted;
  #onPcm;
  #openStream;
  #processorModuleUrl;
  #processorName;
  #slot;

  constructor({
    channel,
    openStream,
    createAudioContext,
    createMediaStream,
    createWorkletNode,
    processorModuleUrl,
    processorName,
    onStarted,
    onPcm,
  }) {
    this.#channel = channel;
    this.#openStream = openStream;
    this.#createAudioContext = createAudioContext;
    this.#createMediaStream = createMediaStream;
    this.#createWorkletNode = createWorkletNode;
    this.#processorModuleUrl = processorModuleUrl;
    this.#processorName = processorName;
    this.#onStarted = onStarted;
    this.#onPcm = onPcm;
    this.#slot = new AsyncResourceSlot(disposePcmResource);
  }

  get active() {
    return this.#slot.active;
  }

  start() {
    return this.#slot.start(async () => {
      const resource = {
        stream: null,
        context: null,
        source: null,
        processor: null,
        sink: null,
      };

      try {
        resource.stream = await this.#openStream();
        const tracks = resource.stream.getAudioTracks();
        if (tracks.length === 0) {
          throw new PcmCaptureStartError(this.#channel, 'no-audio-track');
        }

        resource.context = this.#createAudioContext();
        await resource.context.audioWorklet.addModule(this.#processorModuleUrl);
        const selectedStream = this.#createMediaStream(tracks);
        resource.source = resource.context.createMediaStreamSource(selectedStream);
        resource.processor = this.#createWorkletNode(resource.context, this.#processorName);
        resource.processor.port.onmessage = (event) => this.#onPcm(event.data);
        resource.sink = resource.context.createGain();
        resource.sink.gain.value = 0;
        resource.source.connect(resource.processor);
        resource.processor.connect(resource.sink);
        resource.sink.connect(resource.context.destination);
        this.#onStarted();
        return resource;
      } catch (error) {
        await disposePcmResource(resource);
        throw captureStartError(this.#channel, error);
      }
    });
  }

  stop() {
    return this.#slot.stop();
  }
}

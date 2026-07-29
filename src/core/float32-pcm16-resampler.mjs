export class Float32Pcm16Resampler {
  #byteRemainder = Buffer.alloc(0);
  #inputSampleRate;
  #outputSampleRate;
  #phase = 0;

  constructor({ inputSampleRate, outputSampleRate = 16_000 }) {
    if (
      !Number.isFinite(inputSampleRate) ||
      !Number.isFinite(outputSampleRate) ||
      outputSampleRate <= 0 ||
      outputSampleRate > inputSampleRate
    ) {
      throw new RangeError('Expected finite sample rates with 0 < output <= input.');
    }
    this.#inputSampleRate = inputSampleRate;
    this.#outputSampleRate = outputSampleRate;
  }

  push(chunk) {
    const bytes = this.#byteRemainder.length ? Buffer.concat([this.#byteRemainder, chunk]) : chunk;
    const completeByteLength = bytes.length - (bytes.length % Float32Array.BYTES_PER_ELEMENT);
    this.#byteRemainder = Buffer.from(bytes.subarray(completeByteLength));
    const output = [];

    for (let offset = 0; offset < completeByteLength; offset += 4) {
      const sample = bytes.readFloatLE(offset);
      this.#phase += this.#outputSampleRate;
      if (this.#phase >= this.#inputSampleRate) {
        this.#phase -= this.#inputSampleRate;
        output.push(toPcm16(sample));
      }
    }

    const pcm = Buffer.allocUnsafe(output.length * Int16Array.BYTES_PER_ELEMENT);
    output.forEach((sample, index) => pcm.writeInt16LE(sample, index * 2));
    return pcm;
  }

  reset() {
    this.#byteRemainder = Buffer.alloc(0);
    this.#phase = 0;
  }
}

function toPcm16(sample) {
  if (!Number.isFinite(sample)) {
    return 0;
  }
  // Stryker disable next-line ConditionalExpression,EqualityOperator: zero maps to zero on both mathematically equivalent branches.
  const scaled = sample < 0 ? Math.max(-1, sample) * 32768 : Math.min(1, sample) * 32767;
  return Math.round(scaled);
}

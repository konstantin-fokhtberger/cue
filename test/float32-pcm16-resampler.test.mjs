import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { Float32Pcm16Resampler } from '../src/core/float32-pcm16-resampler.mjs';

function floatBuffer(samples) {
  const buffer = Buffer.alloc(samples.length * Float32Array.BYTES_PER_ELEMENT);
  samples.forEach((sample, index) => buffer.writeFloatLE(sample, index * 4));
  return buffer;
}

describe('Float32Pcm16Resampler', () => {
  it.each([
    [0, 16_000],
    [-1, 16_000],
    [Number.NaN, 16_000],
    [48_000, 0],
    [16_000, 48_000],
  ])('rejects unsupported sample-rate pair %s -> %s', (inputSampleRate, outputSampleRate) => {
    expect(() => new Float32Pcm16Resampler({ inputSampleRate, outputSampleRate })).toThrow(
      new RangeError('Expected finite sample rates with 0 < output <= input.'),
    );
  });

  it('converts bounded Float32 mono samples to exact signed PCM16', () => {
    const resampler = new Float32Pcm16Resampler({
      inputSampleRate: 48_000,
      outputSampleRate: 16_000,
    });

    const output = resampler.push(floatBuffer([0.2, 0.4, -1, 0.1, 0.2, 1, 0, 0, 2]));

    expect([...new Int16Array(output.buffer, output.byteOffset, output.length / 2)]).toEqual([
      -32768, 32767, 32767,
    ]);
  });

  it('converts non-finite helper samples to silence', () => {
    const resampler = new Float32Pcm16Resampler({
      inputSampleRate: 16_000,
      outputSampleRate: 16_000,
    });

    const output = resampler.push(floatBuffer([Number.NaN, Number.POSITIVE_INFINITY]));

    expect([...new Int16Array(output.buffer, output.byteOffset, output.length / 2)]).toEqual([
      0, 0,
    ]);
  });

  it('clamps negative samples below minus one before PCM conversion', () => {
    const resampler = new Float32Pcm16Resampler({
      inputSampleRate: 16_000,
      outputSampleRate: 16_000,
    });

    const output = resampler.push(floatBuffer([-2]));

    expect(output.readInt16LE(0)).toBe(-32_768);
  });

  it('preserves partial Float32 bytes and phase across arbitrary pipe chunks', () => {
    const samples = [0.1, 0.2, 0.3, -0.4, -0.5, -0.6, 0.7, 0.8, 0.9];
    const input = floatBuffer(samples);
    const complete = new Float32Pcm16Resampler({
      inputSampleRate: 48_000,
      outputSampleRate: 16_000,
    }).push(input);
    const chunked = new Float32Pcm16Resampler({
      inputSampleRate: 48_000,
      outputSampleRate: 16_000,
    });

    const output = Buffer.concat([
      chunked.push(input.subarray(0, 3)),
      chunked.push(input.subarray(3, 17)),
      chunked.push(input.subarray(17, 29)),
      chunked.push(input.subarray(29)),
    ]);

    expect(output).toEqual(complete);
  });

  it('resets buffered bytes and rate phase for a new helper generation', () => {
    const resampler = new Float32Pcm16Resampler({
      inputSampleRate: 44_100,
      outputSampleRate: 16_000,
    });
    const input = floatBuffer([0.1, 0.2, 0.3, 0.4, 0.5, 0.6]);

    resampler.push(input.subarray(0, 7));
    resampler.reset();

    expect(resampler.push(input)).toEqual(
      new Float32Pcm16Resampler({
        inputSampleRate: 44_100,
        outputSampleRate: 16_000,
      }).push(input),
    );
  });

  it('matches the exact output-length model across generated chunks', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 16_000, max: 192_000 }),
        fc.array(fc.float({ min: -2, max: 2, noNaN: true }), { maxLength: 500 }),
        (inputSampleRate, samples) => {
          const resampler = new Float32Pcm16Resampler({
            inputSampleRate,
            outputSampleRate: 16_000,
          });
          const output = resampler.push(floatBuffer(samples));

          expect(output.length / 2).toBe(Math.floor((samples.length * 16_000) / inputSampleRate));
        },
      ),
      { numRuns: 200 },
    );
  });
});

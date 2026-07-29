import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import boundedPcmBuffer from '../src/core/bounded-pcm-buffer.js';

const { BoundedPcmBuffer } = boundedPcmBuffer;

describe('BoundedPcmBuffer', () => {
  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid byte limit %s',
    (maxBytes) => {
      expect(() => new BoundedPcmBuffer(maxBytes)).toThrow(
        new TypeError('maxBytes must be a positive integer'),
      );
    },
  );

  it('accepts only Buffer chunks', () => {
    const buffer = new BoundedPcmBuffer(4);

    expect(() => buffer.push(new Uint8Array([1]))).toThrow(new TypeError('chunk must be a Buffer'));
  });

  it('owns an input copy and drains data in arrival order', () => {
    const buffer = new BoundedPcmBuffer(8);
    const first = Buffer.from([1, 2]);

    expect(buffer.push(first)).toEqual({ byteLength: 2, droppedBytes: 0 });
    first[0] = 9;
    expect(buffer.push(Buffer.from([3, 4]))).toEqual({ byteLength: 4, droppedBytes: 0 });

    expect(buffer.drain()).toEqual(Buffer.from([1, 2, 3, 4]));
    expect(buffer.byteLength).toBe(0);
    expect(buffer.drain()).toEqual(Buffer.alloc(0));
  });

  it('retains the newest bytes and reports exact overflow metrics', () => {
    const buffer = new BoundedPcmBuffer(5);

    expect(buffer.push(Buffer.from([1, 2, 3]))).toEqual({
      byteLength: 3,
      droppedBytes: 0,
    });
    expect(buffer.push(Buffer.from([4, 5, 6, 7]))).toEqual({
      byteLength: 5,
      droppedBytes: 2,
    });
    expect(buffer.push(Buffer.from([8, 9, 10, 11, 12, 13]))).toEqual({
      byteLength: 5,
      droppedBytes: 6,
    });

    expect(buffer.byteLength).toBe(5);
    expect(buffer.totalDroppedBytes).toBe(8);
    expect(buffer.overflowCount).toBe(2);
    expect(buffer.drain()).toEqual(Buffer.from([9, 10, 11, 12, 13]));
  });

  it('clears buffered audio without resetting cumulative overflow metrics', () => {
    const buffer = new BoundedPcmBuffer(2);
    buffer.push(Buffer.from([1, 2, 3]));

    buffer.clear();

    expect(buffer.byteLength).toBe(0);
    expect(buffer.totalDroppedBytes).toBe(1);
    expect(buffer.overflowCount).toBe(1);
    expect(buffer.drain()).toEqual(Buffer.alloc(0));
  });

  it('matches a newest-byte reference model for arbitrary PCM chunks', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 256 }),
        fc.array(fc.uint8Array({ maxLength: 512 }), { maxLength: 100 }),
        (maxBytes, chunks) => {
          const buffer = new BoundedPcmBuffer(maxBytes);
          let model = Buffer.alloc(0);
          let expectedDroppedBytes = 0;
          let expectedOverflowCount = 0;

          for (const values of chunks) {
            const chunk = Buffer.from(values);
            model = Buffer.concat([model, chunk]);
            const overflow = Math.max(0, model.length - maxBytes);
            if (overflow > 0) {
              model = model.subarray(overflow);
              expectedDroppedBytes += overflow;
              expectedOverflowCount += 1;
            }

            const result = buffer.push(chunk);
            expect(result).toEqual({
              byteLength: model.length,
              droppedBytes: overflow,
            });
            expect(buffer.byteLength).toBeLessThanOrEqual(maxBytes);
          }

          expect(buffer.totalDroppedBytes).toBe(expectedDroppedBytes);
          expect(buffer.overflowCount).toBe(expectedOverflowCount);
          expect(buffer.drain()).toEqual(model);
          expect(buffer.byteLength).toBe(0);
        },
      ),
      { numRuns: 500 },
    );
  });
});

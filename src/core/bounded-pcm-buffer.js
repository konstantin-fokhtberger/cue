'use strict';

class BoundedPcmBuffer {
  #byteLength = 0;
  #chunks = [];
  #maxBytes;
  #overflowCount = 0;
  #totalDroppedBytes = 0;

  constructor(maxBytes) {
    if (!Number.isInteger(maxBytes) || maxBytes <= 0) {
      throw new TypeError('maxBytes must be a positive integer');
    }
    this.#maxBytes = maxBytes;
  }

  get byteLength() {
    return this.#byteLength;
  }

  get totalDroppedBytes() {
    return this.#totalDroppedBytes;
  }

  get overflowCount() {
    return this.#overflowCount;
  }

  push(chunk) {
    if (!Buffer.isBuffer(chunk)) {
      throw new TypeError('chunk must be a Buffer');
    }

    const ownedChunk = Buffer.from(chunk);
    this.#chunks.push(ownedChunk);
    this.#byteLength += ownedChunk.length;

    const droppedBytes = Math.max(0, this.#byteLength - this.#maxBytes);
    if (droppedBytes > 0) {
      this.#dropOldest(droppedBytes);
      this.#totalDroppedBytes += droppedBytes;
      this.#overflowCount += 1;
    }

    return {
      byteLength: this.#byteLength,
      droppedBytes,
    };
  }

  drain() {
    const pcm = Buffer.concat(this.#chunks, this.#byteLength);
    this.#chunks = [];
    this.#byteLength = 0;
    return pcm;
  }

  clear() {
    this.#chunks = [];
    this.#byteLength = 0;
  }

  #dropOldest(byteCount) {
    const retained = Buffer.concat(this.#chunks, this.#byteLength).subarray(byteCount);
    this.#chunks = [retained];
    this.#byteLength -= byteCount;
  }
}

module.exports = { BoundedPcmBuffer };

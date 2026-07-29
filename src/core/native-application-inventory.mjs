import { spawn as nodeSpawn } from 'node:child_process';

import { validateApplicationInventory } from './application-capture-scope.mjs';
import { encodeHelperInventoryRequest } from './helper-control-protocol.mjs';

export class NativeApplicationInventoryError extends Error {
  constructor(code) {
    super(code);
    this.name = 'NativeApplicationInventoryError';
    this.code = code;
  }
}

export class NativeApplicationInventory {
  #active = false;
  #clearTimeout;
  #helperPath;
  #maximumEventBytes;
  #setTimeout;
  #spawn;
  #timeoutMs;

  constructor({
    helperPath,
    spawn = nodeSpawn,
    maximumEventBytes = 65_536,
    timeoutMs = 3_000,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
  }) {
    this.#helperPath = helperPath;
    this.#spawn = spawn;
    this.#maximumEventBytes = maximumEventBytes;
    this.#timeoutMs = timeoutMs;
    this.#setTimeout = setTimeoutFn;
    this.#clearTimeout = clearTimeoutFn;
  }

  refresh(generation) {
    let controlMessage;
    try {
      controlMessage = encodeHelperInventoryRequest(generation);
    } catch {
      return Promise.reject(new NativeApplicationInventoryError('invalid-inventory-generation'));
    }
    if (this.#active) {
      return Promise.reject(new NativeApplicationInventoryError('inventory-refresh-active'));
    }
    this.#active = true;

    const child = this.#spawn(this.#helperPath, [], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stderr = Buffer.alloc(0);
    let receivedStdout = false;
    let settled = false;
    let timeout;

    return new Promise((resolve, reject) => {
      const finish = (error, inventory, terminate) => {
        if (settled) return;
        settled = true;
        this.#active = false;
        this.#clearTimeout(timeout);
        child.stdin.removeAllListeners();
        child.stdin.on('error', ignoreDetachedStreamError);
        child.stdout.removeAllListeners();
        child.stderr.removeAllListeners();
        child.removeAllListeners();
        if (terminate) child.kill('SIGTERM');
        if (error) reject(new NativeApplicationInventoryError(error));
        else resolve(inventory);
      };

      child.stdin.on('error', () => finish('helper-control-failed', null, true));
      child.stdout.on('data', () => {
        receivedStdout = true;
      });
      child.stderr.on('data', (chunk) => {
        stderr = Buffer.concat([stderr, chunk]);
        if (stderr.length > this.#maximumEventBytes) {
          finish('helper-inventory-overflow', null, true);
        }
      });
      child.on('error', () => finish('helper-spawn-failed', null, false));
      child.on('exit', (code) => {
        if (code !== 0) {
          finish('helper-exited', null, false);
          return;
        }
        if (receivedStdout) {
          finish('unexpected-helper-audio', null, false);
          return;
        }
        const text = stderr.toString('utf8');
        const newline = text.indexOf('\n');
        if (newline !== text.length - 1) {
          finish('invalid-helper-inventory', null, false);
          return;
        }
        try {
          const event = JSON.parse(text);
          if (event.event === 'error') {
            finish('helper-error', null, false);
            return;
          }
          finish(null, validateApplicationInventory(event, generation), false);
        } catch {
          finish('invalid-helper-inventory', null, false);
        }
      });
      timeout = this.#setTimeout(
        () => finish('helper-inventory-timeout', null, true),
        this.#timeoutMs,
      );
      try {
        child.stdin.end(controlMessage);
      } catch {
        finish('helper-control-failed', null, true);
      }
    });
  }
}

function ignoreDetachedStreamError() {}

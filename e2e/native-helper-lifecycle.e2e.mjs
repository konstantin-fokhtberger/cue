import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packagedHelper = path.join(
  repositoryRoot,
  'dist',
  'mac-arm64',
  'cue.app',
  'Contents',
  'Resources',
  'native',
  'cue-audio-tap-helper',
);
const sourceHelper = path.join(repositoryRoot, 'build', 'native', 'cue-audio-tap-helper');

function isRunning(processID) {
  try {
    process.kill(processID, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
}

async function waitForExit(processID, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isRunning(processID)) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const processState = execFileSync(
    '/bin/ps',
    ['-o', 'pid=,ppid=,state=,command=', '-p', String(processID)],
    { encoding: 'utf8' },
  ).trim();
  throw new Error(`Timed out waiting for process ${processID} to exit; state=${processState}.`);
}

function terminate(processID) {
  if (!processID || !isRunning(processID)) return;
  process.kill(processID, 'SIGKILL');
}

function parentProcessID(processID) {
  return Number(
    execFileSync('/bin/ps', ['-o', 'ppid=', '-p', String(processID)], {
      encoding: 'utf8',
    }).trim(),
  );
}

function launchOwner(helperPath) {
  const ownerScript = String.raw`
const { spawn } = require('node:child_process');
const helper = spawn(process.argv[1], [], { stdio: ['pipe', 'ignore', 'ignore'] });
helper.once('error', (error) => process.send({ error: error.message }));
helper.once('spawn', () => {
  const writerFD = helper.stdin._handle.fd;
  const keeper = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    stdio: ['ignore', 'ignore', 'ignore', writerFD],
  });
  keeper.once('error', (error) => process.send({ error: error.message }));
  keeper.once('spawn', () => {
    process.send({ helperPID: helper.pid, keeperPID: keeper.pid });
  });
});
setInterval(() => {}, 1000);
`;
  return spawn(process.execPath, ['-e', ownerScript, helperPath], {
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
}

function waitForOwnerMessage(owner) {
  return new Promise((resolve, reject) => {
    let stderr = '';
    owner.stderr.setEncoding('utf8');
    owner.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    owner.once('message', (message) => {
      if (message.error) {
        reject(new Error(message.error));
        return;
      }
      resolve(message);
    });
    owner.once('exit', (code, signal) => {
      reject(
        new Error(
          `Owner exited before reporting child processes: code=${code}, signal=${signal}, stderr=${stderr}`,
        ),
      );
    });
  });
}

test(
  'E2E-HELPER-INHERITED-PIPE-001 exits the Swift helper while another process retains stdin',
  { skip: process.platform !== 'darwin', timeout: 10_000 },
  async () => {
    const helperPath = process.env.CUE_E2E_PACKAGED === '1' ? packagedHelper : sourceHelper;
    const owner = launchOwner(helperPath);
    let helperPID;
    let keeperPID;
    try {
      ({ helperPID, keeperPID } = await waitForOwnerMessage(owner));
      assert.equal(isRunning(helperPID), true);
      assert.equal(isRunning(keeperPID), true);
      assert.equal(parentProcessID(helperPID), owner.pid);
      await new Promise((resolve) => setTimeout(resolve, 250));
      assert.equal(parentProcessID(helperPID), owner.pid);

      const ownerExit = new Promise((resolve) => owner.once('exit', resolve));
      assert.equal(owner.kill('SIGKILL'), true);
      await ownerExit;
      await waitForExit(helperPID);

      assert.equal(isRunning(keeperPID), true);
    } finally {
      terminate(helperPID);
      terminate(keeperPID);
      if (owner.exitCode === null && owner.signalCode === null) owner.kill('SIGKILL');
    }
  },
);

import { execFile } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(projectRoot, 'native', 'audio-tap-helper', 'main.swift');
const infoPlist = path.join(projectRoot, 'native', 'audio-tap-helper', 'Info.plist');
const outputDirectory = path.join(projectRoot, 'build', 'native');
const output = path.join(outputDirectory, 'cue-audio-tap-helper');

if (process.platform !== 'darwin') {
  throw new Error('The CoreAudio Tap helper can only be built on macOS.');
}

await mkdir(outputDirectory, { recursive: true });
await execute('/usr/bin/xcrun', [
  'swiftc',
  source,
  '-framework',
  'CoreAudio',
  '-framework',
  'Foundation',
  '-O',
  '-o',
  output,
  '-Xlinker',
  '-sectcreate',
  '-Xlinker',
  '__TEXT',
  '-Xlinker',
  '__info_plist',
  '-Xlinker',
  infoPlist,
]);

process.stdout.write(`${output}\n`);

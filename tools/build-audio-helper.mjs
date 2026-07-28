import { execFile } from 'node:child_process';
import { access, chmod, copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageDirectory = path.join(projectRoot, 'native', 'audio-tap-helper');
const outputDirectory = path.join(projectRoot, 'build', 'native');
const output = path.join(outputDirectory, 'cue-audio-tap-helper');

if (process.platform !== 'darwin') {
  throw new Error('The CoreAudio Tap helper can only be built on macOS.');
}

const xcodeDeveloperDirectory = '/Applications/Xcode.app/Contents/Developer';
let developerDirectory = process.env.DEVELOPER_DIR;
if (!developerDirectory) {
  try {
    await access(xcodeDeveloperDirectory);
    developerDirectory = xcodeDeveloperDirectory;
  } catch {
    developerDirectory = undefined;
  }
}
const environment = developerDirectory
  ? { ...process.env, DEVELOPER_DIR: developerDirectory }
  : process.env;

await mkdir(outputDirectory, { recursive: true });
await execute(
  '/usr/bin/xcrun',
  ['swift', 'build', '--package-path', packageDirectory, '--configuration', 'release'],
  { env: environment, maxBuffer: 20 * 1024 * 1024 },
);
const { stdout: binaryDirectoryOutput } = await execute(
  '/usr/bin/xcrun',
  [
    'swift',
    'build',
    '--package-path',
    packageDirectory,
    '--configuration',
    'release',
    '--show-bin-path',
  ],
  { env: environment },
);
const builtBinary = path.join(binaryDirectoryOutput.trim(), 'cue-audio-tap-helper');
await copyFile(builtBinary, output);
await chmod(output, 0o755);

process.stdout.write(`${output}\n`);

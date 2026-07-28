import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { swiftEnvironment } from './swift-helper-toolchain.mjs';

const execute = promisify(execFile);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageDirectory = path.join(projectRoot, 'native', 'audio-tap-helper');
const environment = await swiftEnvironment();
const executionOptions = {
  env: environment,
  maxBuffer: 30 * 1024 * 1024,
};

await execute(
  '/usr/bin/xcrun',
  [
    'swift-format',
    'lint',
    '--strict',
    '--recursive',
    path.join(packageDirectory, 'Package.swift'),
    path.join(packageDirectory, 'Sources'),
    path.join(packageDirectory, 'Tests'),
  ],
  executionOptions,
);

const testResult = await execute(
  '/usr/bin/xcrun',
  ['swift', 'test', '--package-path', packageDirectory, '--enable-code-coverage'],
  executionOptions,
);
process.stdout.write(testResult.stdout);
process.stderr.write(testResult.stderr);

const { stdout: coveragePathOutput } = await execute(
  '/usr/bin/xcrun',
  ['swift', 'test', '--package-path', packageDirectory, '--show-codecov-path'],
  executionOptions,
);
const coveragePath = coveragePathOutput.trim();
const coverage = JSON.parse(await readFile(coveragePath, 'utf8'));
const productionFiles = coverage.data[0].files.filter((file) =>
  file.filename.includes('/Sources/CueAudioTapCore/'),
);

if (productionFiles.length === 0) {
  throw new Error('Swift coverage contains no CueAudioTapCore production files.');
}

const failures = [];
for (const file of productionFiles) {
  for (const metric of ['lines', 'functions', 'instantiations', 'regions']) {
    const value = file.summary[metric];
    if (value.count === 0 || value.covered !== value.count) {
      failures.push(`${path.basename(file.filename)} ${metric}: ${value.covered}/${value.count}`);
    }
  }
}
if (failures.length > 0) {
  throw new Error(`Swift coverage gate failed:\n${failures.join('\n')}`);
}

const summary = productionFiles.map((file) => ({
  file: path.relative(projectRoot, file.filename),
  functions: file.summary.functions,
  instantiations: file.summary.instantiations,
  lines: file.summary.lines,
  regions: file.summary.regions,
}));
process.stdout.write(`${JSON.stringify({ coveragePath, files: summary }, null, 2)}\n`);

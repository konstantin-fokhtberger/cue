import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  buildElectronBuilderSigningArgs,
  parseCodeSigningIdentities,
  parseCodesignDetails,
  selectCodeSigningIdentity,
  validateCodesignDetails,
} from '../src/core/macos-signing-policy.mjs';

const execute = promisify(execFile);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appBundle = path.join(projectRoot, 'dist', 'mac-arm64', 'cue.app');
const electronBuilder = path.join(projectRoot, 'node_modules', '.bin', 'electron-builder');
const expectedIdentifier = 'com.cue.overlay';

if (process.platform !== 'darwin') {
  throw new Error('macOS packaging must run on macOS.');
}

const mode = process.argv[2];
if (mode !== '--local' && mode !== '--adhoc') {
  throw new Error('usage: node tools/package-macos.mjs --local|--adhoc');
}

let signingIdentity = '-';
let requireTeam = false;
if (mode === '--local') {
  const { stdout } = await execute('/usr/bin/security', [
    'find-identity',
    '-p',
    'codesigning',
    '-v',
  ]);
  const identity = selectCodeSigningIdentity(
    parseCodeSigningIdentities(stdout),
    process.env.CUE_CODESIGN_IDENTITY,
  );
  signingIdentity = identity.name;
  requireTeam = true;
}

await execute(
  electronBuilder,
  buildElectronBuilderSigningArgs(signingIdentity, requireTeam ? 'none' : undefined),
  {
    cwd: projectRoot,
    env: {
      ...process.env,
      CSC_IDENTITY_AUTO_DISCOVERY: 'true',
    },
    maxBuffer: 20 * 1024 * 1024,
  },
);

await execute('/usr/bin/codesign', ['--verify', '--deep', '--strict', appBundle]);

const detailsResult = await execute('/usr/bin/codesign', ['-dvvv', appBundle], {
  maxBuffer: 4 * 1024 * 1024,
});
const requirementResult = await execute('/usr/bin/codesign', ['-d', '-r-', appBundle], {
  maxBuffer: 4 * 1024 * 1024,
});
const details = validateCodesignDetails(
  parseCodesignDetails(
    `${detailsResult.stdout}\n${detailsResult.stderr}\n${requirementResult.stdout}\n${requirementResult.stderr}`,
  ),
  { expectedIdentifier, requireTeam },
);

process.stdout.write(
  `${JSON.stringify({
    identifier: details.identifier,
    teamIdentifier: details.teamIdentifier,
    signature: details.signature,
    designatedRequirementSha256: createHash('sha256')
      .update(details.designatedRequirement)
      .digest('hex'),
    tccStable: requireTeam,
  })}\n`,
);

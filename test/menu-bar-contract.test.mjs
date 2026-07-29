import { access, readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const mainSource = await readFile(new URL('../main.js', import.meta.url), 'utf8');
const packageSource = JSON.parse(
  await readFile(new URL('../package.json', import.meta.url), 'utf8'),
);

describe('CT-MENUBAR-CLOSE-001 macOS status item contract', () => {
  it('wires a single menu bar controller into the normal application lifecycle', () => {
    expect(mainSource).toContain('createMenuBarController');
    expect(mainSource).toContain('createShutdownCoordinator');
    expect(mainSource).toContain("app.on('before-quit'");
    expect(mainSource).not.toContain('app.exit(');
    expect(mainSource).not.toContain('process.exit(');
  });

  it('packages the macOS template icon used by the status item', async () => {
    expect(packageSource.build.files).toContain('assets/**/*');
    await expect(
      access(new URL('../assets/cueTemplate.png', import.meta.url)),
    ).resolves.toBeUndefined();
    await expect(
      access(new URL('../assets/cueTemplate@2x.png', import.meta.url)),
    ).resolves.toBeUndefined();
  });
});

import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const mainSource = await readFile(new URL('../main.js', import.meta.url), 'utf8');
const rendererSource = await readFile(new URL('../renderer/renderer.js', import.meta.url), 'utf8');

describe('CT-MEETING-NO-SCREEN-SOURCE-001 meeting permission contract', () => {
  it('does not import or enumerate desktop screen sources for meeting audio', () => {
    expect(mainSource).not.toContain('desktopCapturer');
    expect(mainSource).not.toContain("getSources({ types: ['screen'] })");
    expect(mainSource).not.toContain('setDisplayMediaRequestHandler');
    expect(mainSource).not.toContain('display-capture');
    expect(rendererSource).not.toContain('getDisplayMedia');
  });
});

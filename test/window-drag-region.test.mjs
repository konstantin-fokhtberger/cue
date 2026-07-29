import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const rendererHtml = await readFile(new URL('../renderer/index.html', import.meta.url), 'utf8');
const rendererCss = await readFile(new URL('../renderer/styles.css', import.meta.url), 'utf8');

describe('CT-WINDOW-DRAG-REGION-001 frameless window movement contract', () => {
  it('provides one labeled non-interactive handle inside the upper toolbar', () => {
    const handles = rendererHtml.match(/id="window-drag-region"/g) || [];
    const toolbarStart = rendererHtml.indexOf('<div id="toolbar">');
    const toolbarEnd = rendererHtml.indexOf('<!-- Main assistant panel -->');
    const toolbar = rendererHtml.slice(toolbarStart, toolbarEnd);

    expect(handles).toHaveLength(1);
    expect(toolbar).toContain('id="window-drag-region"');
    expect(toolbar).toContain('role="group"');
    expect(toolbar).toContain('aria-label="Drag to move cue window"');
    expect(toolbar).toContain('title="Drag to move cue window"');
    expect(toolbar).not.toMatch(/<button[^>]*id="window-drag-region"/);
    expect(toolbar).not.toMatch(/<input[^>]*id="window-drag-region"/);
  });

  it('limits drag behavior to the handle and preserves explicit no-drag controls', () => {
    expect(rendererCss).toMatch(/#toolbar\s*{[^}]*-webkit-app-region:\s*no-drag;[^}]*}/s);
    expect(rendererCss).toMatch(
      /#window-drag-region\s*{[^}]*-webkit-app-region:\s*drag;[^}]*min-width:\s*44px;[^}]*min-height:\s*28px;[^}]*}/s,
    );
    expect(rendererCss).toMatch(
      /\.no-drag,\s*button,\s*input,\s*select,\s*textarea\s*{[^}]*-webkit-app-region:\s*no-drag;/s,
    );
  });
});

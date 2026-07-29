import { describe, expect, it, vi } from 'vitest';

import menuBarModule from '../src/core/menu-bar-controller.cjs';

const { createMenuBarController } = menuBarModule;

function fixture({ emptyIcon = false } = {}) {
  const icon = {
    isEmpty: vi.fn(() => emptyIcon),
    setTemplateImage: vi.fn(),
  };
  const tray = {
    destroy: vi.fn(),
    setContextMenu: vi.fn(),
    setToolTip: vi.fn(),
  };
  const Tray = vi.fn(function TrayFixture() {
    return tray;
  });
  const Menu = { buildFromTemplate: vi.fn((template) => ({ template })) };
  const nativeImage = { createFromPath: vi.fn(() => icon) };
  const app = { quit: vi.fn() };

  return { app, icon, Menu, nativeImage, tray, Tray };
}

describe('macOS menu bar controller', () => {
  it('creates one template status item with the accepted Close app action', () => {
    const dependencies = fixture();
    const controller = createMenuBarController({
      ...dependencies,
      iconPath: '/fixtures/cueTemplate.png',
    });

    expect(dependencies.nativeImage.createFromPath).toHaveBeenCalledWith(
      '/fixtures/cueTemplate.png',
    );
    expect(dependencies.icon.setTemplateImage).toHaveBeenCalledWith(true);
    expect(dependencies.Tray).toHaveBeenCalledWith(dependencies.icon);
    expect(dependencies.tray.setToolTip).toHaveBeenCalledWith('cue');
    expect(dependencies.Menu.buildFromTemplate).toHaveBeenCalledOnce();

    const [template] = dependencies.Menu.buildFromTemplate.mock.calls[0];
    expect(template).toHaveLength(1);
    expect(template[0]).toMatchObject({ label: 'Close app' });
    expect(template[0].click).toEqual(expect.any(Function));
    template[0].click();
    expect(dependencies.app.quit).toHaveBeenCalledOnce();
    expect(dependencies.tray.setContextMenu).toHaveBeenCalledWith({ template });

    controller.dispose();
    controller.dispose();
    expect(dependencies.tray.destroy).toHaveBeenCalledOnce();
  });

  it('fails closed when the packaged template icon cannot be loaded', () => {
    const dependencies = fixture({ emptyIcon: true });

    expect(() =>
      createMenuBarController({
        ...dependencies,
        iconPath: '/missing/cueTemplate.png',
      }),
    ).toThrow(new Error('menu-bar-icon-unavailable'));
    expect(dependencies.Tray).not.toHaveBeenCalled();
  });
});

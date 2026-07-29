function createMenuBarController({ Tray, Menu, nativeImage, app, iconPath }) {
  const icon = nativeImage.createFromPath(iconPath);
  if (icon.isEmpty()) {
    throw new Error('menu-bar-icon-unavailable');
  }
  icon.setTemplateImage(true);

  const tray = new Tray(icon);
  tray.setToolTip('cue');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: 'Close app',
        click: () => app.quit(),
      },
    ]),
  );

  let disposed = false;
  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      tray.destroy();
    },
  };
}

module.exports = { createMenuBarController };

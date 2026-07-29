function createShutdownCoordinator({ app, cleanup, onError }) {
  let cleanupPromise = null;
  let completed = false;

  function waitForCleanup() {
    return cleanupPromise;
  }

  function handleBeforeQuit(event) {
    if (completed) return;
    event.preventDefault();
    if (cleanupPromise) return;

    cleanupPromise = Promise.resolve()
      .then(cleanup)
      .catch((error) => onError(error))
      .then(() => {
        completed = true;
        app.quit();
      });
  }

  return {
    handleBeforeQuit,
    waitForCleanup,
  };
}

module.exports = { createShutdownCoordinator };

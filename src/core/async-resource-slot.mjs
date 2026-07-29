export class AsyncResourceSlot {
  #dispose;
  #generation = Symbol();
  #pending = null;
  #resource = null;

  constructor(dispose) {
    this.#dispose = dispose;
  }

  get active() {
    return this.#resource !== null;
  }

  start(create) {
    if (this.#resource !== null) {
      return Promise.resolve(this.#resource);
    }
    if (this.#pending !== null) {
      return this.#pending;
    }

    const generation = this.#generation;
    const pending = Promise.resolve()
      .then(create)
      .then(async (resource) => {
        if (generation !== this.#generation) {
          await this.#dispose(resource);
          return null;
        }
        this.#resource = resource;
        return resource;
      })
      .finally(() => {
        if (this.#pending === pending) {
          this.#pending = null;
        }
      });

    this.#pending = pending;
    return pending;
  }

  async stop() {
    this.#generation = Symbol();
    this.#pending = null;

    const resource = this.#resource;
    this.#resource = null;
    if (resource !== null) {
      await this.#dispose(resource);
    }
  }
}

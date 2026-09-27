/**
 * Serializa las operaciones que llegan de una misma sala.
 *
 * Node ejecuta el código de un handler de forma síncrona, así que dos jugadas
 * que "llegan al mismo tiempo" se atienden en paralelo solo en cuanto el
 * handler se vuelve asíncrono (esperar a SQLite, por ejemplo). Encolar las
 * operaciones por sala garantiza que cada una ve el estado que dejó la
 * anterior, y que la lectura-modificación-escritura de una jugada es atómica
 * respecto a las demás jugadas de esa partida.
 *
 * No es un mutex entre salas: cada partida avanza con normalidad.
 */
export class RoomLocks {
  private chains = new Map<string, Promise<unknown>>();

  /** Ejecuta `task` encolada detrás de lo que ya esté pendiente para `key`. */
  run<T>(key: string, task: () => T | Promise<T>): Promise<T> {
    const previous = this.chains.get(key) ?? Promise.resolve();
    // La cadena nunca debe quedar rechazada: si una jugada falla, la siguiente
    // debe poder entrar igualmente.
    const next = previous.then(
      () => task(),
      () => task()
    );
    this.chains.set(
      key,
      next.catch(() => undefined)
    );
    void next.catch(() => undefined);
    return next;
  }

  /** Espera a que se vacíe la cola de una sala (usado al apagar el servidor). */
  async drain(key: string): Promise<void> {
    const pending = this.chains.get(key);
    if (!pending) return;
    await pending.catch(() => undefined);
  }

  async drainAll(): Promise<void> {
    await Promise.all([...this.chains.values()].map((p) => p.catch(() => undefined)));
  }

  forget(key: string): void {
    this.chains.delete(key);
  }
}

/**
 * Identidad local del jugador.
 *
 * Es la única pieza de información que el cliente guarda: con ella, al abrir
 * la página de nuevo, puede preguntar al backend "¿en qué partida estaba y con
 * qué identidad?". El backend es quien valida ambas cosas y devuelve el estado;
 * aquí no se guarda ninguna mano ni ningún estado de juego.
 */

const SESSION_KEY = "domino.session";
const NAME_KEY = "domino.playerName";

export interface StoredSession {
  roomId: string;
  playerId: string;
}

function isStoredSession(value: unknown): value is StoredSession {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<StoredSession>;
  return (
    typeof candidate.roomId === "string" &&
    candidate.roomId.length > 0 &&
    typeof candidate.playerId === "string" &&
    candidate.playerId.length > 0
  );
}

export function loadSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isStoredSession(parsed) ? parsed : null;
  } catch {
    // localStorage puede estar bloqueado o contener basura: se ignora.
    return null;
  }
}

export function saveSession(session: StoredSession): void {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // Sin almacenamiento no se puede reconectar al recargar, pero el juego en
    // la sesión actual sigue funcionando.
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    // Nada que hacer: la sesión caduca sola cuando el backend la rechaza.
  }
}

export function loadPlayerName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

export function savePlayerName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    // El nombre solo es informativo.
  }
}

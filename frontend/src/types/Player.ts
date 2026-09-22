export interface Player {
  id: string;
  name: string;
  position: number;
  team: number;
}

export const TEAM_NAMES = ["Equipo A", "Equipo B"];

export function teamName(
  playersOrTeam: Player[] | number,
  team?: number
): string {
  if (typeof playersOrTeam === "number") {
    // Llamada con un solo argumento: etiqueta genérica del equipo.
    return TEAM_NAMES[playersOrTeam] ?? `Equipo ${playersOrTeam + 1}`;
  }
  const id = team ?? 0;
  if (playersOrTeam.length === 4) {
    const nombres = playersOrTeam.filter((el) => el.team === id);
    if (nombres.length < 2) return "";
    return `${nombres[0].name.toUpperCase()} / ${nombres[1].name.toUpperCase()}`;
  }
  return "";
}

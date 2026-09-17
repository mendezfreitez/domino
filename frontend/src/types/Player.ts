export interface Player {
  id: string;
  name: string;
  position: number;
  team: number;
}

export const TEAM_NAMES = ["Equipo A", "Equipo B"];

export function teamName(team: number): string {
  return TEAM_NAMES[team] ?? `Equipo ${team + 1}`;
}

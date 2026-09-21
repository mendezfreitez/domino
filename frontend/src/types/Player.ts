export interface Player {
  id: string;
  name: string;
  position: number;
  team: number;
}

export const TEAM_NAMES = ["Equipo A", "Equipo B"];

export function teamName(players: Array<any>, id: number): string {
  if (players.length === 4) {
    const nombres = players.filter((el: any) => el.team === id);
    return `${nombres[0].name.toUpperCase()} / ${nombres[1].name.toUpperCase()}`
  }
  return "";
}

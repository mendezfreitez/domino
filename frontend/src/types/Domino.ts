export interface DominoTile {
  id: string;
  left: number;
  right: number;
}

/**
 * Ordena una mano de dominó de menor a mayor por su cara menor y, en empate,
 * por la cara mayor: 0-0, 0-1, 0-2, …, 0-6, 1-1, 1-2, …, 5-6, 6-6.
 * No muta el array original.
 */
export function sortHandTiles(tiles: DominoTile[]): DominoTile[] {
  return [...tiles].sort((a, b) => {
    const aLo = Math.min(a.left, a.right);
    const aHi = Math.max(a.left, a.right);
    const bLo = Math.min(b.left, b.right);
    const bHi = Math.max(b.left, b.right);
    return aLo - bLo || aHi - bHi;
  });
}
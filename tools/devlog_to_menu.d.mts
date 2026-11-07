/** Types for the devlog tile generator, so a TS test can import it directly. */
export interface DevlogShot {
  file: string;
  alt: string;
  caption: string;
  date: string;
}
export const TILE_COUNT: number;
export function parseDevlog(text: string, count?: number): DevlogShot[];
export function render(shots: DevlogShot[]): string;

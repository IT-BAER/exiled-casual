/** Types for the frame comparer, so a TS test can import it directly. */
export function diffImages(
  a: Buffer | string,
  b: Buffer | string,
  opts?: { threshold?: number; mask?: Buffer | string },
): Promise<{ changed: number; total: number; ratio: number; width: number; height: number; diff: Buffer }>;

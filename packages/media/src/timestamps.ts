/** Phase 0E uses integer working frames at 30 fps as its canonical timeline.
 * Frame n starts at n/30 seconds. Persisted millisecond labels are rounded to
 * nearest integer, ties away from zero. Intervals are [startFrame,endFrame).
 * Original PTS values stay as decimal integer strings with a rational timebase.
 */
export const WORKING_FPS = 30;

export function frameToMs(frame: number): number {
  if (!Number.isSafeInteger(frame) || frame < 0) throw new Error('Invalid frame index');
  const value = Math.round(frame * 1000 / WORKING_FPS);
  if (!Number.isSafeInteger(value)) throw new Error('Frame time out of range');
  return value;
}

export function decimalSecondsToMs(value: string): number {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) throw new Error('Invalid timestamp');
  const fraction = (match[2] ?? '').padEnd(4, '0');
  const milliseconds = BigInt(match[1]!) * 1000n + BigInt(fraction.slice(0, 3) || '0') +
    (Number(fraction[3] ?? '0') >= 5 ? 1n : 0n);
  if (milliseconds > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Timestamp out of range');
  return Number(milliseconds);
}

export function decimalSecondsToFrame(value: string): number {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) throw new Error('Invalid timestamp');
  const digits = match[2] ?? '';
  const denominator = 10n ** BigInt(digits.length);
  const numerator = BigInt(match[1]!) * denominator + BigInt(digits || '0');
  const frame = (numerator * 30n * 2n + denominator) / (denominator * 2n);
  if (frame > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Frame time out of range');
  return Number(frame);
}

export function parseRational(value: unknown): {num: number; den: number} | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d+)\/(\d+)$/.exec(value);
  if (!match) return null;
  const num = Number(match[1]); const den = Number(match[2]);
  return Number.isSafeInteger(num) && Number.isSafeInteger(den) && num > 0 && den > 0 ? {num,den} : null;
}

declare const timeUnit: unique symbol;

/** Plain numbers remain accepted at API boundaries; typed units cannot be interchanged. */
export type Seconds = number & { readonly [timeUnit]?: 'seconds' };
export type Milliseconds = number & { readonly [timeUnit]?: 'milliseconds' };

/** Convert only units: retain fractional authored times without snapping or rounding. */
export function toMilliseconds(time: Seconds): Milliseconds {
  return time * 1000;
}

export function toSeconds(time: Milliseconds): Seconds {
  return time / 1000;
}

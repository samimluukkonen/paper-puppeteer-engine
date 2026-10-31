interface Interval<T> {
  readonly value: T;
  readonly start: number;
  readonly end: number;
  readonly order: number;
}

interface IntervalNode<T> {
  readonly center: number;
  readonly starts: readonly Interval<T>[];
  readonly ends: readonly Interval<T>[];
  readonly left: IntervalNode<T> | undefined;
  readonly right: IntervalNode<T> | undefined;
}

/** A centered interval tree visits O(log n + k) entries, including after arbitrary seeks.
 * Keep both endpoint orders so long intervals cannot force scans of inactive neighbors.
 */
export function compileSceneIntervals<T>(
  values: readonly T[],
  start: (value: T) => number,
  end: (value: T) => number,
): (time: number) => readonly T[] {
  function build(intervals: Interval<T>[]): IntervalNode<T> | undefined {
    if (!intervals.length) return undefined;
    const center = intervals[Math.floor(intervals.length / 2)]!.start;
    const left: Interval<T>[] = [];
    const right: Interval<T>[] = [];
    const crossing: Interval<T>[] = [];
    for (const interval of intervals) {
      if (interval.end <= center) left.push(interval);
      else if (interval.start > center) right.push(interval);
      else crossing.push(interval);
    }
    return {
      center,
      starts: crossing,
      ends: [...crossing].sort((a, b) => b.end - a.end),
      left: build(left),
      right: build(right),
    };
  }
  const root = build(
    values
      .map((value, order) => ({ value, start: start(value), end: end(value), order }))
      .filter((interval) => interval.end > interval.start)
      .sort((a, b) => a.start - b.start),
  );
  return (time) => {
    const active: Interval<T>[] = [];
    let node = root;
    while (node) {
      if (time < node.center) {
        for (const interval of node.starts) {
          if (interval.start > time) break;
          active.push(interval);
        }
        node = node.left;
      } else {
        for (const interval of node.ends) {
          if (interval.end <= time) break;
          active.push(interval);
        }
        node = node.right;
      }
    }
    // Public audio samples preserve authored order, independent of tree traversal order.
    return active.sort((a, b) => a.order - b.order).map(({ value }) => value);
  };
}

/** Last start at or before time; validated subtitle/fade intervals never overlap. */
export function latestSceneInterval<T extends { readonly time: number }>(
  sorted: readonly T[],
  time: number,
): T | undefined {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (sorted[middle]!.time <= time) low = middle + 1;
    else high = middle;
  }
  return sorted[low - 1];
}

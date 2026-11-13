// Where a y axis of `height` px puts its labels: top, middle and bottom, or, when the values cross
// zero, top, zero and bottom, so the axis names the zero line. A zero within `room` px of either
// end has no label of its own, so it never overlaps the end's.
export function yTicks(lo, hi, height, room = 14) {
  if (lo < 0 && hi > 0) {
    const zero = (hi / (hi - lo)) * height;
    const middle = zero >= room && zero <= height - room ? [{ value: 0, top: zero, zero: true }] : [];
    return [{ value: hi, top: 0 }, ...middle, { value: lo, top: height }];
  }
  return [{ value: hi, top: 0 }, { value: (hi + lo) / 2, top: height / 2 }, { value: lo, top: height }];
}

export function bounds(values, withZero) {
  let lo = withZero ? 0 : Infinity;
  let hi = withZero ? 0 : -Infinity;
  for (const v of values) {
    if (v !== v) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (lo === Infinity) return { lo: 0, hi: 1 };
  if (lo === hi) return lo === 0 ? { lo: 0, hi: 1 } : { lo: Math.min(lo, 0), hi: Math.max(hi, 0) };
  return { lo, hi };
}

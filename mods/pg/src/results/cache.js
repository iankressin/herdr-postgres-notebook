// A result is drawn many times; anything worked out from all its rows is worked out once.
const derived = new WeakMap();
export function memo(result, key, work) {
  let known = derived.get(result);
  if (!known) derived.set(result, (known = new Map()));
  if (!known.has(key)) known.set(key, work());
  return known.get(key);
}

export const hasMemo = (result, key) => derived.get(result)?.has(key) ?? false;

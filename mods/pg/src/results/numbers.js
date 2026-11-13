// Math.min(...xs) overflows the stack on a few hundred thousand values.
export const lowest = (xs) => xs.reduce((a, b) => (b < a ? b : a), Infinity);
export const highest = (xs) => xs.reduce((a, b) => (b > a ? b : a), -Infinity);

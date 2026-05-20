// Shared uniform randomness, computed entirely in the browser.
// Uses crypto.getRandomValues() with rejection sampling to avoid modulo bias,
// giving uniform results that improve fairness (SM-001/002/003).

// Returns a uniform integer in [0, n) for n >= 1.
function randomIndex(n) {
  if (n <= 0) throw new RangeError('n must be >= 1');
  if (n === 1) return 0;

  const maxUint32 = 0xffffffff;
  // Largest multiple of n that fits in uint32; reject anything above it.
  const limit = Math.floor((maxUint32 + 1) / n) * n;
  const buf = new Uint32Array(1);
  let value;
  do {
    crypto.getRandomValues(buf);
    value = buf[0];
  } while (value >= limit);
  return value % n;
}

// Returns a uniform integer in [min, max] inclusive.
function randomInt(min, max) {
  return min + randomIndex(max - min + 1);
}

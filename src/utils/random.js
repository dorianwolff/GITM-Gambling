/**
 * random.js
 * Cryptographically-strong randomness for client-side display only.
 * Authoritative randomness for credit-affecting outcomes lives in Postgres.
 */

export function randInt(min, max) {
  // inclusive both ends
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  const range = max - min + 1;
  return min + (buf[0] % range);
}

export function randFloat() {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] / 0x1_0000_0000;
}

export function pick(arr) {
  return arr[randInt(0, arr.length - 1)];
}

export function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(0, i);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

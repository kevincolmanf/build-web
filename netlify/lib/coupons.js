const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin I,O,0,1

export function generateCode() {
  let s = '';
  for (let i = 0; i < 6; i++) {
    s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return `BUILD-${s}`;
}

export function discountFromScore(score) {
  const s = Math.max(0, Math.min(100, Number(score) || 0));
  if (s <= 20) return 5;
  if (s <= 40) return 6;
  if (s <= 60) return 7;
  if (s <= 80) return 8;
  if (s <= 95) return 9;
  return 10;
}

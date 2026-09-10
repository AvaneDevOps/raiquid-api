import { createHash } from 'node:crypto';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export function brickkenTokenSymbol(invoiceId: string): string {
  const digest = createHash('sha256').update(invoiceId).digest();
  let symbol = 'R';
  for (let i = 0; i < 4; i += 1) {
    symbol += LETTERS[digest[i] % 26];
  }
  return symbol;
}

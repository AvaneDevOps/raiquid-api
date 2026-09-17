import { BrickkenIntegrationError } from './brickken.errors';

/** One-line description of a Brickken failure, for logs and error fields. */
export function describeBrickkenError(err: unknown): string {
  if (err instanceof BrickkenIntegrationError) {
    return `[${err.kind}] ${err.message}`;
  }
  return err instanceof Error ? err.message : String(err);
}

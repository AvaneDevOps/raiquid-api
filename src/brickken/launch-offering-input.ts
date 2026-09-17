import type { LaunchOfferingInput } from './brickken.service';

export const STO_START_DELAY_MS = 20 * 60 * 1000;
export const STO_WINDOW_MS = 72 * 60 * 60 * 1000;

/**
 * Builds a fresh launchOffering input for one invoice — a new start/end
 * window computed from now. Shared by the buyer-accept flow and the admin
 * manual STO-launch retry so both build the identical shape.
 */
export function buildLaunchOfferingInput(
  invoice: {
    id: string;
    invoiceNumber: string;
    amount: { toString(): string };
  },
  tokenSymbol: string,
): LaunchOfferingInput {
  const startDate = new Date(Date.now() + STO_START_DELAY_MS);
  const endDate = new Date(startDate.getTime() + STO_WINDOW_MS);
  const raiseAmount = invoice.amount.toString();

  return {
    invoiceId: invoice.id,
    tokenSymbol,
    offeringName: `Invoice ${invoice.invoiceNumber} financing`,
    tokenAmount: raiseAmount,
    raiseAmount,
    startDate,
    endDate,
  };
}

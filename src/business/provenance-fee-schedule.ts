import { ProvenanceTier } from '../common/enums';

export interface ProvenanceFees {
  /** Percent, e.g. 3 == 3%. */
  platformFeePct: number;
  /** Percent, e.g. 1 == 1%. */
  reserveContributionPct: number;
}

// Confirmed against the frontend's screens.
const CARRIED_FEES: ProvenanceFees = {
  platformFeePct: 3,
  reserveContributionPct: 1,
};

// PLACEHOLDER — not confirmed. Reuses Carried's numbers only so every tier
// has *a* value; this is not a claim that Quarried equals Carried. Replace
// with real product numbers before this ships.
const QUARRIED_FEES: ProvenanceFees = {
  platformFeePct: 3,
  reserveContributionPct: 1,
};

// PLACEHOLDER — not confirmed, see QUARRIED_FEES above.
const ANCHORED_FEES: ProvenanceFees = {
  platformFeePct: 3,
  reserveContributionPct: 1,
};

/**
 * Invoice fees are set by the buyer's provenance tier, never by the
 * submitting business — see docs/RAIQUID_CONTEXT.md for the confirmed vs.
 * placeholder status of each tier.
 */
export const PROVENANCE_FEE_SCHEDULE: Record<ProvenanceTier, ProvenanceFees> = {
  [ProvenanceTier.quarried]: QUARRIED_FEES,
  [ProvenanceTier.carried]: CARRIED_FEES,
  [ProvenanceTier.anchored]: ANCHORED_FEES,
};

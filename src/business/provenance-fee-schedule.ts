import { ProvenanceTier } from '../common/enums';

export interface ProvenanceFees {
  platformFeePct: number;
  reserveContributionPct: number;
}

const CARRIED_FEES: ProvenanceFees = {
  platformFeePct: 3,
  reserveContributionPct: 1,
};

// PLACEHOLDER: Quarried/Anchored fee numbers unconfirmed — see docs/RAIQUID_CONTEXT.md
const QUARRIED_FEES: ProvenanceFees = {
  platformFeePct: 3,
  reserveContributionPct: 1,
};

const ANCHORED_FEES: ProvenanceFees = {
  platformFeePct: 3,
  reserveContributionPct: 1,
};

export const PROVENANCE_FEE_SCHEDULE: Record<ProvenanceTier, ProvenanceFees> = {
  [ProvenanceTier.quarried]: QUARRIED_FEES,
  [ProvenanceTier.carried]: CARRIED_FEES,
  [ProvenanceTier.anchored]: ANCHORED_FEES,
};

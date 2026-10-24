export type VenueSuggestionKind = 'fee' | 'funding';

export interface VenueSuggestion {
  id: string;
  kind: VenueSuggestionKind;
  currentVenue: string;
  /** Percent, e.g. 0.3 means 0.30%. */
  currentRate: number;
  suggestedVenue: string;
  /** Percent, e.g. 0.05 means 0.05%. */
  suggestedRate: number;
  /** Funding only, e.g. '8h'. */
  fundingInterval?: string;
  url: string;
}

const MOCK_SUGGESTIONS: VenueSuggestion[] = [
  {
    id: 'mock-fee-1',
    kind: 'fee',
    currentVenue: 'Current DEX',
    currentRate: 0.3,
    suggestedVenue: 'Phoenix',
    suggestedRate: 0.05,
    url: 'https://phoenix.trade',
  },
  {
    id: 'mock-funding-1',
    kind: 'funding',
    currentVenue: 'Current DEX',
    currentRate: 0.03,
    suggestedVenue: 'Phoenix',
    suggestedRate: 0.01,
    fundingInterval: '8h',
    url: 'https://phoenix.trade',
  },
];

/**
 * Mock source until the backend endpoint exists. Swap the body for an
 * `apiFetch` call that returns the same `VenueSuggestion[]` shape.
 */
export async function fetchVenueSuggestions(): Promise<VenueSuggestion[]> {
  return MOCK_SUGGESTIONS;
}

export function formatRate(rate: number, kind: VenueSuggestionKind): string {
  return `${rate.toFixed(kind === 'funding' ? 4 : 2)}%`;
}

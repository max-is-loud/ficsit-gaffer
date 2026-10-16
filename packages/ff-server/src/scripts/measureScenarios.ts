// The fixed questions the chat-turn measurement script asks. Changing one invalidates every
// earlier comparison, so add a new scenario rather than editing an existing one.

/** A conversation to replay; only `measuredTurn` (0-based) is recorded. */
export interface MeasureScenario {
  id: string;
  turns: string[];
  measuredTurn: number;
}

const IRON_NEAR_ME = "What's the next iron factory I should build near me?";

export const MEASURE_SCENARIOS: MeasureScenario[] = [
  { id: 'iron-near-me', turns: [IRON_NEAR_ME], measuredTurn: 0 },
  {
    id: 'power-plan',
    turns: ['My power is getting tight. Plan the next power plant for me.'],
    measuredTurn: 0,
  },
  {
    // Turn 2 is the case the save summary targets: the save facts were fetched in turn 1.
    id: 'follow-up',
    turns: [IRON_NEAR_ME, 'And what about copper — what should I build for that near me?'],
    measuredTurn: 1,
  },
];

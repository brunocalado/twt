import { calendar, setCalendar } from "./travel.mjs";
import { requestTest } from "./test-flow.mjs";
import { applyDamageToMany } from "./damage.mjs";
import { setCondition } from "./effects.mjs";

/**
 * Fatigue.
 *
 * Camp is owed once a day, which is every three segments. Miss it and the party is
 * Fatigued; while Fatigued, every further segment without sleep calls for a Will +
 * Survival test at an escalating difficulty — 1M, then 2M, then 3M — and each failure
 * costs 1 Will damage.
 *
 * The escalation counter lives on the expedition's clock, not on any one Delver, because
 * it is the march that is grinding them down rather than anything they individually did.
 */

/** Camp is owed after this many segments. */
const SEGMENTS_PER_CAMP = 3;

/**
 * Run the fatigue step for a segment that has just ended.
 *
 * @param {Actor[]} party
 * @param {object} [options]
 * @param {boolean} [options.camp=false]
 * @returns {Promise<{name: string, success: boolean, difficulty: number}[]>}
 */
export async function applyFatigue(party, { camp = false } = {}) {
  // A proper camp clears the state and resets the escalation.
  if (camp) {
    for (const actor of party) {
      if (actor.statuses.has("fatigued")) await setCondition(actor, "fatigued", { active: false });
    }
    await setCalendar({ fatigueStep: 0, segmentsSinceCamp: 0 });
    return [];
  }

  const clock = calendar();
  // `segmentsSinceCamp` has not been bumped for this segment yet, so the third sleepless
  // segment is the one that reads 2 here.
  const sleepless = clock.segmentsSinceCamp + 1;
  if (sleepless < SEGMENTS_PER_CAMP) return [];

  // The first overdue segment applies the condition; the ones after it escalate.
  for (const actor of party) {
    if (!actor.statuses.has("fatigued")) await setCondition(actor, "fatigued", { active: true });
  }

  const step = clock.fatigueStep + 1;
  const difficulty = step;
  await setCalendar({ fatigueStep: step });

  const results = [];
  const failures = [];

  for (const actor of party) {
    const rolled = await requestTest(actor, {
      trait: "will",
      skill: "survival",
      difficulty,
      label: game.i18n.localize("TWT.Condition.Fatigued"),
      skipDialog: true
    });
    const success = !!rolled?.result.success;
    results.push({ name: actor.name, success, difficulty });
    if (!success) failures.push(actor);
  }

  if (failures.length) {
    await applyDamageToMany(failures, {
      amount: 1,
      type: "will",
      piercing: true,
      source: "TWT.Condition.Fatigued",
      silent: true
    });
  }

  return results;
}

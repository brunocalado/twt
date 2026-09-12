import { applyDamage } from "./damage.mjs";

/**
 * The D6 mark-counting engine. Everything else in the system resolves through here.
 *
 * The rule, from the Four Stages of a Test:
 *
 *   Pool       = trait score + skill score + assist dice
 *   Assist     = ceil(ally's score in the tested skill / 2), one ally at most
 *   Marks      = dice showing 5 or 6
 *   Difficulty = base ± modifiers, floored at 1M
 *   Success    = marks >= difficulty
 *   Boons      = surplus marks, plus 1 per attempted reduction below 1M
 *   Strain     = reroll any dice once, then take 1 MIND damage. Delvers only.
 *
 * Four details the prose makes easy to get wrong, all settled here:
 *
 * - **Boons come only from a success.** A failure yields none, the below-1M bonus
 *   included — the rule grants those "if you succeed".
 * - **The below-1M bonus is per attempted reduction.** A 2M test eased by 3M is a 1M
 *   test with +2 bonus boons, not +1.
 * - **Straining a success is legal**, to fish for more boons, so the button stays
 *   live until it is used.
 * - **Assist dice join the pool and can be rerolled.** The assisting ally takes no
 *   strain damage.
 */

/** A die at or above this face is a Mark. */
export const MARK_THRESHOLD = 5;

/**
 * @typedef {object} TWTTestResult
 * @property {Roll[]}   rolls        The original roll, plus the strain roll once strained.
 * @property {number}   pool         Dice rolled initially.
 * @property {number[]} faces        Current face of every die, with the strain merged in.
 * @property {number[]} rerolled     Indices in `faces` replaced by the strain.
 * @property {number}   marks        Count of 5s and 6s across `faces`.
 * @property {number}   difficulty   Effective difficulty, floored at 1.
 * @property {number}   requested    Difficulty before the floor, for display.
 * @property {number}   bonusBoons   From attempted reduction below 1M.
 * @property {boolean}  success
 * @property {number}   boons
 * @property {boolean}  strained
 */

/**
 * Roll a test.
 *
 * @param {number} traitScore
 * @param {number} skillScore
 * @param {number} difficulty             Base difficulty in marks.
 * @param {object} [options]
 * @param {number} [options.assistDice=0] Dice an ally contributes.
 * @param {number} [options.modifier=0]   Added to the difficulty; negative makes it easier.
 * @returns {Promise<TWTTestResult>}
 */
export async function performTest(traitScore, skillScore, difficulty, {
  assistDice = 0,
  modifier = 0
} = {}) {
  const pool = Math.max(0, traitScore + skillScore + assistDice);
  const requested = difficulty + modifier;

  // `cs>=5` is the countSuccess modifier, so Foundry's own tooltip highlights the
  // marks. `roll.total` is deliberately not the source of truth: after a strain the
  // authoritative faces span two Roll objects and no single total describes them.
  const roll = new Roll(`${pool}d6cs>=${MARK_THRESHOLD}`);
  await roll.evaluate();

  // A pool of 0 is legal — an NPC with a 0 trait and a 0 skill — and fails any test.
  const faces = roll.dice[0]?.results.map((r) => r.result) ?? [];

  return finalize({
    rolls: [roll],
    pool,
    faces,
    rerolled: [],
    requested,
    difficulty: Math.max(1, requested),
    bonusBoons: Math.max(0, 1 - requested),
    strained: false
  });
}

/* -------------------------------------------- */

/**
 * Strain a test: reroll the chosen dice, then take 1 MIND damage.
 *
 * @param {TWTTestResult} result
 * @param {number[]} indices   Positions in `result.faces` to reroll.
 * @param {Actor} actor        The straining Delver.
 * @returns {Promise<TWTTestResult>}
 */
export async function strainTest(result, indices, actor) {
  if (result.strained) throw new Error("A test can only be strained once.");
  if (!indices.length) throw new Error("Straining requires at least one die.");

  const strainRoll = new Roll(`${indices.length}d6cs>=${MARK_THRESHOLD}`);
  await strainRoll.evaluate();

  const faces = [...result.faces];
  strainRoll.dice[0].results.forEach((r, n) => {
    faces[indices[n]] = r.result;
  });

  // Both rolls stay attached to the message, so Dice So Nice animates the reroll and
  // the roll data stays inspectable. Mutating one Roll's results in place would
  // desynchronise the term's total from the dice on screen.
  const next = finalize({
    ...result,
    faces,
    rerolled: [...indices],
    strained: true,
    rolls: [...result.rolls, strainRoll]
  });

  // R8: strain damage goes through the damage pipeline, so straining to 0 MIND
  // triggers a recovery test like any other MIND damage. Piercing because armor
  // protects the body, not the mind.
  await applyDamage(actor, { amount: 1, type: "mind", piercing: true, source: "strain" });

  return next;
}

/* -------------------------------------------- */

/**
 * The one place marks, success and boons are computed, so a strained result can
 * never drift from how the initial roll was scored.
 *
 * @param {Partial<TWTTestResult>} state
 * @returns {TWTTestResult}
 */
function finalize(state) {
  const marks = state.faces.filter((f) => f >= MARK_THRESHOLD).length;
  const success = marks >= state.difficulty;
  return {
    ...state,
    marks,
    success,
    boons: success ? marks - state.difficulty + state.bonusBoons : 0
  };
}

/* -------------------------------------------- */

/**
 * Dice an ally contributes by assisting: half their score in the tested skill,
 * rounded up. One ally per test.
 *
 * @param {Actor} ally
 * @param {string} skill  A skill key.
 * @returns {number}
 */
export function assistDiceFor(ally, skill) {
  if (!ally) return 0;
  // A Delver keeps skills as plain numbers under `skills`, and so does an NPC.
  const score = ally.system.skills?.[skill] ?? 0;
  return Math.ceil(score / 2);
}

/* -------------------------------------------- */

/**
 * Reduce a result to the plain object stored on the chat message, and read it back.
 * `Roll` objects are not part of it — the message carries those in `rolls`.
 *
 * @param {TWTTestResult} result
 * @param {object} context  Who rolled, what was tested, and what the test was for.
 * @returns {object}
 */
export function serializeTest(result, context) {
  return {
    faces: result.faces,
    rerolled: result.rerolled,
    pool: result.pool,
    marks: result.marks,
    difficulty: result.difficulty,
    requested: result.requested,
    bonusBoons: result.bonusBoons,
    success: result.success,
    boons: result.boons,
    strained: result.strained,
    context
  };
}

/**
 * Rebuild a result from a chat message's flag. `rolls` comes back empty: the
 * message owns the Roll objects, and nothing that reads a restored result needs them.
 *
 * @param {object} flag  A {@link serializeTest} payload.
 * @returns {TWTTestResult}
 */
export function deserializeTest(flag) {
  return { ...flag, rolls: [] };
}

import { SETTINGS, SYSTEM_ID } from "./config.mjs";
import { setting } from "./settings.mjs";
import { performTest } from "./roll.mjs";
import { applyDamage, healActor } from "./damage.mjs";
import { isWarded } from "./ward.mjs";
import { postRecoveryCard } from "./chat.mjs";

/**
 * What happens when a Delver's trait health reaches 0.
 *
 *   Test:      WILL + SURVIVAL
 *   Base:      2M
 *   Modifiers: +1M if unwarded in the Unknown
 *              +1M per point of overkill
 *   Success:   heal the affected trait to 1
 *   Failure:   a malignant adaptation manifests, and *then* Critical is applied
 *
 * The order on failure follows the book: the mutation arrives first, the Critical
 * state after it.
 */

/**
 * The three sample mutation lines, in the 1d3 order the Quickstart prints them.
 *
 * The Awakened I tier is carried here too, because the book prints it alongside the
 * malignant one and Delver Development awakens the same Item rather than creating a
 * second (R1). Only the malignant tier is filled in when one first manifests.
 */
export const ADAPTATION_LINES = [
  {
    key: "genius",
    line: "TWT.AdaptationLine.Genius.Name",
    malignant: {
      name: "TWT.AdaptationLine.Genius.MalignantName",
      text: "TWT.AdaptationLine.Genius.MalignantText"
    },
    awakened1: {
      name: "TWT.AdaptationLine.Genius.Awakened1Name",
      text: "TWT.AdaptationLine.Genius.Awakened1Text"
    }
  },
  {
    key: "scorpion",
    line: "TWT.AdaptationLine.Scorpion.Name",
    malignant: {
      name: "TWT.AdaptationLine.Scorpion.MalignantName",
      text: "TWT.AdaptationLine.Scorpion.MalignantText"
    },
    awakened1: {
      name: "TWT.AdaptationLine.Scorpion.Awakened1Name",
      text: "TWT.AdaptationLine.Scorpion.Awakened1Text"
    }
  },
  {
    key: "telekinetic",
    line: "TWT.AdaptationLine.Telekinetic.Name",
    malignant: {
      name: "TWT.AdaptationLine.Telekinetic.MalignantName",
      text: "TWT.AdaptationLine.Telekinetic.MalignantText"
    },
    awakened1: {
      name: "TWT.AdaptationLine.Telekinetic.Awakened1Name",
      text: "TWT.AdaptationLine.Telekinetic.Awakened1Text"
    }
  }
];

/**
 * How deep the damage → recovery → no-slot WILL damage → recovery chain may go.
 *
 * The recursion is intended: manifesting without a slot costs 1 WILL, which can itself
 * empty WILL and call for another test. It is bounded in practice because the Delver is
 * Critical by then, but a guard beats trusting that.
 */
const MAX_DEPTH = 3;

/* -------------------------------------------- */

/**
 * Run the recovery test for a pool that just reached 0.
 *
 * @param {Actor} actor
 * @param {object} context
 * @param {string} context.trait        The trait whose health ran out.
 * @param {number} [context.overkill=0]
 * @param {number} [context.depth=0]
 * @returns {Promise<object>}  What happened, or `{ prompted: true }` when the table
 *                             would rather narrate the moment themselves.
 */
export async function runRecoveryTest(actor, { trait, overkill = 0, depth = 0 }) {
  if (depth > MAX_DEPTH) {
    console.warn(`${SYSTEM_ID} | recovery recursion cut off at depth ${depth}`);
    return { ok: false, reason: "depth" };
  }

  const unwarded = !isWarded(actor);
  const modifier = overkill + (unwarded ? 1 : 0);

  // Some tables want this moment narrated rather than resolved by the system.
  if (!setting(SETTINGS.autoRecoveryTest)) {
    await postRecoveryCard(actor, {
      prompted: true,
      trait,
      overkill,
      unwarded,
      difficulty: 2 + modifier
    });
    return { prompted: true, trait, overkill, unwarded, modifier };
  }

  const result = await performTest(actor.system.traits.will.score, actor.system.skills.survival, 2, {
    modifier
  });

  const outcome = { ok: true, trait, overkill, unwarded, modifier, test: result };

  if (result.success) {
    // Back from the brink at exactly 1.
    await healActor(actor, { amount: 1 - actor.system.traits[trait].hp.value, type: trait });
    outcome.healedTo = actor.system.traits[trait].hp.value;
  } else {
    outcome.adaptation = await manifestMalignantAdaptation(actor, { depth });
    if (!actor.statuses.has("critical")) {
      await actor.toggleStatusEffect("critical", { active: true });
    }
    outcome.critical = true;
  }

  await postRecoveryCard(actor, outcome);
  return outcome;
}

/* -------------------------------------------- */

/**
 * A mutation takes hold — or, with no WILL slot left to hold it, costs 1 WILL instead.
 *
 * The rule is an either/or: "If you ever manifest an adaptation without a slot to store
 * it, you take 1 WILL damage." So the no-slot branch creates nothing.
 *
 * @param {Actor} actor
 * @param {object} [options]
 * @param {number} [options.depth=0]
 * @returns {Promise<object>}
 */
export async function manifestMalignantAdaptation(actor, { depth = 0 } = {}) {
  const slots = actor.system.slots.adaptations;
  const free = slots.max - slots.used;

  const roll = new Roll("1d3");
  await roll.evaluate();
  const pick = ADAPTATION_LINES[roll.total - 1] ?? ADAPTATION_LINES[0];

  if (free < 1) {
    // No room for it: the body pays instead. This can empty WILL and call for another
    // recovery test, which is intended — `depth` is what keeps it finite.
    const hit = await applyDamage(actor, {
      amount: 1,
      type: "will",
      piercing: true,
      source: "TWT.Recovery.NoSlotSource",
      silent: true,
      depth: depth + 1
    });
    return { noSlot: true, line: pick.line, willDamage: hit };
  }

  const [item] = await actor.createEmbeddedDocuments("Item", [
    {
      name: game.i18n.localize(pick.malignant.name),
      type: "adaptation",
      img: "icons/magic/unholy/strike-body-explode-disintegrate.webp",
      system: {
        line: game.i18n.localize(pick.line),
        tier: "malignant",
        effects: {
          malignant: {
            name: game.i18n.localize(pick.malignant.name),
            text: game.i18n.localize(pick.malignant.text)
          }
        },
        restoreTrigger: game.i18n.localize("TWT.Recovery.MalignantRestore")
      }
    }
  ]);

  return { noSlot: false, line: pick.line, itemId: item.id, itemName: item.name };
}

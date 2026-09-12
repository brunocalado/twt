import { TRAIT_KEYS } from "./config.mjs";
import { clearConditions } from "./effects.mjs";
import { postSafeRestCard } from "./chat.mjs";

/**
 * Safe Rest: three days of doing nothing productive, and everything comes back.
 *
 * One batched write per collection. Awaiting `item.update()` inside a loop is one
 * server round trip per record, where `updateEmbeddedDocuments` is one for all of them —
 * and a Delver can easily carry a dozen.
 *
 * @param {Actor} actor
 * @returns {Promise<object>}  A summary of what changed.
 */
export async function safeRest(actor) {
  const updates = {};

  if (actor.type === "delver") {
    for (const trait of TRAIT_KEYS) {
      updates[`system.traits.${trait}.hp.value`] = actor.system.traits[trait].score;
    }
    updates["system.armor.temp"] = 0;
  } else {
    updates["system.hp.value"] = actor.system.hp.max;
  }
  updates["system.armor.current"] = actor.system.armor.base;

  const itemUpdates = [];
  const deletions = [];
  const summary = { restored: 0, refilled: 0, removed: 0, destroyed: 0, conditionsCleared: 0 };

  for (const item of actor.items) {
    // R4: restoring a malignant adaptation is how you are rid of it.
    if (item.type === "adaptation" && item.system.tier === "malignant") {
      deletions.push(item.id);
      summary.removed++;
      continue;
    }

    // Destroyed is forever. A restore pass must skip these rather than revive them.
    if (item.system.state === "destroyed") {
      summary.destroyed++;
      continue;
    }

    const update = { _id: item.id };
    if (item.system.state === "exhausted") {
      update["system.state"] = "normal";
      summary.restored++;
    }
    if (item.system.charges.enabled && item.system.charges.value !== item.system.charges.max) {
      update["system.charges.value"] = item.system.charges.max;
      summary.refilled++;
    }
    if (Object.keys(update).length > 1) itemUpdates.push(update);
  }

  summary.conditionsCleared = actor.effects.filter((e) => e.statuses.size).length;

  await actor.update(updates);
  if (itemUpdates.length) await actor.updateEmbeddedDocuments("Item", itemUpdates);
  if (deletions.length) await actor.deleteEmbeddedDocuments("Item", deletions);
  await clearConditions(actor);
  await postSafeRestCard(actor, summary);

  return summary;
}

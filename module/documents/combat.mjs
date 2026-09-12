import { FLAGS, SETTINGS, SYSTEM_ID } from "../helpers/config.mjs";
import { setting } from "../helpers/settings.mjs";
import { refillArmor } from "../helpers/damage.mjs";
import { clearConditions } from "../helpers/effects.mjs";
import { isWarded } from "../helpers/ward.mjs";
import { promptSuffocation, promptUnknownExposure } from "../helpers/actions.mjs";

/**
 * The turn lifecycle.
 *
 * These are the protected `Combat` methods, **not** global hooks, and that distinction
 * is the whole reason this class exists. Foundry calls `_onStartTurn` and `_onEndTurn`
 * on the active GM alone (`Combat#_manageTurnEvents` gates on `game.user.isActiveGM`),
 * so everything here runs exactly once. A `combatTurnChange` hook fires on every
 * connected client, and a handler there would refill armor once per player at the table.
 *
 * Initiative needs nothing here: `Combatant#_getInitiativeFormula` already falls through
 * to `game.system.initiative`, which the manifest declares as `1d6`.
 */
export class TWTCombat extends foundry.documents.Combat {
  /** @inheritDoc */
  async _onStartTurn(combatant, context) {
    await super._onStartTurn(combatant, context);
    const actor = combatant?.actor;
    if (!actor) return;

    // A fresh turn is a fresh major and minor action.
    await combatant.update({
      [`flags.${SYSTEM_ID}.${FLAGS.majorUsed}`]: false,
      [`flags.${SYSTEM_ID}.${FLAGS.minorUsed}`]: false
    });

    if (setting(SETTINGS.autoArmorRefill)) {
      // Armor refills to base. The Brace bonus expires now and is not refilled — it was
      // bought for one turn.
      await refillArmor(actor);
    }

    if (actor.statuses.has("suffocating")) await promptSuffocation(actor);
  }

  /** @inheritDoc */
  async _onEndTurn(combatant, context) {
    await super._onEndTurn(combatant, context);
    const actor = combatant?.actor;
    if (!actor) return;

    // Only people are corrupted by the Unknown. Horrors thrive in it and constructs
    // ignore it.
    if (setting(SETTINGS.autoUnknownExposure) && isHumanLike(actor) && !isWarded(actor)) {
      await promptUnknownExposure(actor);
    }

    await clearConditions(actor, ["dazed", "invigorated"]);
  }
}

/* -------------------------------------------- */

/**
 * Whether the Unknown has anything to work on.
 *
 * A Delver has no `creatureType` field at all, so testing `type !== "construct"` would
 * be reading the wrong property and would exempt nobody.
 *
 * @param {Actor} actor
 * @returns {boolean}
 */
export function isHumanLike(actor) {
  return actor.type === "delver" || actor.system.creatureType === "human";
}

/* -------------------------------------------- */

/**
 * Whether this combatant still has the given action available this turn.
 *
 * @param {Combatant} combatant
 * @param {"major"|"minor"} cost
 * @returns {boolean}
 */
export function hasActionAvailable(combatant, cost) {
  if (!combatant || cost === "free") return true;
  const key = cost === "major" ? FLAGS.majorUsed : FLAGS.minorUsed;
  return !combatant.getFlag(SYSTEM_ID, key);
}

/**
 * The combatant for an actor in whichever started encounter holds it, or null.
 *
 * This deliberately does **not** rely on `game.combat` alone. That getter resolves from
 * the *viewed* scene and returns null whenever the viewer is looking somewhere else —
 * which silently turned "no combatant" into "no action economy" and handed out unlimited
 * major actions. The active encounter is still tried first, so a creature in two
 * encounters resolves to the one being played.
 *
 * @param {Actor} actor
 * @returns {Combatant|null}
 */
export function combatantFor(actor) {
  const seen = new Set();
  for (const combat of [game.combat, ...game.combats]) {
    if (!combat?.started || seen.has(combat.id)) continue;
    seen.add(combat.id);

    const combatants = combat.getCombatantsByActor(actor);
    const match = actor.isToken
      ? (combatants.find((c) => c.tokenId === actor.token.id) ?? combatants[0])
      : combatants[0];
    if (match) return match;
  }
  return null;
}

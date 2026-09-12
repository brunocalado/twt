import { FLAGS, SETTINGS, SYSTEM_ID, TWT } from "./config.mjs";
import { setting } from "./settings.mjs";
import { requestTest } from "./test-flow.mjs";
import { damage, healActor } from "./damage.mjs";
import { setCondition } from "./effects.mjs";
import { postActionCard } from "./chat.mjs";
import { combatantFor, hasActionAvailable } from "../documents/combat.mjs";

/**
 * One entry point for every combat action, reached from the sheet's combat bar, the
 * token context menu and compendium macros.
 *
 * Each action does the same five things in the same order: check the economy, open the
 * test dialog prefilled, apply the result through the Phase 04 pipeline, mark the action
 * used, and post one card. Spreading those steps across call sites is how an action ends
 * up free for one caller and not another.
 */

/* -------------------------------------------- */
/*  Economy                                     */
/* -------------------------------------------- */

/**
 * Spend an action, if there is one to spend.
 *
 * Combatant flags are GM-owned in most worlds, so the write goes through the delegation
 * path when this client cannot make it itself.
 *
 * @param {Actor} actor
 * @param {"major"|"minor"|"free"} cost
 * @returns {Promise<boolean>}  False when the action was already spent.
 */
export async function spendAction(actor, cost) {
  if (cost === "free") return true;

  const combatant = combatantFor(actor);
  // Outside an encounter the economy is the table's business, not the system's.
  if (!combatant) return true;

  if (!hasActionAvailable(combatant, cost)) {
    ui.notifications.warn(
      game.i18n.format("TWT.Warning.ActionSpent", {
        cost: game.i18n.localize(TWT.actionTypes[cost])
      })
    );
    return false;
  }

  const key = cost === "major" ? FLAGS.majorUsed : FLAGS.minorUsed;
  if (combatant.isOwner) await combatant.setFlag(SYSTEM_ID, key, true);
  return true;
}

/**
 * Hand an action back — the pip the sheet lets a player clear by hand, because the rules
 * grant more exceptions than the system can model.
 *
 * @param {Actor} actor
 * @param {"major"|"minor"} cost
 * @returns {Promise<void>}
 */
export async function refundAction(actor, cost) {
  const combatant = combatantFor(actor);
  if (!combatant?.isOwner) return;
  const key = cost === "major" ? FLAGS.majorUsed : FLAGS.minorUsed;
  await combatant.setFlag(SYSTEM_ID, key, false);
}

/* -------------------------------------------- */
/*  The generic action                          */
/* -------------------------------------------- */

/**
 * Perform one of the catalogued actions.
 *
 * @param {Actor} actor
 * @param {string} id                 A key of `TWT.majorActions` or `TWT.minorActions`.
 * @param {object} [options]
 * @param {boolean} [options.skipDialog=false]
 * @returns {Promise<object|null>}
 */
export async function performAction(actor, id, options = {}) {
  const major = TWT.majorActions[id];
  const action = major ?? TWT.minorActions[id];
  if (!action) throw new Error(`Unknown TWT action "${id}"`);

  const cost = major ? "major" : "minor";
  if (id === "attack") return performAttack(actor, options);

  // Shine is pure allocation. Repel allocates *first* and then rolls, which is explicit
  // in the rules and matters: the zones it damages are the ones just lit.
  if (id === "shine" || id === "repel") {
    const { TWTWardAllocation } = await import("../sheets/ward-allocation.mjs");
    const app = TWTWardAllocation.open({ mode: "zones", actor });
    // Shine is the whole action; Repel carries on to its test once the light is placed.
    if (app) await app.promise;
    if (id === "shine") return { ok: true, allocated: true };
  }

  if (!(await spendAction(actor, cost))) return null;

  // Some actions are simply declared. They still post a card, so the table sees them.
  if (!action.trait) {
    await postActionCard(actor, { id, action, cost });
    return { ok: true, declared: true };
  }

  const rolled = await requestTest(actor, {
    trait: action.trait,
    skill: action.skill,
    difficulty: action.difficulty ?? 2,
    kind: action.kind ?? "other",
    label: game.i18n.localize(action.label),
    extraModifiers: action.modifiers,
    ...options
  });
  if (!rolled) {
    // The dialog was dismissed, so the action was never actually taken.
    await refundAction(actor, cost);
    return null;
  }

  const effect = await applyActionEffect(actor, id, action, rolled.result);
  await postActionCard(actor, { id, action, cost, result: rolled.result, effect });
  return { ok: true, result: rolled.result, effect };
}

/**
 * What each action does once its dice have landed.
 *
 * Only the mechanical consequences live here. Anything positional — which zone was
 * entered, who was shoved where — is the table's, because the system does not model the
 * zone map.
 *
 * @param {Actor} actor
 * @param {string} id
 * @param {object} action
 * @param {object} result
 * @returns {Promise<object>}
 */
async function applyActionEffect(actor, id, action, result) {
  switch (id) {
    case "brace": {
      if (!result.success) return { armorGained: 0 };
      // A boon buys another point of it, so the surplus is not wasted on a hit.
      const gained = 1 + result.boons;
      await actor.update({ "system.armor.temp": actor.system.armor.temp + gained });
      return { armorGained: gained };
    }

    case "dash": {
      // A failure still lets the Delver move, just without the extra speed.
      return {
        extraSpeed: result.success ? 1 + result.boons : 0,
        movesAnyway: !result.success
      };
    }

    case "hide": {
      if (result.success) await setCondition(actor, "hidden", { active: true });
      return { hidden: result.success };
    }

    case "direct": {
      // Invigorating an ally is a targeting decision, so the card names how many may be
      // invigorated and the Keeper applies it.
      return { allies: result.success ? 1 + result.boons : 0 };
    }

    case "shove": {
      return { zones: result.success ? 1 + result.boons : 0 };
    }

    case "grapple": {
      return { grappled: result.success };
    }

    case "breakGrapple": {
      if (result.success) {
        await setCondition(actor, "grappled", { active: false });
      }
      return { freed: result.success };
    }

    case "repel": {
      // The ward is assigned before the roll; what this returns is the damage the
      // horrors in those zones take.
      return { willDamage: result.success ? 1 : 0 };
    }

    default:
      return {};
  }
}

/* -------------------------------------------- */
/*  Attacking                                   */
/* -------------------------------------------- */

/**
 * The weapons a Delver actually has in hand, plus the ways to hit without one.
 *
 * @param {Actor} actor
 * @returns {object[]}
 */
export function attackOptions(actor) {
  const wielded = actor.items.filter(
    (i) =>
      i.type === "equipment" &&
      i.system.category === "weapon" &&
      i.system.equipState === "wielded" &&
      i.system.state !== "destroyed"
  );

  const options = wielded.map((item) => ({
    id: item.id,
    itemId: item.id,
    label: item.name,
    damage: item.system.weapon.damage,
    damageType: item.system.weapon.damageType,
    piercing: item.system.weapon.piercing,
    range: item.system.weapon.range,
    // Melee is Body in reach, ranged is Mind at range, thrown is Body at range.
    trait: item.system.weapon.attackTrait,
    modifier: 0,
    heavy: item.system.heavy,
    doubleWielded: item.system.doubleWielded
  }));

  // Anything else in hand can be swung. A real record swung improvised is the case that
  // matters: a failed swing breaks it, and the system can only write that when it knows
  // which record was used.
  const improvisable = actor.items.filter(
    (i) =>
      i.type === "equipment" &&
      i.system.category !== "weapon" &&
      i.system.equipState === "wielded" &&
      i.system.state !== "destroyed"
  );
  for (const item of improvisable) {
    const spec = item.system.heavy
      ? TWT.improvisedAttacks.improvisedHeavy
      : TWT.improvisedAttacks.improvised;
    options.push({
      id: `improvised:${item.id}`,
      itemId: item.id,
      label: game.i18n.format("TWT.Attack.ImprovisedWith", { name: item.name }),
      damage: spec.damage,
      damageType: spec.damageType,
      piercing: false,
      range: 0,
      trait: "body",
      modifier: spec.modifier,
      improvised: true,
      heavy: !!item.system.heavy,
      boon: spec.boon
    });
  }

  // Unarmed, and swinging at scenery the system has no record of.
  for (const [key, spec] of Object.entries(TWT.improvisedAttacks)) {
    options.push({
      id: key,
      itemId: null,
      label: game.i18n.localize(spec.label),
      damage: spec.damage,
      damageType: spec.damageType,
      piercing: false,
      range: 0,
      trait: "body",
      modifier: spec.modifier,
      improvised: key !== "unarmed",
      unarmed: key === "unarmed",
      boon: spec.boon
    });
  }

  return options;
}

/**
 * Make an attack.
 *
 * @param {Actor} actor
 * @param {object} [options]
 * @param {string} [options.weaponId]   An equipped weapon's id, or an improvised key.
 * @param {Actor} [options.target]      Defaults to the first targeted token's actor.
 * @param {boolean} [options.free=false]  A Flurry attack costs no action.
 * @returns {Promise<object|null>}
 */
export async function performAttack(actor, { weaponId, target, free = false, ...options } = {}) {
  if (!free && !(await spendAction(actor, "major"))) return null;

  const choices = attackOptions(actor);
  const weapon = choices.find((c) => c.id === weaponId) ?? choices[0];
  const targetActor = target ?? game.user.targets.first()?.actor ?? null;

  // Every target has a target difficulty, a Delver included (R6), defaulting to 2M.
  const difficulty = targetActor?.system.targetDifficulty ?? 2;

  const rolled = await requestTest(actor, {
    trait: weapon.trait,
    skill: "violence",
    difficulty,
    modifier: weapon.modifier,
    kind: "attack",
    label: game.i18n.format("TWT.Attack.Label", { weapon: weapon.label }),
    ...options
  });
  if (!rolled) {
    if (!free) await refundAction(actor, "major");
    return null;
  }

  const result = rolled.result;
  const outcome = { weapon, target: targetActor, hit: result.success, boons: result.boons };

  if (result.success && targetActor) {
    outcome.damage = await damage(targetActor, {
      amount: weapon.damage,
      type: weapon.damageType,
      piercing: weapon.piercing,
      source: weapon.label
    });
  } else if (!result.success && weapon.improvised && weapon.itemId) {
    // A failed improvised swing breaks what was swung — but only when it is a real
    // record. Scenery is narrated, not written.
    const item = actor.items.get(weapon.itemId);
    if (item && item.system.state === "normal") {
      await item.update({ "system.state": "exhausted" });
      outcome.exhausted = item.name;
    }
  }

  await postActionCard(actor, {
    id: "attack",
    action: TWT.majorActions.attack,
    cost: free ? "free" : "major",
    result,
    effect: outcome,
    attack: true
  });

  return { ok: true, result, outcome };
}

/* -------------------------------------------- */

/**
 * Which attack boons this attack could actually buy.
 *
 * Cleave without a heavy weapon and Flurry without a second weapon are not choices the
 * rules offer, so they are not listed rather than listed and refused.
 *
 * @param {Actor} actor
 * @param {object} weapon    The weapon used, from {@link attackOptions}.
 * @param {number} boons     Boons available.
 * @returns {object[]}
 */
export function availableAttackBoons(actor, weapon, boons) {
  const combatant = combatantFor(actor);
  const flurried = combatant?.getFlag(SYSTEM_ID, "flurried") === true;

  const others = attackOptions(actor).filter((o) => o.itemId && o.itemId !== weapon.itemId);

  return Object.entries(TWT.attackBoons)
    .map(([id, spec]) => ({ id, ...spec }))
    .filter((spec) => {
      if (spec.cost > boons) return false;
      if (spec.requires === "heavyWeapon" && !weapon.heavy) return false;
      if (spec.requires === "secondWeapon" && !others.length) return false;
      if (spec.oncePerTurn && flurried) return false;
      return true;
    });
}

/**
 * Spend an attack boon.
 *
 * @param {Actor} actor
 * @param {string} boonId
 * @param {object} context  `{ weapon, target, damageOutcome }`.
 * @returns {Promise<object>}
 */
export async function spendAttackBoon(actor, boonId, { weapon, target, weaponId } = {}) {
  const spec = TWT.attackBoons[boonId];
  if (!spec) throw new Error(`Unknown attack boon "${boonId}"`);

  switch (boonId) {
    case "deadly": {
      if (!target) return { ok: false, reason: "no-target" };
      const hit = await damage(target, {
        amount: spec.bonusDamage,
        type: weapon?.damageType ?? "body",
        piercing: weapon?.piercing ?? false,
        source: game.i18n.localize(spec.label)
      });
      return { ok: true, damage: hit };
    }

    case "flurry": {
      const combatant = combatantFor(actor);
      if (combatant?.isOwner) await combatant.setFlag(SYSTEM_ID, "flurried", true);
      // The free swing is a whole attack of its own, with the other weapon.
      const others = attackOptions(actor).filter((o) => o.itemId && o.itemId !== weaponId);
      return performAttack(actor, { weaponId: others[0]?.id, target, free: true });
    }

    case "cleave": {
      // A second creature in the target's zone is a positional call, so the card names
      // the damage and the Keeper picks who takes it.
      return { ok: true, cleaveDamage: weapon?.damage ?? 0 };
    }

    default:
      return { ok: true };
  }
}

/* -------------------------------------------- */
/*  Turn prompts                                */
/* -------------------------------------------- */

/**
 * Suffocating: a 1M Body + Survival test at turn start, or 1 Body damage.
 *
 * @param {Actor} actor
 * @returns {Promise<object|null>}
 */
export async function promptSuffocation(actor) {
  const rolled = await requestTest(actor, {
    trait: "body",
    skill: "survival",
    difficulty: 1,
    label: game.i18n.localize("TWT.Condition.Suffocating"),
    skipDialog: true
  });
  if (!rolled) return null;

  if (!rolled.result.success) {
    await damage(actor, { amount: 1, type: "body", piercing: true, source: "TWT.Condition.Suffocating" });
  }
  return rolled.result;
}

/**
 * Unwarded at the end of a turn: the Unknown gets its look at you.
 *
 * @param {Actor} actor
 * @returns {Promise<object|null>}
 */
export async function promptUnknownExposure(actor) {
  const rolled = await requestTest(actor, {
    trait: "will",
    skill: "survival",
    difficulty: 2,
    label: game.i18n.localize("TWT.Unknown.Exposure"),
    skipDialog: true
  });
  if (!rolled) return null;

  if (!rolled.result.success) {
    await damage(actor, { amount: 1, type: "will", piercing: true, source: "TWT.Unknown.Source" });
  }
  return rolled.result;
}

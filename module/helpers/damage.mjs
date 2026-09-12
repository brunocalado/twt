import { FLAGS, SYSTEM_ID, TRAIT_KEYS } from "./config.mjs";
import { asGM, defineDelegate, resolveDelegated } from "./delegate.mjs";
import { postDamageCard } from "./chat.mjs";
import { runRecoveryTest } from "./recovery.mjs";

/**
 * The one entry point for damage. Attacks, strain, hazards, the Unknown and
 * adaptations all come through here, because this is where armor, overkill, Critical
 * death and the recovery trigger are decided. Scattering those checks across call
 * sites is how a rule quietly stops firing.
 *
 * The arithmetic lives in {@link computeDamage} alone, and every path — the single
 * hit, the multi-target batch, the dialog's preview line — reads it from there. That
 * is the whole reason the batch path is safe.
 */

/** Armor works "so long as it gets a rest between bludgeonings" — about a round. */
const ARMOR_REST_MS = 10_000;

/**
 * @typedef {object} DamageOutcome
 * @property {boolean} ok
 * @property {number}  incoming            As requested, before Vulnerable.
 * @property {number}  vulnerable          1 when the condition added to it.
 * @property {number}  amount              After Vulnerable.
 * @property {number}  absorbed            Soaked by armor.
 * @property {number}  applied             Actually taken off the health pool.
 * @property {number}  overkill            Excess past 0, captured before the clamp.
 * @property {string}  pool                A trait key for a Delver, `"hp"` for an NPC.
 * @property {number}  before
 * @property {number}  after
 * @property {boolean} died
 * @property {boolean} recoveryTriggered
 */

/* -------------------------------------------- */
/*  Delegation                                  */
/* -------------------------------------------- */

/**
 * Register the privileged form of this operation. A player attacking a GM-owned NPC
 * routes through here; a player damaging their own Delver runs it locally. One writer
 * either way.
 */
export function registerDamageDelegate() {
  defineDelegate("applyDamage", async (payload, { user }) => {
    const actor = await resolveDelegated(payload.actorUuid, user);
    if (!actor) return { ok: false, reason: "not-found" };
    // Clamp at the boundary: this payload crossed a socket from another client.
    return applyDamage(actor, {
      amount: Math.max(0, Math.floor(Number(payload.amount) || 0)),
      type: TRAIT_KEYS.includes(payload.type) ? payload.type : "body",
      piercing: payload.piercing === true,
      source: typeof payload.source === "string" ? payload.source.slice(0, 100) : undefined,
      silent: payload.silent === true
    });
  });
}

/**
 * Damage an actor, delegating to the Keeper when this client cannot write.
 *
 * @param {Actor} actor
 * @param {object} spec  See {@link applyDamage}.
 * @returns {Promise<DamageOutcome>}
 */
export function damage(actor, spec) {
  if (actor.isOwner) return applyDamage(actor, spec);
  return asGM("applyDamage", { ...spec, actorUuid: actor.uuid });
}

/* -------------------------------------------- */
/*  The arithmetic                              */
/* -------------------------------------------- */

/**
 * Work out what a hit does, writing nothing.
 *
 * Order of operations, and every step matters:
 *
 * 1. **Vulnerable** adds 1 first, so armor sees the increased number.
 * 2. **Armor** absorbs BODY damage on a non-piercing hit only, spending the Brace
 *    bonus before the refillable pool. MIND and WILL damage always bypass it.
 * 3. **An NPC has one pool.** The rules treat MIND and WILL damage against a creature
 *    as piercing BODY damage, which falls out of step 2 on its own.
 * 4. **Overkill is captured before the clamp** (R3). `hp.value` floors at 0, so the
 *    excess is gone by the time the write lands.
 * 5. **Critical death** (R2): a Critical Delver taking any damage on a trait whose
 *    health is *already* 0 dies. It has to be checked here rather than in the recovery
 *    test, because a pool already at 0 never "reaches" 0 again.
 *
 * @param {Actor} actor
 * @param {object} spec
 * @param {number} spec.amount
 * @param {"body"|"mind"|"will"} [spec.type]
 * @param {boolean} [spec.piercing=false]
 * @returns {object}  The numbers, plus the `updates` that would write them.
 */
function computeDamage(actor, { amount, type = "body", piercing = false }) {
  const isDelver = actor.type === "delver";
  const incoming = Math.max(0, Math.floor(Number(amount) || 0));

  const vulnerable = actor.statuses.has("vulnerable") ? 1 : 0;
  let remaining = incoming + vulnerable;

  const updates = {};
  let absorbed = 0;

  if (!piercing && type === "body") {
    const temp = isDelver ? actor.system.armor.temp : 0;
    const current = actor.system.armor.current;
    absorbed = Math.min(temp + current, remaining);
    remaining -= absorbed;

    const fromTemp = Math.min(temp, absorbed);
    if (isDelver && fromTemp) updates["system.armor.temp"] = temp - fromTemp;
    const fromCurrent = absorbed - fromTemp;
    if (fromCurrent) updates["system.armor.current"] = current - fromCurrent;
  }

  const path = isDelver ? `system.traits.${type}.hp.value` : "system.hp.value";
  const before = isDelver ? actor.system.traits[type].hp.value : actor.system.hp.value;
  const after = Math.max(0, before - remaining);
  updates[path] = after;

  return {
    ok: true,
    incoming,
    vulnerable,
    amount: incoming + vulnerable,
    absorbed,
    applied: Math.min(remaining, before),
    overkill: Math.max(0, remaining - before),
    pool: isDelver ? type : "hp",
    type,
    before,
    after,
    // A Delver that just ran out rolls to recover; an NPC simply dies.
    criticalDeath: isDelver && actor.statuses.has("critical") && before === 0 && remaining > 0,
    reachedZero: after === 0 && before > 0,
    isDelver,
    updates
  };
}

/**
 * The arithmetic a damage dialog previews, with nothing written.
 *
 * @param {Actor} actor
 * @param {object} spec  `{ amount, type, piercing }`.
 * @returns {object}
 */
export function previewDamage(actor, spec) {
  const { updates: _updates, ...numbers } = computeDamage(actor, spec);
  return { ...numbers, kills: numbers.criticalDeath || (!numbers.isDelver && numbers.reachedZero) };
}

/* -------------------------------------------- */
/*  Applying it                                 */
/* -------------------------------------------- */

/**
 * Apply damage. Assumes this client may write to `actor` — call {@link damage} when
 * that is not already settled.
 *
 * @param {Actor} actor
 * @param {object} spec
 * @param {number} spec.amount
 * @param {"body"|"mind"|"will"} [spec.type]
 * @param {boolean} [spec.piercing=false]  Ignores armor.
 * @param {string} [spec.source]           Named on the chat card.
 * @param {boolean} [spec.silent=false]    Skip the card.
 * @param {number} [spec.depth=0]          Re-entry guard for the no-slot adaptation path.
 * @returns {Promise<DamageOutcome>}
 */
export async function applyDamage(actor, spec) {
  await restArmorIfIdle(actor);

  const calc = computeDamage(actor, spec);
  await actor.update(calc.updates);

  return resolveOutcome(actor, calc, spec);
}

/**
 * Apply one damage spec to several actors with a single batched health write.
 *
 * The per-actor arithmetic still comes from {@link computeDamage}, so the rules are in
 * one place; what is batched is the database traffic, which would otherwise be one
 * round trip per target. The triggers that follow — death, recovery tests, cards — are
 * inherently per-actor and run after the write lands.
 *
 * @param {Actor[]} actors
 * @param {object} spec
 * @returns {Promise<DamageOutcome[]>}
 */
export async function applyDamageToMany(actors, spec) {
  // Anything we cannot write to goes the delegated route individually.
  const own = actors.filter((a) => a.isOwner);
  const delegated = actors.filter((a) => !a.isOwner);

  const outcomes = [];
  for (const actor of delegated) outcomes.push(await damage(actor, spec));

  if (own.length) {
    for (const actor of own) await restArmorIfIdle(actor);

    const calcs = own.map((actor) => ({ actor, calc: computeDamage(actor, spec) }));
    await Actor.implementation.updateDocuments(
      calcs.map(({ actor, calc }) => ({ _id: actor.id, ...calc.updates }))
    );
    for (const { actor, calc } of calcs) outcomes.push(await resolveOutcome(actor, calc, spec));
  }

  return outcomes;
}

/**
 * Everything that happens after the health write: the hit timestamp, death, the
 * recovery trigger, and the card.
 *
 * @param {Actor} actor
 * @param {object} calc   A {@link computeDamage} result, already written.
 * @param {object} spec
 * @returns {Promise<DamageOutcome>}
 */
async function resolveOutcome(actor, calc, { source, silent = false, depth = 0 }) {
  const { updates: _updates, criticalDeath, reachedZero, isDelver, ...outcome } = calc;
  outcome.source = source;
  outcome.died = false;
  outcome.recoveryTriggered = false;

  if (outcome.applied > 0) await actor.setFlag(SYSTEM_ID, FLAGS.lastHitAt, Date.now());

  if (criticalDeath) {
    outcome.died = true;
    outcome.cause = "critical";
    await markDead(actor);
  } else if (reachedZero && isDelver) {
    outcome.recoveryTriggered = true;
    // The card goes out before the recovery test, so chat reads in the order the
    // table experiences it: the hit, then the scramble to survive it.
    if (!silent) await postDamageCard(actor, outcome);
    outcome.recovery = await runRecoveryTest(actor, {
      trait: outcome.pool,
      overkill: outcome.overkill,
      depth
    });
    return outcome;
  } else if (reachedZero) {
    outcome.died = true;
    outcome.cause = "hp";
    await markDead(actor);
  }

  if (!silent) await postDamageCard(actor, outcome);
  return outcome;
}

/* -------------------------------------------- */
/*  Armor                                       */
/* -------------------------------------------- */

/**
 * Refill armor when it has had its rest: no combat running, and more than about a
 * round of real time since the last hit. A flag timestamp rather than a timer, so
 * nothing has to be ticking for this to come out right.
 *
 * @param {Actor} actor
 * @returns {Promise<void>}
 */
async function restArmorIfIdle(actor) {
  if (game.combat?.started) return;
  const last = actor.getFlag(SYSTEM_ID, FLAGS.lastHitAt) ?? 0;
  if (Date.now() - last < ARMOR_REST_MS) return;
  await refillArmor(actor);
}

/**
 * Restore armor to its full value and clear any Brace bonus. Called at the start of a
 * combatant's turn, and by the out-of-combat rest above.
 *
 * @param {Actor} actor
 * @returns {Promise<void>}
 */
export async function refillArmor(actor) {
  const updates = {};
  if (actor.system.armor.current !== actor.system.armor.base) {
    updates["system.armor.current"] = actor.system.armor.base;
  }
  if (actor.type === "delver" && actor.system.armor.temp) updates["system.armor.temp"] = 0;
  if (!foundry.utils.isEmpty(updates)) await actor.update(updates);
}

/* -------------------------------------------- */
/*  Death and healing                           */
/* -------------------------------------------- */

/**
 * Mark an actor dead: Unconscious, and defeated in the tracker if it is in a fight.
 *
 * The system does no more than that. Whether a dead Delver becomes a puppet of the
 * Unknown, and whether a corpse is deleted, is the Keeper's call, not an automation's.
 *
 * @param {Actor} actor
 * @returns {Promise<void>}
 */
async function markDead(actor) {
  if (!actor.statuses.has("unconscious")) {
    await actor.toggleStatusEffect("unconscious", { active: true });
  }

  // Only the GM may write a Combatant, and this can be reached from a player's attack.
  if (!game.user.isGM) return;
  const combatants = game.combats
    .map((combat) => combat.getCombatantsByActor(actor))
    .flat()
    .filter((c) => c && !c.defeated);
  for (const combatant of combatants) await combatant.update({ defeated: true });
}

/**
 * Heal a health pool. Separate from the damage pipeline because healing has none of
 * it: no armor, no overkill, no triggers.
 *
 * @param {Actor} actor
 * @param {object} spec
 * @param {number} spec.amount
 * @param {"body"|"mind"|"will"} [spec.type]
 * @returns {Promise<{ok: boolean, before: number, after: number}>}
 */
export async function healActor(actor, { amount, type = "body" }) {
  const isDelver = actor.type === "delver";
  const pool = isDelver ? actor.system.traits[type].hp : actor.system.hp;
  const path = isDelver ? `system.traits.${type}.hp.value` : "system.hp.value";
  const before = pool.value;
  const after = Math.min(pool.max, before + Math.max(0, Math.floor(amount)));
  if (after !== before) await actor.update({ [path]: after });
  return { ok: true, before, after };
}

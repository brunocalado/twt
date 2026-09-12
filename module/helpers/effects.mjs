/**
 * The fifteen conditions, as Foundry status effects.
 *
 * There is **no boolean mirror** anywhere on the data models, Critical included, so
 * `actor.statuses` is the one source of truth. A mirrored flag would be a second one,
 * and it would drift.
 */

/**
 * Every condition, in the order the Quickstart prints them.
 *
 * `img` and `name`, never `icon` and `label` — the latter are deprecated aliases.
 * @type {{id: string, name: string, img: string}[]}
 */
export const TWT_CONDITIONS = [
  { id: "blinded", name: "TWT.Condition.Blinded", img: "icons/svg/blind.svg" },
  { id: "critical", name: "TWT.Condition.Critical", img: "icons/svg/skull.svg" },
  { id: "dazed", name: "TWT.Condition.Dazed", img: "icons/svg/daze.svg" },
  { id: "fatigued", name: "TWT.Condition.Fatigued", img: "icons/svg/sleep.svg" },
  { id: "grappled", name: "TWT.Condition.Grappled", img: "icons/svg/net.svg" },
  { id: "grappling", name: "TWT.Condition.Grappling", img: "icons/svg/thrust.svg" },
  { id: "hidden", name: "TWT.Condition.Hidden", img: "icons/svg/invisible.svg" },
  { id: "immobilized", name: "TWT.Condition.Immobilized", img: "icons/svg/paralysis.svg" },
  { id: "invigorated", name: "TWT.Condition.Invigorated", img: "icons/svg/upgrade.svg" },
  { id: "muted", name: "TWT.Condition.Muted", img: "icons/svg/silenced.svg" },
  { id: "prone", name: "TWT.Condition.Prone", img: "icons/svg/falling.svg" },
  { id: "slowed", name: "TWT.Condition.Slowed", img: "icons/svg/downgrade.svg" },
  { id: "suffocating", name: "TWT.Condition.Suffocating", img: "icons/svg/degen.svg" },
  { id: "unconscious", name: "TWT.Condition.Unconscious", img: "icons/svg/unconscious.svg" },
  { id: "vulnerable", name: "TWT.Condition.Vulnerable", img: "icons/svg/hazard.svg" }
];

/** The speed ladder. Slowed steps one place down it. */
export const SPEED_LADDER = [0, 0.5, 1, 2];

/** Conditions that clear the moment their holder rolls a test. */
const CLEARS_ON_TEST = ["dazed", "invigorated"];

/* -------------------------------------------- */

/**
 * Replace core's condition list with this system's.
 *
 * The default value of `CONFIG.statusEffects` is a **Proxy** that also indexes every
 * entry by its id, and `ActiveEffect.fromStatusEffect` looks up
 * `CONFIG.statusEffects[statusId]`. Assigning a plain array over it makes every such
 * lookup return undefined; clearing and pushing keeps the Proxy, and its `set` trap
 * handles `length = 0` by dropping the id keys too.
 */
export function registerConditions() {
  CONFIG.statusEffects.length = 0;
  for (const condition of TWT_CONDITIONS) CONFIG.statusEffects.push(condition);
}

/* -------------------------------------------- */

/**
 * Turn a condition on or off.
 *
 * @param {Actor} actor
 * @param {string} id                   A condition id from {@link TWT_CONDITIONS}.
 * @param {object} [options]
 * @param {boolean} [options.active]    Omit to toggle.
 * @returns {Promise<ActiveEffect|boolean|void>}
 */
export function setCondition(actor, id, { active } = {}) {
  return actor.toggleStatusEffect(id, { active });
}

/**
 * @param {Actor} actor
 * @param {string} id
 * @returns {boolean}
 */
export function hasCondition(actor, id) {
  return actor.statuses.has(id);
}

/* -------------------------------------------- */

/**
 * Clear conditions — every one this system defines, or just the named ones.
 *
 * One `deleteEmbeddedDocuments` rather than a toggle per condition, which would be
 * fifteen server round trips for a Safe Rest.
 *
 * @param {Actor} actor
 * @param {string[]} [only]  Condition ids to clear. Omit to clear all of them.
 * @returns {Promise<string[]>}  The ids actually cleared.
 */
export async function clearConditions(actor, only) {
  const ids = only ?? TWT_CONDITIONS.map((c) => c.id);
  const effects = actor.effects.filter((e) => e.statuses.some((s) => ids.includes(s)));
  if (!effects.length) return [];
  await actor.deleteEmbeddedDocuments("ActiveEffect", effects.map((e) => e.id));
  return effects.flatMap((e) => [...e.statuses].filter((s) => ids.includes(s)));
}

/**
 * Drop the conditions that expire the moment their holder rolls. Called from the
 * test pipeline; the turn-end path clears them again from the combat lifecycle.
 *
 * @param {Actor} actor
 * @returns {Promise<string[]>}  The condition ids cleared.
 */
export async function clearOnTestConditions(actor) {
  const cleared = CLEARS_ON_TEST.filter((id) => actor.statuses.has(id));
  for (const id of cleared) await actor.toggleStatusEffect(id, { active: false });
  return cleared;
}

/* -------------------------------------------- */

/**
 * The difficulty modifiers an actor's conditions contribute to one test, each with
 * the reason named so the roller can see and override it.
 *
 * Nothing here is baked into the data model: a modifier is a property of a test, not
 * of an actor, and Blinded and Hidden depend on fiction the system cannot read — so
 * those are offered unchecked, for the roller to confirm.
 *
 * @param {Actor} actor
 * @param {object} [context]
 * @param {string} [context.trait]        The trait being tested.
 * @param {"attack"|"melee"|"ranged"|"project"|"other"} [context.kind]
 * @returns {{id: string, label: string, value: number, suggested: boolean}[]}
 */
export function collectTestModifiers(actor, { trait, kind = "other" } = {}) {
  const mods = [];
  const statuses = actor.statuses;

  if (statuses.has("critical")) {
    mods.push({ id: "critical", label: "TWT.Condition.Critical", value: 1, suggested: true });
  }
  if (statuses.has("dazed")) {
    mods.push({ id: "dazed", label: "TWT.Condition.Dazed", value: 1, suggested: true });
  }
  if (statuses.has("invigorated")) {
    mods.push({ id: "invigorated", label: "TWT.Condition.Invigorated", value: -1, suggested: true });
  }
  if (statuses.has("prone") && trait === "body") {
    mods.push({ id: "prone", label: "TWT.Condition.Prone", value: 1, suggested: true });
  }
  if (statuses.has("grappled") && kind === "attack") {
    mods.push({ id: "grappled", label: "TWT.Condition.Grappled", value: 1, suggested: true });
  }

  // Offered, not assumed: whether the action depends on sight, or whether attacking
  // gives a hidden Delver away, is the table's call.
  if (statuses.has("blinded")) {
    mods.push({ id: "blinded", label: "TWT.Modifier.BlindedSight", value: 1, suggested: false });
  }

  return mods;
}

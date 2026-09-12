import { FLAGS, SYSTEM_ID, TWT } from "./config.mjs";
import { deserializeTest, performTest, strainTest } from "./roll.mjs";
import { postTestCard, updateTestCard } from "./chat.mjs";
import { clearOnTestConditions } from "./effects.mjs";
import { TWTTestDialog } from "../sheets/test-dialog.mjs";
import { attackOptions, availableAttackBoons, spendAttackBoon } from "./actions.mjs";

/**
 * Ties the dialog, the engine and the chat card together.
 *
 * The engine stays a pure function of its inputs and the dialog stays a pure collector,
 * so this is the one place that knows a test involves all three — plus the conditions a
 * roll burns off on its way out.
 */

/**
 * Ask for a test, roll it, and post the card.
 *
 * @param {Actor} actor
 * @param {object} [options]
 * @param {string} [options.trait]
 * @param {string} [options.skill]
 * @param {number} [options.difficulty=2]
 * @param {string} [options.label]
 * @param {string} [options.kind]
 * @param {boolean} [options.skipDialog=false]  Roll straight away with what was passed.
 * @returns {Promise<{result: object, message: ChatMessage}|null>}  Null if dismissed.
 */
export async function requestTest(actor, options = {}) {
  let params = options;

  if (!options.skipDialog) {
    params = await TWTTestDialog.prompt({ actor, ...options });
    if (!params) return null;
    params.kind = options.kind ?? params.kind;
  } else {
    params = {
      trait: options.trait ?? "body",
      skill: options.skill ?? "violence",
      traitScore: traitScoreOf(actor, options.trait ?? "body"),
      skillScore: actor.system.skills[options.skill ?? "violence"] ?? 0,
      difficulty: options.difficulty ?? 2,
      modifier: options.modifier ?? 0,
      assistDice: options.assistDice ?? 0,
      label: options.label ?? "",
      kind: options.kind ?? "other"
    };
  }

  const result = await performTest(params.traitScore, params.skillScore, params.difficulty, {
    assistDice: params.assistDice,
    modifier: params.modifier
  });

  const context = {
    actorUuid: actor.uuid,
    actorType: actor.type,
    trait: params.trait,
    skill: params.skill,
    kind: params.kind,
    label: params.label,
    assistDice: params.assistDice,
    assistName: params.assistName
  };

  const message = await postTestCard(result, context, actor);

  // Dazed and Invigorated are spent by the act of testing, whatever the outcome.
  if (actor.isOwner) await clearOnTestConditions(actor);

  return { result, message };
}

/**
 * A trait score, flattened across both actor types.
 * @param {Actor} actor
 * @param {string} trait
 * @returns {number}
 */
function traitScoreOf(actor, trait) {
  return actor.type === "delver" ? actor.system.traits[trait].score : actor.system.traits[trait];
}

/* -------------------------------------------- */
/*  Card buttons                                */
/* -------------------------------------------- */

/**
 * Wire a test card's controls. Called for every rendered message on every client, so it
 * attaches listeners and nothing else — what each button *does* is guarded at click time,
 * because two clients can race the same card.
 *
 * @param {ChatMessage} message
 * @param {HTMLElement} html
 */
export function activateTestCard(message, html) {
  const flag = message.getFlag(SYSTEM_ID, FLAGS.test);
  if (!flag) return;

  const strainButton = html.querySelector('[data-twt-action="strain"]');
  if (strainButton) {
    // The button only renders when the card was built for an owner, but a re-render on
    // another client could still paint it, so ownership is re-checked here.
    const actor = resolveActor(flag);
    if (!actor?.isOwner || actor.type !== "delver") strainButton.remove();
    else strainButton.addEventListener("click", () => onStrain(message, strainButton));
  }

  const boonButton = html.querySelector('[data-twt-action="spendBoons"]');
  if (boonButton) boonButton.addEventListener("click", () => onSpendBoons(message));
}

/**
 * @param {object} flag  A serialized test.
 * @returns {Actor|null}
 */
function resolveActor(flag) {
  return foundry.utils.fromUuidSync(flag.context?.actorUuid) ?? null;
}

/* -------------------------------------------- */

/**
 * Strain: pick dice, reroll them, take 1 MIND damage, and update the card in place.
 *
 * @param {ChatMessage} message
 * @param {HTMLElement} button
 */
async function onStrain(message, button) {
  // Re-read at click time: another client may have strained this card already.
  const flag = message.getFlag(SYSTEM_ID, FLAGS.test);
  if (!flag || flag.strained) {
    ui.notifications.warn("TWT.Warning.AlreadyStrained", { localize: true });
    return;
  }

  const actor = resolveActor(flag);
  if (!actor?.isOwner) return;

  const indices = await promptDiceSelection(flag);
  if (!indices?.length) return;

  button.disabled = true;
  try {
    const next = await strainTest(deserializeTest(flag), indices, actor);
    // The strain roll has to reach the message too, so keep both.
    next.rolls = [...message.rolls, ...next.rolls];
    await updateTestCard(message, next, flag.context);
  } finally {
    button.disabled = false;
  }
}

/**
 * Ask which dice to reroll.
 *
 * @param {object} flag  A serialized test.
 * @returns {Promise<number[]|null>}
 */
async function promptDiceSelection(flag) {
  const rows = flag.faces
    .map(
      (face, index) => `
      <label class="twt-die-pick">
        <input type="checkbox" name="die" value="${index}">
        <span class="twt-die${face >= 5 ? " is-mark" : ""}">${face}</span>
      </label>`
    )
    .join("");

  const content = `
    <p class="twt-dialog-lead">${game.i18n.localize("TWT.Strain.Prompt")}</p>
    <div class="twt-die-picker">${rows}</div>
    <p class="twt-dialog-note">${game.i18n.localize("TWT.Strain.Cost")}</p>`;

  const result = await foundry.applications.api.DialogV2.prompt({
    window: { title: "TWT.Strain.Title", icon: "fa-solid fa-brain" },
    classes: [SYSTEM_ID, "twt-dialog"],
    content,
    ok: {
      label: "TWT.Strain.Confirm",
      callback: (event, button) =>
        [...button.form.querySelectorAll('input[name="die"]:checked')].map((i) => Number(i.value))
    },
    rejectClose: false
  });

  return result;
}

/* -------------------------------------------- */

/**
 * Spend boons. They cannot be banked, so this is the only chance — the card lists what
 * the surplus can buy and records the choice, and the table adjudicates the fiction.
 *
 * @param {ChatMessage} message
 */
async function onSpendBoons(message) {
  const flag = message.getFlag(SYSTEM_ID, FLAGS.test);
  if (!flag?.boons) return;

  const actor = resolveActor(flag);
  const options = boonOptionsFor(flag.context?.kind, actor, flag.boons);
  if (!options.length) {
    ui.notifications.warn("TWT.Warning.NoBoonOptions", { localize: true });
    return;
  }
  const rows = options
    .map(
      (o) => `
      <label class="twt-boon-option">
        <input type="radio" name="boon" value="${o.id}" data-cost="${o.cost}">
        <span><strong>${game.i18n.localize(o.label)}</strong>
          <em>${game.i18n.format("TWT.Boon.Cost", { cost: o.cost })}</em><br>
          ${game.i18n.localize(o.hint)}</span>
      </label>`
    )
    .join("");

  const choice = await foundry.applications.api.DialogV2.prompt({
    window: { title: "TWT.Boon.Title", icon: "fa-solid fa-coins" },
    classes: [SYSTEM_ID, "twt-dialog"],
    content: `
      <p class="twt-dialog-lead">${game.i18n.format("TWT.Boon.Available", { boons: flag.boons })}</p>
      <div class="twt-boon-list">${rows}</div>
      <p class="twt-dialog-note">${game.i18n.localize("TWT.Boon.NoBanking")}</p>`,
    ok: {
      label: "TWT.Boon.Confirm",
      callback: (event, button) => button.form.querySelector('input[name="boon"]:checked')?.value
    },
    rejectClose: false
  });

  if (!choice) return;
  const option = options.find((o) => o.id === choice);
  if (!option || option.cost > flag.boons) {
    ui.notifications.warn("TWT.Warning.NotEnoughBoons", { localize: true });
    return;
  }

  // An attack boon has real mechanical consequences; the rest are narrative and only
  // need recording.
  if (TWT.attackBoons[option.id] && actor) {
    await spendAttackBoon(actor, option.id, {
      weapon: currentWeaponFor(actor),
      weaponId: currentWeaponFor(actor)?.itemId,
      target: game.user.targets.first()?.actor ?? null
    });
  }

  await ChatMessage.implementation.create({
    speaker: ChatMessage.implementation.getSpeaker({ actor }),
    content: `<p>${game.i18n.format("TWT.Boon.Spent", {
      cost: option.cost,
      name: game.i18n.localize(option.label)
    })}</p>`
  });

  // Boons are spent from the card's own surplus, so the card reflects what is left.
  const remaining = flag.boons - option.cost;
  const next = { ...flag, boons: remaining };
  await updateTestCard(message, deserializeTest(next), flag.context);
}

/**
 * What a surplus can buy.
 *
 * The combat maneuvers only appear on an attack and the project bonus only on a project,
 * because offering Cleave on a Culture test is noise. Attack costs come straight from
 * `TWT.attackBoons`: Flurry is 1, Cleave and Deadly are 2.
 *
 * @param {string} kind
 * @param {Actor} [actor]   When given, attack boons the actor cannot actually buy —
 *                          Cleave without a heavy weapon — are left out rather than
 *                          offered and refused.
 * @param {number} [boons]
 * @returns {{id: string, label: string, hint: string, cost: number}[]}
 */
export function boonOptionsFor(kind, actor, boons = Infinity) {
  const generic = [
    { id: "advantage", label: "TWT.Boon.Advantage", hint: "TWT.Boon.AdvantageHint", cost: 1 },
    { id: "detail", label: "TWT.Boon.Detail", hint: "TWT.Boon.DetailHint", cost: 1 }
  ];

  if (["attack", "melee", "ranged"].includes(kind)) {
    const combat = actor
      ? availableAttackBoons(actor, currentWeaponFor(actor), boons)
      : Object.entries(TWT.attackBoons).map(([id, spec]) => ({ id, ...spec }));
    return [...combat, ...generic];
  }

  if (kind === "project") {
    return [
      { id: "project", label: "TWT.Boon.Project", hint: "TWT.Boon.ProjectHint", cost: 1 },
      ...generic
    ];
  }

  return generic;
}

/**
 * The weapon an attack boon would be spent alongside: whatever is in hand.
 * @param {Actor} actor
 * @returns {object}
 */
function currentWeaponFor(actor) {
  return attackOptions(actor)[0] ?? {};
}

import { FLAGS, SYSTEM_ID, TEMPLATE_ROOT, TWT } from "./config.mjs";
import { serializeTest } from "./roll.mjs";

/**
 * The one visual standard for every message this system posts.
 *
 * A test result, a damage report, a recovery test, a Safe Rest and a shared record all
 * go through {@link buildCard}, so they come out as the same card: an accent-lit header
 * over dice chips, an outcome line, labelled prose and optional controls. The look is
 * styled by `_chat.scss` and shipped in the system stylesheet, so every client renders
 * it the same; the only thing a card carries inline is its accent colour.
 */

const CARD_TEMPLATE = `${TEMPLATE_ROOT}/chat/card.hbs`;

/**
 * Accent per card kind, taken from the Quickstart's own palette: its sage green for a
 * plain test, the rose it prints every number and every wound in for damage, the fog's
 * teal for a recovery, lantern light for a rest, and the steel of a Keeper aside for a
 * record. These are the literal values of `--twt-green` and friends in `utils/_colors`,
 * repeated here because a chat card carries its accent inline.
 */
const ACCENTS = {
  test: "#69ae78",
  damage: "#a53e6b",
  recovery: "#4f8a8b",
  rest: "#8fd46f",
  item: "#4c687e"
};

/* -------------------------------------------- */

/**
 * Render the shared card layout.
 *
 * @param {object} data
 * @param {string} data.title
 * @param {string} [data.subtitle]
 * @param {string} [data.img]
 * @param {string} [data.badge]
 * @param {string} [data.accent]
 * @param {{face: number, mark: boolean, rerolled: boolean}[]} [data.dice]
 * @param {string} [data.outcome]
 * @param {boolean} [data.success]
 * @param {{label: string, value: string}[]} [data.stats]
 * @param {{label?: string, content: string}[]} [data.sections]
 * @param {{action: string, label: string, icon?: string}[]} [data.controls]
 * @param {string} [data.footer]
 * @returns {Promise<string>}
 */
export async function buildCard(data) {
  // An empty section (a record with no rules text) is dropped, so a card never renders
  // a labelled band with nothing under it.
  const sections = (data.sections ?? []).filter((s) => s.content?.toString().trim());
  const hasBody = !!(
    sections.length ||
    data.dice?.length ||
    data.stats?.length ||
    data.outcome ||
    data.controls?.length
  );
  return foundry.applications.handlebars.renderTemplate(CARD_TEMPLATE, {
    accent: ACCENTS.test,
    ...data,
    sections,
    hasBody
  });
}

/**
 * Build and post a card, honouring the user's current message mode so a blind or
 * private roll stays hidden.
 *
 * @param {object} data                 Card content — see {@link buildCard}.
 * @param {object} [options]
 * @param {Actor} [options.actor]       Speaker actor. A **document**, never an id.
 * @param {Roll[]} [options.rolls]      Attached rolls, which is what drives Dice So Nice.
 * @param {object} [options.flags]      Flags under the system scope.
 * @returns {Promise<ChatMessage>}
 */
export async function postCard(data, { actor, rolls = [], flags } = {}) {
  const content = await buildCard(data);

  // `getSpeaker` takes a document. Passing an id falls through to its
  // "infer from the controlled token" branch and silently attributes the message to
  // whatever the viewer happens to have selected.
  const messageData = {
    content,
    speaker: ChatMessage.implementation.getSpeaker({ actor }),
    rolls,
    ...(flags ? { flags: { [SYSTEM_ID]: flags } } : {})
  };

  // `applyMode` is the v14 name; `applyRollMode` is a deprecated shim, and the setting
  // behind it is now `core.messageMode` rather than `core.rollMode`.
  ChatMessage.implementation.applyMode(messageData);
  return ChatMessage.implementation.create(messageData);
}

/* -------------------------------------------- */
/*  Test cards                                  */
/* -------------------------------------------- */

/**
 * Turn a test result into the card's dice chips.
 *
 * @param {object} result  A test result or its restored flag.
 * @returns {{face: number, mark: boolean, rerolled: boolean, index: number}[]}
 */
function diceChips(result) {
  return result.faces.map((face, index) => ({
    face,
    index,
    mark: face >= 5,
    rerolled: result.rerolled?.includes(index) ?? false
  }));
}

/**
 * The card content for a test, built from the result alone so a strain re-renders it
 * identically.
 *
 * @param {object} result   A test result or its restored flag.
 * @param {object} context  `{ actorUuid, actorType, trait, skill, kind, label, assistDice, assistName }`.
 * @param {object} [options]
 * @param {boolean} [options.canStrain=false]
 * @returns {object}  Card data for {@link buildCard}.
 */
export function buildTestCard(result, context, { canStrain = false } = {}) {
  const traitLabel = game.i18n.localize(TWT.traits[context.trait]?.abbr ?? context.trait);
  const skillLabel = game.i18n.localize(TWT.skills[context.skill]?.label ?? context.skill);

  const stats = [
    { label: "TWT.Card.Pool", value: `${result.pool}` },
    { label: "TWT.Card.Marks", value: `${result.marks} / ${result.difficulty}M` }
  ];
  if (result.boons) stats.push({ label: "TWT.Card.Boons", value: `${result.boons}` });

  const sections = [];
  if (context.assistDice) {
    sections.push({
      label: "TWT.Card.Assist",
      content: game.i18n.format("TWT.Card.AssistLine", {
        name: context.assistName ?? "",
        dice: context.assistDice
      })
    });
  }
  // The floor is worth spelling out: a test eased below 1M stays at 1M and pays the
  // difference in boons instead.
  if (result.requested < 1) {
    sections.push({
      label: "TWT.Card.Floored",
      content: game.i18n.format("TWT.Card.FlooredLine", {
        requested: result.requested,
        bonus: result.bonusBoons
      })
    });
  }

  const controls = [];
  if (canStrain) {
    controls.push({ action: "strain", label: "TWT.Card.Strain", icon: "fa-solid fa-brain" });
  }
  if (result.boons > 0) {
    controls.push({ action: "spendBoons", label: "TWT.Card.SpendBoons", icon: "fa-solid fa-coins" });
  }

  return {
    kind: "test",
    accent: ACCENTS.test,
    title: context.label || `${traitLabel} + ${skillLabel}`,
    subtitle: game.i18n.format("TWT.Card.TestSubtitle", { difficulty: result.difficulty }),
    badge: result.strained ? game.i18n.localize("TWT.Card.Strained") : "",
    dice: diceChips(result),
    outcome: game.i18n.localize(result.success ? "TWT.Card.Success" : "TWT.Card.Failure"),
    success: result.success,
    stats,
    sections,
    controls
  };
}

/**
 * Post a test result.
 *
 * @param {object} result
 * @param {object} context
 * @param {Actor} [actor]
 * @returns {Promise<ChatMessage>}
 */
export async function postTestCard(result, context, actor) {
  // Only a Delver can strain, and only while the test has not already been strained.
  const canStrain = actor?.type === "delver" && !result.strained && actor.isOwner;
  const card = buildTestCard(result, context, { canStrain });
  return postCard(card, {
    actor,
    rolls: result.rolls,
    flags: { [FLAGS.test]: serializeTest(result, context) }
  });
}

/**
 * Re-render an existing test card in place from a new result. One `message.update()`,
 * so every client sees the strained outcome without a bespoke broadcast.
 *
 * @param {ChatMessage} message
 * @param {object} result
 * @param {object} context
 * @returns {Promise<ChatMessage>}
 */
export async function updateTestCard(message, result, context) {
  // A strained test can never be strained again, so the button is gone for everyone.
  const card = buildTestCard(result, context, { canStrain: false });
  return message.update({
    content: await buildCard(card),
    rolls: result.rolls,
    flags: { [SYSTEM_ID]: { [FLAGS.test]: serializeTest(result, context) } }
  });
}

/* -------------------------------------------- */
/*  Damage, recovery and rest                   */
/* -------------------------------------------- */

/**
 * Report a hit, spelling out the arithmetic so nobody has to reconstruct it.
 *
 * @param {Actor} actor
 * @param {object} outcome  A damage outcome.
 * @returns {Promise<ChatMessage>}
 */
export async function postDamageCard(actor, outcome) {
  const poolLabel =
    outcome.pool === "hp"
      ? game.i18n.localize("TWT.Card.Health")
      : game.i18n.localize(TWT.traits[outcome.pool]?.label ?? outcome.pool);

  const steps = [game.i18n.format("TWT.Card.DamageIncoming", { amount: outcome.incoming, pool: poolLabel })];
  if (outcome.vulnerable) {
    steps.push(game.i18n.format("TWT.Card.DamageVulnerable", { total: outcome.amount }));
  }
  if (outcome.absorbed) {
    steps.push(game.i18n.format("TWT.Card.DamageAbsorbed", { absorbed: outcome.absorbed }));
  }
  steps.push(
    game.i18n.format("TWT.Card.DamageApplied", {
      applied: outcome.applied,
      pool: poolLabel,
      before: outcome.before,
      after: outcome.after
    })
  );
  if (outcome.overkill) {
    steps.push(game.i18n.format("TWT.Card.DamageOverkill", { overkill: outcome.overkill }));
  }

  let outcomeLine = "";
  if (outcome.died) outcomeLine = game.i18n.localize("TWT.Card.Died");
  else if (outcome.recoveryTriggered) outcomeLine = game.i18n.localize("TWT.Card.PoolEmpty");

  return postCard(
    {
      kind: "damage",
      accent: ACCENTS.damage,
      img: actor.img,
      title: actor.name,
      subtitle: outcome.source
        ? game.i18n.format("TWT.Card.DamageFrom", { source: game.i18n.localize(outcome.source) })
        : game.i18n.localize("TWT.Card.DamageTitle"),
      badge: game.i18n.format("TWT.Card.DamageBadge", { applied: outcome.applied }),
      outcome: outcomeLine,
      success: false,
      sections: [{ content: steps.join("<br>") }]
    },
    { actor }
  );
}

/**
 * Report a recovery test, or the prompt to roll one by hand.
 *
 * @param {Actor} actor
 * @param {object} outcome
 * @returns {Promise<ChatMessage>}
 */
export async function postRecoveryCard(actor, outcome) {
  const traitLabel = game.i18n.localize(TWT.traits[outcome.trait]?.label ?? outcome.trait);

  const sections = [];
  const modifiers = [];
  if (outcome.overkill) {
    modifiers.push(game.i18n.format("TWT.Card.RecoveryOverkill", { overkill: outcome.overkill }));
  }
  if (outcome.unwarded) modifiers.push(game.i18n.localize("TWT.Card.RecoveryUnwarded"));
  if (modifiers.length) {
    sections.push({ label: "TWT.Card.Modifiers", content: modifiers.join("<br>") });
  }

  if (outcome.prompted) {
    return postCard(
      {
        kind: "recovery",
        accent: ACCENTS.recovery,
        img: actor.img,
        title: game.i18n.format("TWT.Card.RecoveryTitle", { trait: traitLabel }),
        subtitle: game.i18n.format("TWT.Card.RecoverySubtitle", { difficulty: outcome.difficulty }),
        sections,
        outcome: game.i18n.localize("TWT.Card.RecoveryPrompt"),
        controls: [
          { action: "rollRecovery", label: "TWT.Card.RollRecovery", icon: "fa-solid fa-dice-d6" }
        ]
      },
      { actor }
    );
  }

  if (outcome.adaptation) {
    const { adaptation } = outcome;
    sections.push({
      label: "TWT.Card.Manifested",
      content: adaptation.noSlot
        ? game.i18n.format("TWT.Card.ManifestedNoSlot", {
            line: game.i18n.localize(adaptation.line)
          })
        : game.i18n.format("TWT.Card.ManifestedItem", {
            name: adaptation.itemName,
            line: game.i18n.localize(adaptation.line)
          })
    });
    // The rules name this outcome, and it is the Keeper's to narrate: the system does
    // not convert the actor into anything.
    if (adaptation.willDamage?.died) {
      sections.push({ content: game.i18n.localize("TWT.Card.PuppetOfTheUnknown") });
    }
  }

  const test = outcome.test;
  return postCard(
    {
      kind: "recovery",
      accent: ACCENTS.recovery,
      img: actor.img,
      title: game.i18n.format("TWT.Card.RecoveryTitle", { trait: traitLabel }),
      subtitle: game.i18n.format("TWT.Card.RecoverySubtitle", { difficulty: test?.difficulty ?? 2 }),
      dice: test ? diceChips(test) : [],
      stats: test
        ? [{ label: "TWT.Card.Marks", value: `${test.marks} / ${test.difficulty}M` }]
        : [],
      outcome: game.i18n.localize(
        test?.success ? "TWT.Card.RecoverySuccess" : "TWT.Card.RecoveryFailure"
      ),
      success: !!test?.success,
      sections
    },
    { actor, rolls: test?.rolls ?? [] }
  );
}

/**
 * Report a Safe Rest.
 *
 * @param {Actor} actor
 * @param {object} summary  `{ restored, refilled, removed, conditionsCleared, destroyed }`.
 * @returns {Promise<ChatMessage>}
 */
export async function postSafeRestCard(actor, summary) {
  const lines = [game.i18n.localize("TWT.Card.RestHealed")];
  if (summary.restored) {
    lines.push(game.i18n.format("TWT.Card.RestRestored", { count: summary.restored }));
  }
  if (summary.refilled) {
    lines.push(game.i18n.format("TWT.Card.RestRefilled", { count: summary.refilled }));
  }
  if (summary.removed) {
    lines.push(game.i18n.format("TWT.Card.RestRemoved", { count: summary.removed }));
  }
  if (summary.conditionsCleared) {
    lines.push(game.i18n.format("TWT.Card.RestConditions", { count: summary.conditionsCleared }));
  }
  if (summary.destroyed) {
    lines.push(game.i18n.format("TWT.Card.RestDestroyed", { count: summary.destroyed }));
  }

  return postCard(
    {
      kind: "rest",
      accent: ACCENTS.rest,
      img: actor.img,
      title: actor.name,
      subtitle: game.i18n.localize("TWT.Card.RestTitle"),
      sections: [{ content: lines.join("<br>") }]
    },
    { actor }
  );
}

/* -------------------------------------------- */
/*  Records                                     */
/* -------------------------------------------- */

/**
 * Put a record in front of the table, so a player can share an item, feature or
 * adaptation without reading it aloud.
 *
 * @param {Item} item
 * @returns {Promise<ChatMessage>}
 */
export async function postItemCard(item) {
  const system = item.system;
  const sections = [{ content: system.description }, { label: "TWT.Item.FIELDS.rules.label", content: system.rules }];

  let badge = "";
  switch (item.type) {
    case "equipment":
      badge = game.i18n.localize(TWT.equipCategories[system.category] ?? "");
      if (system.category === "weapon") {
        sections.unshift({
          label: "TWT.Card.Weapon",
          content: game.i18n.format("TWT.Card.WeaponLine", {
            damage: system.weapon.damage,
            type: game.i18n.localize(TWT.traits[system.weapon.damageType]?.abbr ?? ""),
            range: system.weapon.range,
            piercing: system.weapon.piercing ? game.i18n.localize("TWT.Card.Piercing") : ""
          })
        });
      }
      break;
    case "feature":
      badge = game.i18n.localize(TWT.featureTiers[system.tier] ?? "");
      break;
    case "adaptation":
      badge = game.i18n.localize(TWT.adaptationTiers[system.tier]?.label ?? "");
      for (const effect of system.activeEffects ?? []) {
        sections.push({
          label: game.i18n.localize(TWT.adaptationTiers[effect.tier]?.label ?? ""),
          content: `<strong>${effect.name}</strong> ${effect.text}`
        });
      }
      break;
  }

  if (system.restoreTrigger) {
    sections.push({ label: "TWT.Item.FIELDS.restoreTrigger.label", content: system.restoreTrigger });
  }

  return postCard(
    {
      kind: "item",
      accent: ACCENTS.item,
      img: item.img,
      title: item.name,
      subtitle: game.i18n.localize(CONFIG.Item.typeLabels[item.type] ?? ""),
      badge,
      sections
    },
    { actor: item.actor }
  );
}

/* -------------------------------------------- */
/*  NPC actions                                 */
/* -------------------------------------------- */

/**
 * The consequences of an NPC action, posted beside its test card.
 *
 * The damage, the piercing flag and the boon text travel with the roll, so applying the
 * hit is one more click rather than a scroll back to the statblock.
 *
 * @param {Actor} actor          The creature acting.
 * @param {object} action        An entry from `system.actions`.
 * @param {Actor} [targetActor]  Whatever is being aimed at, when anything is.
 * @returns {Promise<ChatMessage>}
 */
export async function postActionDetails(actor, action, targetActor) {
  const sections = [];

  if (action.description) sections.push({ content: action.description });
  if (action.boons) sections.push({ label: "TWT.Card.Boons", content: action.boons });
  if (action.frequency) {
    sections.push({ label: "TWT.NPC.FIELDS.actions.frequency.label", content: action.frequency });
  }

  const stats = [];
  if (action.damage) {
    stats.push({
      label: "TWT.NPC.Damage",
      value: `${action.damage} ${game.i18n.localize(TWT.traits[action.damageType]?.abbr ?? "")}${
        action.piercing ? ` ${game.i18n.localize("TWT.Card.Piercing")}` : ""
      }`
    });
  }
  stats.push({ label: "TWT.NPC.Range", value: `${action.range ?? 0}` });
  if (targetActor) stats.push({ label: "TWT.NPC.Target", value: targetActor.name });

  return postCard(
    {
      kind: "damage",
      accent: ACCENTS.damage,
      img: actor.img,
      title: action.name,
      subtitle: game.i18n.localize(TWT.actionTypes[action.actionType] ?? ""),
      stats,
      sections
    },
    { actor }
  );
}

/* -------------------------------------------- */
/*  Combat actions                              */
/* -------------------------------------------- */

/**
 * Report a combat action: what was declared, what the dice said, and what it bought.
 *
 * Positional consequences — which zone somebody was shoved into, which second creature a
 * Cleave catches — are named rather than applied, because the system does not model the
 * zone map and guessing would be worse than saying so.
 *
 * @param {Actor} actor
 * @param {object} payload
 * @param {string} payload.id
 * @param {object} payload.action
 * @param {string} payload.cost
 * @param {object} [payload.result]
 * @param {object} [payload.effect]
 * @param {boolean} [payload.attack]
 * @returns {Promise<ChatMessage>}
 */
export async function postActionCard(actor, { id, action, cost, result, effect = {}, attack = false }) {
  const sections = [];
  if (action.hint) sections.push({ content: game.i18n.localize(action.hint) });

  const stats = [];
  let outcome = "";

  if (attack) {
    const weapon = effect.weapon ?? {};
    stats.push({ label: "TWT.Card.Weapon", value: weapon.label ?? "" });
    if (effect.target) stats.push({ label: "TWT.NPC.Target", value: effect.target.name });

    if (effect.hit) {
      outcome = effect.damage
        ? game.i18n.format("TWT.Action.Attack.Hit", {
            applied: effect.damage.applied,
            type: game.i18n.localize(TWT.traits[weapon.damageType]?.abbr ?? "")
          })
        : game.i18n.localize("TWT.Action.Attack.HitNoTarget");
    } else {
      outcome = game.i18n.localize("TWT.Action.Attack.Miss");
      if (effect.exhausted) {
        sections.push({
          content: game.i18n.format("TWT.Action.Attack.Exhausted", { name: effect.exhausted })
        });
      }
    }
    if (weapon.boon) sections.push({ label: "TWT.Card.Boons", content: game.i18n.localize(weapon.boon) });
  } else if (result) {
    outcome = game.i18n.localize(result.success ? "TWT.Card.Success" : "TWT.Card.Failure");
  }

  // What the dice bought, in the action's own terms.
  const consequences = [];
  if (effect.armorGained) {
    consequences.push(game.i18n.format("TWT.Action.Brace.Gained", { armor: effect.armorGained }));
  }
  if (effect.extraSpeed) {
    consequences.push(game.i18n.format("TWT.Action.Dash.Gained", { speed: effect.extraSpeed }));
  }
  if (effect.movesAnyway) consequences.push(game.i18n.localize("TWT.Action.Dash.Anyway"));
  if (effect.hidden) consequences.push(game.i18n.localize("TWT.Action.Hide.Gained"));
  if (effect.allies) {
    consequences.push(game.i18n.format("TWT.Action.Direct.Gained", { allies: effect.allies }));
  }
  if (effect.zones) {
    consequences.push(game.i18n.format("TWT.Action.Shove.Gained", { zones: effect.zones }));
  }
  if (effect.grappled) consequences.push(game.i18n.localize("TWT.Action.Grapple.Gained"));
  if (effect.freed) consequences.push(game.i18n.localize("TWT.Action.BreakGrapple.Gained"));
  if (effect.willDamage) consequences.push(game.i18n.localize("TWT.Action.Repel.Gained"));
  if (consequences.length) {
    sections.push({ label: "TWT.Card.Effect", content: consequences.join("<br>") });
  }

  return postCard(
    {
      kind: "action",
      accent: attack ? ACCENTS.damage : ACCENTS.test,
      img: actor.img,
      title: game.i18n.localize(action.label),
      subtitle: game.i18n.localize(TWT.actionTypes[cost] ?? ""),
      badge: result ? game.i18n.format("TWT.Card.MarksShort", { marks: result.marks, difficulty: result.difficulty }) : "",
      outcome,
      success: attack ? !!effect.hit : !!result?.success,
      stats,
      sections
    },
    { actor }
  );
}

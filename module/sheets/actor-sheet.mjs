import {
  SETTINGS,
  SKILL_KEYS,
  SLOT_GROUPS,
  SYSTEM_ID,
  TEMPLATE_ROOT,
  TRAIT_KEYS,
  TWT
} from "../helpers/config.mjs";
import { setting } from "../helpers/settings.mjs";
import { requestTest } from "../helpers/test-flow.mjs";
import { applyDamage, healActor } from "../helpers/damage.mjs";
import { safeRest } from "../helpers/rest.mjs";
import { postActionDetails } from "../helpers/chat.mjs";
import { performAction, refundAction } from "../helpers/actions.mjs";
import { combatantFor, hasActionAvailable } from "../documents/combat.mjs";
import { TWTDamageDialog } from "./damage-dialog.mjs";

const { api, sheets } = foundry.applications;
const { DialogV2 } = api;

/**
 * The Delver sheet: the printed folio's two faces, plus a place for prose.
 *
 * The ledger is the stat side, the records face is the slot manifest, and the bio is
 * everything the rules do not touch.
 */
export class TWTDelverSheet extends api.HandlebarsApplicationMixin(sheets.ActorSheetV2) {
  /** @override */
  static DEFAULT_OPTIONS = {
    classes: [SYSTEM_ID, "sheet", "delver"],
    // Sized so the Ledger — the tab the sheet opens on, and the one with the least
    // content — fills the window. At 720 it left a third of the sheet empty.
    position: { width: 880, height: 600 },
    window: { resizable: true },
    form: { submitOnChange: true },
    actions: {
      rollTest: TWTDelverSheet.#onRollTest,
      adjustHealth: TWTDelverSheet.#onAdjustHealth,
      cycleEquip: TWTDelverSheet.#onCycleEquip,
      spendCharge: TWTDelverSheet.#onSpendCharge,
      toggleState: TWTDelverSheet.#onToggleState,
      safeRest: TWTDelverSheet.#onSafeRest,
      createRecord: TWTDelverSheet.#onCreateRecord,
      editRecord: TWTDelverSheet.#onEditRecord,
      deleteRecord: TWTDelverSheet.#onDeleteRecord,
      toggleWarded: TWTDelverSheet.#onToggleWarded,
      combatAction: TWTDelverSheet.#onCombatAction,
      refundAction: TWTDelverSheet.#onRefundAction
    }
  };

  /** @override */
  static PARTS = {
    header: { template: `${TEMPLATE_ROOT}/actor/parts/delver-header.hbs` },
    tabs: { template: "templates/generic/tab-navigation.hbs" },
    ledger: { template: `${TEMPLATE_ROOT}/actor/parts/stat-ledger.hbs`, scrollable: [""] },
    records: { template: `${TEMPLATE_ROOT}/actor/parts/record-grid.hbs`, scrollable: [""] },
    combat: { template: `${TEMPLATE_ROOT}/actor/parts/combat-bar.hbs`, scrollable: [""] },
    bio: { template: `${TEMPLATE_ROOT}/actor/parts/delver-bio.hbs`, scrollable: [""] }
  };

  /**
   * One tab group, which is what lets `ApplicationV2#_prepareContext` build the nav for
   * free — as long as an override spreads its result rather than replacing it.
   * `labelPrefix` turns each id into `TWT.Tab.<id>`, so `lang/en.json` is the whole
   * labelling job.
   * @override
   */
  static TABS = {
    primary: {
      tabs: [
        { id: "ledger", icon: "fa-solid fa-scroll" },
        { id: "records", icon: "fa-solid fa-box-archive" },
        { id: "combat", icon: "fa-solid fa-hand-fist" },
        { id: "bio", icon: "fa-solid fa-feather" }
      ],
      initial: "ledger",
      labelPrefix: "TWT.Tab"
    }
  };

  /* -------------------------------------------- */
  /*  Context                                     */
  /* -------------------------------------------- */

  /** @override */
  async _prepareContext(options) {
    const system = this.actor.system;
    const { TextEditor } = foundry.applications.ux;

    return {
      // Spread, never replace: this is where the tab navigation comes from.
      ...(await super._prepareContext(options)),
      actor: this.actor,
      system,
      editable: this.isEditable,
      owner: this.actor.isOwner,
      limited: this.actor.limited,
      config: TWT,
      fields: this.document.system.schema.fields,

      // Arrays rather than nine near-identical template blocks.
      traits: TRAIT_KEYS.map((key) => ({
        key,
        label: TWT.traits[key].label,
        abbr: TWT.traits[key].abbr,
        img: TWT.traits[key].img,
        score: system.traits[key].score,
        hp: system.traits[key].hp,
        empty: system.traits[key].hp.value === 0
      })),
      skills: SKILL_KEYS.map((key) => ({
        key,
        label: TWT.skills[key].label,
        abbr: TWT.skills[key].abbr,
        img: TWT.skills[key].img,
        score: system.skills[key]
      })),

      columns: this.#recordColumns(),

      vitals: {
        armor: system.armor,
        speed: system.speed,
        speedLabel: TWT.speeds[system.speed.current] ?? `${system.speed.current}`,
        ward: system.ward,
        slots: system.slots
      },

      enrichedBiography: await TextEditor.implementation.enrichHTML(system.biography, {
        relativeTo: this.actor,
        secrets: this.actor.isOwner
      }),
      enrichedNotes: await TextEditor.implementation.enrichHTML(system.notes, {
        relativeTo: this.actor,
        secrets: this.actor.isOwner
      }),

      ...this.#combatContext()
    };
  }

  /**
   * The combat bar: what this Delver may still do this turn, and every action available.
   *
   * Outside an encounter the economy pips are hidden rather than shown as always-full —
   * there is no turn to spend, and the rules leave that to the table.
   * @returns {object}
   */
  #combatContext() {
    const combatant = combatantFor(this.actor);
    return {
      inCombat: !!combatant,
      // Ask the combatant's own encounter, not `game.combat`, for the same reason
      // `combatantFor` does: that getter follows the viewed scene.
      isMyTurn: combatant ? combatant.combat?.combatant?.id === combatant.id : false,
      majorAvailable: hasActionAvailable(combatant, "major"),
      minorAvailable: hasActionAvailable(combatant, "minor"),
      majorActions: Object.entries(TWT.majorActions).map(([id, action]) => ({ id, ...action })),
      minorActions: Object.entries(TWT.minorActions).map(([id, action]) => ({ id, ...action }))
    };
  }

  /** @override */
  async _preparePartContext(partId, context, options) {
    context = await super._preparePartContext(partId, context, options);
    // Each tabbed part carries its own tab metadata, which is what `changeTab` toggles.
    if (partId in (context.tabs ?? {})) context.tab = context.tabs[partId];
    return context;
  }

  /* -------------------------------------------- */

  /**
   * Build the three record columns already padded to their exact capacity.
   *
   * This is the piece that keeps the slot grid honest: a record costing two slots
   * contributes one card plus one `consumed` placeholder, and the rest are `empty`, so
   * the number of cells a player can see always equals the number the rules allow. The
   * template then renders a fixed grid with no arithmetic of its own.
   *
   * @returns {object[]}
   */
  #recordColumns() {
    const system = this.actor.system;

    return Object.entries(SLOT_GROUPS).map(([group, { itemType, trait }]) => {
      const { max, used } = system.slots[group];
      const records = this.actor.items
        .filter((i) => i.type === itemType)
        .sort((a, b) => (a.sort || 0) - (b.sort || 0));

      const cells = [];
      for (const item of records) {
        const span = item.system.slotCost ?? 1;
        cells.push({ kind: "record", item, span, card: this.#recordCard(item) });
        // A heavy record eats a second cell, so the column still shows `max` of them.
        for (let i = 1; i < span; i++) cells.push({ kind: "consumed" });
      }
      while (cells.length < max) cells.push({ kind: "empty" });

      return {
        group,
        itemType,
        trait,
        traitLabel: TWT.traits[trait].label,
        label: `TWT.Slots.${group}`,
        max,
        used,
        cells,
        over: used > max
      };
    });
  }

  /**
   * The mechanical line a record card shows under its name, plus its badges.
   *
   * @param {Item} item
   * @returns {object}
   */
  #recordCard(item) {
    const system = item.system;
    const card = {
      summary: "",
      badges: [],
      state: system.state,
      charges: system.charges.enabled
        ? Array.from({ length: system.charges.max }, (_, i) => ({ spent: i >= system.charges.value }))
        : null
    };

    switch (item.type) {
      case "equipment": {
        card.badges.push({ key: "category", label: TWT.equipCategories[system.category] });
        if (system.equipState !== "stored") {
          card.badges.push({ key: system.equipState, label: TWT.equipStates[system.equipState] });
        }
        if (system.heavy) card.badges.push({ key: "heavy", label: "TWT.Record.Heavy" });
        if (system.doubleWielded) card.badges.push({ key: "double", label: "TWT.Record.DoubleWielded" });

        if (system.category === "weapon") {
          const parts = [
            game.i18n.format("TWT.Record.WeaponDamage", {
              damage: system.weapon.damage,
              type: game.i18n.localize(TWT.traits[system.weapon.damageType].abbr)
            }),
            game.i18n.format("TWT.Record.Range", { range: system.weapon.range })
          ];
          if (system.weapon.piercing) parts.push(game.i18n.localize("TWT.Record.Piercing"));
          card.summary = parts.join(" · ");
        } else if (system.category === "armor") {
          card.summary = game.i18n.format("TWT.Record.ArmorBonus", { armor: system.armorBonus });
        } else if (system.category === "lantern") {
          card.summary = game.i18n.format("TWT.Record.WardValue", { ward: system.wardValue });
        }
        break;
      }
      case "feature": {
        card.badges.push({ key: "tier", label: TWT.featureTiers[system.tier] });
        if (system.skill) card.summary = game.i18n.localize(TWT.skills[system.skill].label);
        break;
      }
      case "adaptation": {
        card.badges.push({ key: "tier", label: TWT.adaptationTiers[system.tier]?.label });
        card.summary = system.line;
        break;
      }
    }

    return card;
  }

  /* -------------------------------------------- */
  /*  Ledger actions                              */
  /* -------------------------------------------- */

  /**
   * Roll a test, prefilled from whichever row was clicked. A trait row leaves the skill
   * open and a skill row leaves the trait open, because the book pairs them freely.
   * @this {TWTDelverSheet}
   */
  static async #onRollTest(event, target) {
    const { trait, skill } = target.dataset;
    await requestTest(this.actor, {
      trait: trait || undefined,
      skill: skill || undefined,
      difficulty: 2
    });
  }

  /**
   * Adjust a trait's health. Damage goes through the pipeline rather than writing the
   * number directly, so dropping a pool to 0 still triggers the recovery test.
   * @this {TWTDelverSheet}
   */
  static async #onAdjustHealth(event, target) {
    const { trait, by } = target.dataset;
    const amount = Number(by);
    if (amount < 0) await applyDamage(this.actor, { amount: -amount, type: trait, piercing: true, source: "TWT.Source.SheetAdjust" });
    else await healActor(this.actor, { amount, type: trait });
  }

  /** @this {TWTDelverSheet} */
  static async #onToggleWarded() {
    await this.actor.update({ "system.ward.warded": !this.actor.system.ward.warded });
  }

  /** @this {TWTDelverSheet} */
  static async #onCombatAction(event, target) {
    await performAction(this.actor, target.dataset.actionId);
  }

  /** @this {TWTDelverSheet} */
  static async #onRefundAction(event, target) {
    await refundAction(this.actor, target.dataset.cost);
  }

  /** @this {TWTDelverSheet} */
  static async #onSafeRest() {
    const confirmed = await DialogV2.confirm({
      window: { title: "TWT.Rest.ConfirmTitle", icon: "fa-solid fa-bed" },
      classes: [SYSTEM_ID, "twt-dialog"],
      content: `<p class="twt-dialog-lead">${game.i18n.localize("TWT.Rest.ConfirmBody")}</p>`,
      yes: { label: "TWT.Rest.Confirm" },
      rejectClose: false
    });
    if (confirmed) await safeRest(this.actor);
  }

  /* -------------------------------------------- */
  /*  Record actions                              */
  /* -------------------------------------------- */

  /**
   * Cycle stored → wielded → worn → stored, skipping states the category cannot use and
   * refusing a state that would break a hand or body limit.
   * @this {TWTDelverSheet}
   */
  static async #onCycleEquip(event, target) {
    const item = this.actor.items.get(target.closest("[data-item-id]")?.dataset.itemId);
    if (!item || item.type !== "equipment") return;

    const states = TWTDelverSheet.#equipStatesFor(item);
    const next = states[(states.indexOf(item.system.equipState) + 1) % states.length];

    const refusal = this.#equipRefusal(item, next);
    if (refusal) {
      // The setting decides whether a limit is a wall or a warning.
      if (setting(SETTINGS.enforceSlotLimits)) {
        ui.notifications.warn(refusal.message, { localize: false });
        return;
      }
      ui.notifications.warn(refusal.message, { localize: false });
    }

    await item.update({ "system.equipState": next });
  }

  /**
   * The equip states a category can actually occupy. Armor is worn, never wielded;
   * a lantern or a weapon is wielded, never worn.
   * @param {Item} item
   * @returns {string[]}
   */
  static #equipStatesFor(item) {
    switch (item.system.category) {
      case "armor":
        return ["stored", "worn"];
      case "weapon":
      case "lantern":
        return ["stored", "wielded"];
      default:
        return ["stored", "wielded", "worn"];
    }
  }

  /**
   * Why a change of equip state cannot happen, or null when it can.
   *
   * @param {Item} item
   * @param {string} next
   * @returns {{message: string}|null}
   */
  #equipRefusal(item, next) {
    const limits = this.actor.system.equipLimits;
    const cost = item.system.doubleWielded ? 2 : 1;

    if (next === "wielded") {
      const used = limits.wield.used - (item.system.equipState === "wielded" ? cost : 0);
      if (used + cost > limits.wield.max) {
        return {
          message: game.i18n.format("TWT.Warning.WieldLimit", { max: limits.wield.max, cost })
        };
      }
    }
    if (next === "worn") {
      const used = limits.worn.used - (item.system.equipState === "worn" ? 1 : 0);
      if (used + 1 > limits.worn.max) {
        return { message: game.i18n.format("TWT.Warning.WornLimit", { max: limits.worn.max }) };
      }
    }
    return null;
  }

  /**
   * Spend one charge. Spending the last one exhausts the record, which is what makes the
   * pips meaningful rather than decorative.
   * @this {TWTDelverSheet}
   */
  static async #onSpendCharge(event, target) {
    const item = this.actor.items.get(target.closest("[data-item-id]")?.dataset.itemId);
    if (!item?.system.charges.enabled) return;

    const value = Math.max(0, item.system.charges.value - 1);
    const update = { "system.charges.value": value };
    if (value === 0 && item.system.state === "normal") update["system.state"] = "exhausted";
    await item.update(update);
  }

  /** @this {TWTDelverSheet} */
  static async #onToggleState(event, target) {
    const item = this.actor.items.get(target.closest("[data-item-id]")?.dataset.itemId);
    if (!item) return;
    const order = ["normal", "exhausted", "destroyed"];
    const next = order[(order.indexOf(item.system.state) + 1) % order.length];
    await item.update({ "system.state": next });
  }

  /** @this {TWTDelverSheet} */
  static async #onCreateRecord(event, target) {
    const type = target.closest("[data-item-type]")?.dataset.itemType;
    if (!type) return;
    const [item] = await this.actor.createEmbeddedDocuments("Item", [
      { name: game.i18n.format("TWT.Record.NewRecord", { type: game.i18n.localize(CONFIG.Item.typeLabels[type]) }), type }
    ]);
    item?.sheet.render({ force: true });
  }

  /** @this {TWTDelverSheet} */
  static #onEditRecord(event, target) {
    const item = this.actor.items.get(target.closest("[data-item-id]")?.dataset.itemId);
    item?.sheet.render({ force: true });
  }

  /** @this {TWTDelverSheet} */
  static async #onDeleteRecord(event, target) {
    const item = this.actor.items.get(target.closest("[data-item-id]")?.dataset.itemId);
    if (!item) return;
    const confirmed = await DialogV2.confirm({
      window: { title: "TWT.Record.DeleteTitle" },
      classes: [SYSTEM_ID, "twt-dialog"],
      content: `<p class="twt-dialog-lead">${game.i18n.format("TWT.Record.DeleteBody", { name: item.name })}</p>`,
      rejectClose: false
    });
    if (confirmed) await item.delete();
  }

  /* -------------------------------------------- */
  /*  Drops                                       */
  /* -------------------------------------------- */

  /**
   * Refuse a record that belongs in a different column, or one that will not fit.
   * A rejection always names its reason — silently dropping a drag is the behaviour
   * players report as "the sheet is broken".
   * @override
   */
  async _onDropItem(event, item) {
    if (!this.actor.isOwner) return null;

    const column = event.target.closest("[data-item-type]")?.dataset.itemType;
    if (column && item.type !== column) {
      ui.notifications.warn(
        game.i18n.format("TWT.Warning.WrongColumn", {
          name: item.name,
          type: game.i18n.localize(CONFIG.Item.typeLabels[item.type]),
          column: game.i18n.localize(CONFIG.Item.typeLabels[column])
        })
      );
      return null;
    }

    // Sorting within the sheet is not a capacity question.
    const isMove = this.actor.uuid === item.parent?.uuid;
    if (!isMove && setting(SETTINGS.enforceSlotLimits)) {
      const group = Object.keys(SLOT_GROUPS).find((g) => SLOT_GROUPS[g].itemType === item.type);
      const slots = this.actor.system.slots[group];
      const cost = item.system.slotCost ?? 1;
      if (slots && slots.used + cost > slots.max) {
        ui.notifications.warn(
          game.i18n.format("TWT.Warning.NoRoom", {
            name: item.name,
            group: game.i18n.localize(`TWT.Slots.${group}`),
            used: slots.used,
            max: slots.max,
            cost
          })
        );
        return null;
      }
    }

    return super._onDropItem(event, item);
  }
}


/* -------------------------------------------- */

/**
 * The NPC statblock: the printed profile, readable at a glance, with its actions
 * rollable in one click.
 *
 * One compact column and no tabs — a statblock is meant to be read, not navigated. The
 * Keeper panel collapses at the bottom rather than hiding behind a tab.
 */
export class TWTNPCSheet extends api.HandlebarsApplicationMixin(sheets.ActorSheetV2) {
  /** @override */
  static DEFAULT_OPTIONS = {
    classes: [SYSTEM_ID, "sheet", "npc"],
    position: { width: 620, height: 720 },
    window: { resizable: true },
    form: { submitOnChange: true },
    actions: {
      rollTest: TWTNPCSheet.#onRollTest,
      rollAction: TWTNPCSheet.#onRollAction,
      openDamage: TWTNPCSheet.#onOpenDamage,
      addEntry: TWTNPCSheet.#onAddEntry,
      removeEntry: TWTNPCSheet.#onRemoveEntry,
      moveEntry: TWTNPCSheet.#onMoveEntry
    }
  };

  /** @override */
  static PARTS = {
    header: { template: `${TEMPLATE_ROOT}/actor/parts/npc-header.hbs` },
    stats: { template: `${TEMPLATE_ROOT}/actor/parts/npc-stats.hbs` },
    abilities: { template: `${TEMPLATE_ROOT}/actor/parts/npc-abilities.hbs` },
    actions: { template: `${TEMPLATE_ROOT}/actor/parts/npc-actions.hbs` },
    keeper: { template: `${TEMPLATE_ROOT}/actor/parts/npc-keeper.hbs` }
  };

  /**
   * Drop the Keeper panel entirely for a non-GM. Gated on `isGM` rather than ownership:
   * a player who somehow owns an NPC still should not read its tactics.
   * @override
   */
  _configureRenderParts(options) {
    const parts = super._configureRenderParts(options);
    if (!game.user.isGM) delete parts.keeper;
    return parts;
  }

  /* -------------------------------------------- */

  /** @override */
  async _prepareContext(options) {
    const system = this.actor.system;
    const { TextEditor } = foundry.applications.ux;

    return {
      ...(await super._prepareContext(options)),
      actor: this.actor,
      system,
      editable: this.isEditable,
      isGM: game.user.isGM,
      config: TWT,
      fields: this.document.system.schema.fields,

      typeLabel: TWT.creatureTypes[system.creatureType],
      threatLabel: TWT.threats[system.threat],
      speedLabel: TWT.speeds[system.speedCurrent] ?? `${system.speedCurrent}`,
      sizeLabel: TWT.speeds[system.size] ?? `${system.size}`,

      traits: TRAIT_KEYS.map((key) => ({
        key,
        label: TWT.traits[key].label,
        abbr: TWT.traits[key].abbr,
        score: system.traits[key]
      })),
      skills: SKILL_KEYS.map((key) => ({
        key,
        label: TWT.skills[key].label,
        abbr: TWT.skills[key].abbr,
        score: system.skills[key]
      })),

      abilities: system.abilities.map((ability, index) => ({ ...ability, index })),
      actions: system.actions.map((action, index) => this.#actionRow(action, index)),

      creatureTypeChoices: TWT.creatureTypes,
      threatChoices: TWT.threats,
      actionTypeChoices: TWT.actionTypes,
      traitChoices: Object.fromEntries(TRAIT_KEYS.map((k) => [k, TWT.traits[k].label])),
      skillChoices: Object.fromEntries(SKILL_KEYS.map((k) => [k, TWT.skills[k].label])),

      enrichedTactics: await TextEditor.implementation.enrichHTML(system.tactics, {
        relativeTo: this.actor,
        secrets: true
      }),
      enrichedBiography: await TextEditor.implementation.enrichHTML(system.biography, {
        relativeTo: this.actor,
        secrets: true
      }),
      enrichedNotes: await TextEditor.implementation.enrichHTML(system.notes, {
        relativeTo: this.actor,
        secrets: true
      })
    };
  }

  /**
   * One action row, with its pool size computed rather than stored.
   *
   * A stored number would drift the moment a Keeper edits a score, and comparing a
   * statblock against the printed page is exactly when that matters.
   *
   * @param {object} action
   * @param {number} index
   * @returns {object}
   */
  #actionRow(action, index) {
    const system = this.actor.system;
    const pool = (system.traits[action.trait] ?? 0) + (system.skills[action.skill] ?? 0);
    return {
      ...action,
      index,
      pool,
      // The printed statblock writes these out in full — "BODY + NAVIGATION" — so the
      // sheet does too, rather than mixing an abbreviation with a full name.
      traitLabel: TWT.traits[action.trait]?.label,
      skillLabel: TWT.skills[action.skill]?.label,
      actionTypeLabel: TWT.actionTypes[action.actionType],
      damageTypeAbbr: TWT.traits[action.damageType]?.abbr
    };
  }

  /* -------------------------------------------- */
  /*  Actions                                     */
  /* -------------------------------------------- */

  /** @this {TWTNPCSheet} */
  static async #onRollTest(event, target) {
    const { trait, skill } = target.dataset;
    await requestTest(this.actor, { trait: trait || undefined, skill: skill || undefined });
  }

  /**
   * Roll one of the statblock's actions.
   *
   * A null difficulty means "use whatever we are aiming at": the first targeted token's
   * own target difficulty, falling back to the standard 2M when nothing is targeted.
   * @this {TWTNPCSheet}
   */
  static async #onRollAction(event, target) {
    const index = Number(target.closest("[data-index]")?.dataset.index);
    const action = this.actor.system.actions[index];
    if (!action) return;

    const targetActor = game.user.targets.first()?.actor;
    const difficulty = action.difficulty ?? targetActor?.system.targetDifficulty ?? 2;

    const rolled = await requestTest(this.actor, {
      trait: action.trait,
      skill: action.skill,
      difficulty,
      kind: "attack",
      label: action.name
    });
    if (!rolled) return;

    // The consequences travel with the roll, so applying the hit is one more click
    // rather than a scroll back to the sheet.
    await postActionDetails(this.actor, action, targetActor);
  }

  /** @this {TWTNPCSheet} */
  static #onOpenDamage() {
    TWTDamageDialog.open({ targets: [this.actor] });
  }

  /**
   * Append a row to `abilities` or `actions`. An ArrayField is replaced wholesale, so
   * the write is the whole array rather than an index path.
   * @this {TWTNPCSheet}
   */
  static async #onAddEntry(event, target) {
    const field = target.dataset.field;
    const current = this.actor.system[field].map((e) => ({ ...e }));
    const blank =
      field === "abilities"
        ? { name: game.i18n.localize("TWT.NPC.NewAbility"), description: "" }
        : { name: game.i18n.localize("TWT.NPC.NewAction"), actionType: "major", trait: "body", skill: "violence" };
    await this.actor.update({ [`system.${field}`]: [...current, blank] });
  }

  /** @this {TWTNPCSheet} */
  static async #onRemoveEntry(event, target) {
    const field = target.dataset.field;
    const index = Number(target.closest("[data-index]")?.dataset.index);
    const current = this.actor.system[field].map((e) => ({ ...e }));
    current.splice(index, 1);
    await this.actor.update({ [`system.${field}`]: current });
  }

  /** @this {TWTNPCSheet} */
  static async #onMoveEntry(event, target) {
    const field = target.dataset.field;
    const by = Number(target.dataset.by);
    const index = Number(target.closest("[data-index]")?.dataset.index);
    const current = this.actor.system[field].map((e) => ({ ...e }));
    const next = index + by;
    if (next < 0 || next >= current.length) return;
    [current[index], current[next]] = [current[next], current[index]];
    await this.actor.update({ [`system.${field}`]: current });
  }
}

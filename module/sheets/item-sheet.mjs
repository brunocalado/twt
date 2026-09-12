import { ADAPTATION_TIER_ORDER, SKILL_KEYS, SYSTEM_ID, TEMPLATE_ROOT, TRAIT_KEYS, TWT } from "../helpers/config.mjs";
import { postItemCard } from "../helpers/chat.mjs";

const { api, sheets } = foundry.applications;
const { DialogV2 } = api;

/**
 * One sheet class for all three record types: a shared header and description, with one
 * type-specific body between them.
 */
export class TWTItemSheet extends api.HandlebarsApplicationMixin(sheets.ItemSheetV2) {
  /** @override */
  static DEFAULT_OPTIONS = {
    classes: [SYSTEM_ID, "sheet", "item"],
    position: { width: 520, height: 620 },
    window: { resizable: true },
    form: { submitOnChange: true },
    actions: {
      cycleState: TWTItemSheet.#onCycleState,
      restoreRecord: TWTItemSheet.#onRestoreRecord,
      adjustCharge: TWTItemSheet.#onAdjustCharge,
      shareRecord: TWTItemSheet.#onShareRecord
    }
  };

  /** @override */
  static PARTS = {
    header: { template: `${TEMPLATE_ROOT}/item/parts/header.hbs` },
    equipment: { template: `${TEMPLATE_ROOT}/item/equipment-body.hbs` },
    feature: { template: `${TEMPLATE_ROOT}/item/feature-body.hbs` },
    adaptation: { template: `${TEMPLATE_ROOT}/item/adaptation-body.hbs` },
    description: { template: `${TEMPLATE_ROOT}/item/parts/description.hbs` }
  };

  /**
   * Keep only the body part this item's type uses.
   *
   * This is the hook for type-dependent parts, not `_configureRenderOptions`. Assigning
   * `options.parts` there would clobber targeted re-renders — `render({ parts: ["header"] })`
   * would silently re-render the whole sheet.
   * @override
   */
  _configureRenderParts(options) {
    const parts = super._configureRenderParts(options);
    for (const type of ["equipment", "feature", "adaptation"]) {
      if (type !== this.document.type) delete parts[type];
    }
    return parts;
  }

  /**
   * A second root class per subtype, so the three bodies can be styled apart.
   * @override
   */
  _initializeApplicationOptions(options) {
    const applied = super._initializeApplicationOptions(options);
    const type = applied.document?.type;
    if (type) applied.classes = [...applied.classes, type];
    return applied;
  }

  /* -------------------------------------------- */
  /*  Context                                     */
  /* -------------------------------------------- */

  /** @override */
  async _prepareContext(options) {
    const system = this.item.system;
    const { TextEditor } = foundry.applications.ux;

    const context = {
      ...(await super._prepareContext(options)),
      item: this.item,
      system,
      editable: this.isEditable,
      config: TWT,
      fields: this.document.system.schema.fields,
      typeLabel: CONFIG.Item.typeLabels[this.item.type],

      // Conditional sections are decided here and gated with `{{#if}}`. Hiding them with
      // CSS would leave the inputs in the form, still submitting values.
      isWeapon: system.category === "weapon",
      isArmor: system.category === "armor",
      isLantern: system.category === "lantern",

      states: TWT.recordStates,
      stateLabel: TWT.recordStates[system.state],
      isDestroyed: system.state === "destroyed",
      isExhausted: system.state === "exhausted",

      enrichedDescription: await TextEditor.implementation.enrichHTML(system.description, {
        relativeTo: this.item,
        secrets: this.item.isOwner
      }),
      enrichedRules: await TextEditor.implementation.enrichHTML(system.rules, {
        relativeTo: this.item,
        secrets: this.item.isOwner
      })
    };

    if (this.item.type === "equipment") {
      context.traitChoices = TRAIT_KEYS.map((k) => ({ value: k, label: TWT.traits[k].label }));
      context.attackTraitChoices = ["body", "mind"].map((k) => ({
        value: k,
        label: TWT.traits[k].label
      }));
    }

    if (this.item.type === "feature") {
      context.skillChoices = SKILL_KEYS.map((k) => ({ value: k, label: TWT.skills[k].label }));
    }

    if (this.item.type === "adaptation") {
      const current = ADAPTATION_TIER_ORDER.indexOf(system.tier);
      context.tiers = ADAPTATION_TIER_ORDER.map((tier, index) => ({
        tier,
        label: TWT.adaptationTiers[tier].label,
        slotCost: TWT.adaptationTiers[tier].slotCost,
        // Effects accumulate (R1): everything at or below the current tier is live.
        active: index <= current,
        current: index === current,
        effect: system.effects[tier]
      }));
      context.slotCost = system.slotCost;
      context.isMalignant = system.tier === "malignant";
    }

    return context;
  }

  /* -------------------------------------------- */
  /*  Actions                                     */
  /* -------------------------------------------- */

  /**
   * Step the record's state. Destroyed is terminal — it can only be left by deleting the
   * record, so the cycle stops there.
   * @this {TWTItemSheet}
   */
  static async #onCycleState() {
    const state = this.item.system.state;
    if (state === "destroyed") {
      ui.notifications.warn("TWT.Warning.DestroyedIsForever", { localize: true });
      return;
    }
    const next = state === "normal" ? "exhausted" : "destroyed";
    await this.item.update({ "system.state": next });
  }

  /**
   * Restore a record: back to normal with its charges refilled.
   *
   * A malignant adaptation is the exception — restoring one is how a Delver is rid of it
   * (R4), so the record is deleted rather than repaired. That is destructive and
   * irreversible, hence the confirmation.
   * @this {TWTItemSheet}
   */
  static async #onRestoreRecord() {
    const system = this.item.system;

    if (this.item.type === "adaptation" && system.tier === "malignant") {
      const confirmed = await DialogV2.confirm({
        window: { title: "TWT.Item.RestoreMalignantTitle" },
        classes: [SYSTEM_ID, "twt-dialog"],
        content: `<p class="twt-dialog-lead">${game.i18n.format("TWT.Item.RestoreMalignantBody", {
          name: this.item.name
        })}</p>`,
        rejectClose: false
      });
      if (confirmed) await this.item.delete();
      return;
    }

    if (system.state === "destroyed") {
      ui.notifications.warn("TWT.Warning.DestroyedIsForever", { localize: true });
      return;
    }

    const update = { "system.state": "normal" };
    if (system.charges.enabled) update["system.charges.value"] = system.charges.max;
    await this.item.update(update);
  }

  /**
   * Spend or restore one charge. Spending the last one exhausts the record, which is the
   * same rule the Delver sheet's pips follow.
   * @this {TWTItemSheet}
   */
  static async #onAdjustCharge(event, target) {
    const system = this.item.system;
    if (!system.charges.enabled) return;

    const by = Number(target.dataset.by);
    const value = Math.clamp(system.charges.value + by, 0, system.charges.max);
    const update = { "system.charges.value": value };
    if (value === 0 && system.state === "normal") update["system.state"] = "exhausted";
    await this.item.update(update);
  }

  /** @this {TWTItemSheet} */
  static async #onShareRecord() {
    await postItemCard(this.item);
  }
}

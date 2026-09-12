import TWTItemBase from "./base-item.mjs";
import { ADAPTATION_TIER_ORDER, TWT } from "../helpers/config.mjs";

/**
 * An Adaptation: one Item per mutation line, with `tier` recording how far down that
 * line the Delver has been dragged (R1).
 *
 * Effects accumulate rather than replace, and `slotCost` is the **total** for the
 * current tier — malignant 1, Awakened I 1, II 2, III 3. Each tier carries its own
 * name because the book names them individually: the Undying line is ASHES at
 * Awakened I and BONES at Awakened II, and Dr. Vespal has both active at 2 of 6
 * WILL slots, which is exactly Awakened II's cost.
 */
export default class TWTAdaptation extends TWTItemBase {
  static LOCALIZATION_PREFIXES = ["TWT.Item", "TWT.Adaptation"];

  static defineSchema() {
    const fields = foundry.data.fields;
    const schema = super.defineSchema();

    // The mutation line: "Undying", "Fortune", "Subterranean", "Amphibious".
    schema.line = new fields.StringField();

    schema.tier = new fields.StringField({
      required: true,
      nullable: false,
      blank: false,
      initial: "malignant",
      choices: ADAPTATION_TIER_ORDER
    });

    schema.effects = new fields.SchemaField(
      Object.fromEntries(
        ADAPTATION_TIER_ORDER.map((tier) => [
          tier,
          new fields.SchemaField({
            name: new fields.StringField(),
            text: new fields.StringField()
          })
        ])
      )
    );

    return schema;
  }

  /* -------------------------------------------- */

  prepareDerivedData() {
    this.slotCost = TWT.adaptationTiers[this.tier]?.slotCost ?? 1;

    // The tiers at or below the current one, in order: what is actually active,
    // and what the sheet lists.
    this.activeEffects = ADAPTATION_TIER_ORDER.slice(
      0,
      ADAPTATION_TIER_ORDER.indexOf(this.tier) + 1
    )
      .map((tier) => ({ tier, ...this.effects[tier] }))
      .filter((effect) => effect.text);
  }
}

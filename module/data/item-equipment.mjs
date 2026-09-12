import TWTItemBase from "./base-item.mjs";
import { TRAIT_KEYS } from "../helpers/config.mjs";

/**
 * A piece of equipment: a weapon, a suit of armor, a lantern, or gear.
 *
 * Four categories, not seven. An earlier cut mixed two axes — `consumable` was
 * both a category and a flag, and `tool`/`relay`/`trinket` are all just gear with
 * prose. The Quickstart itself distinguishes only weapons, armor, lanterns and
 * everything else.
 *
 * `weapon.attackTrait` covers all three attack modes without a separate flag:
 * melee is BODY at range 0, ranged is MIND at range 1+, thrown is BODY at range 1+.
 */
export default class TWTEquipment extends TWTItemBase {
  static LOCALIZATION_PREFIXES = ["TWT.Item", "TWT.Equipment"];

  static defineSchema() {
    const fields = foundry.data.fields;
    const requiredInteger = { required: true, nullable: false, integer: true };
    const schema = super.defineSchema();

    schema.category = new fields.StringField({
      required: true,
      nullable: false,
      blank: false,
      initial: "gear",
      choices: ["weapon", "armor", "lantern", "gear"]
    });

    // Heavy fills two BODY slots instead of one.
    schema.heavy = new fields.BooleanField({ initial: false });
    // Commits both wield slots.
    schema.doubleWielded = new fields.BooleanField({ initial: false });
    // Destroyed on use.
    schema.consumable = new fields.BooleanField({ initial: false });

    schema.equipState = new fields.StringField({
      required: true,
      nullable: false,
      blank: false,
      initial: "stored",
      choices: ["stored", "wielded", "worn"]
    });

    schema.price = new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 });

    // Read only when `category === "weapon"`.
    schema.weapon = new fields.SchemaField({
      attackTrait: new fields.StringField({
        required: true,
        nullable: false,
        blank: false,
        initial: "body",
        choices: ["body", "mind"]
      }),
      damage: new fields.NumberField({ ...requiredInteger, initial: 1, min: 0 }),
      damageType: new fields.StringField({
        required: true,
        nullable: false,
        blank: false,
        initial: "body",
        choices: TRAIT_KEYS
      }),
      range: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 }),
      piercing: new fields.BooleanField({ initial: false })
    });

    // Read only when `category === "armor"`.
    schema.armorBonus = new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 });

    // Read only when `category === "lantern"`.
    schema.wardValue = new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 });

    return schema;
  }

  /* -------------------------------------------- */

  prepareDerivedData() {
    this.slotCost = this.heavy ? 2 : 1;
  }
}

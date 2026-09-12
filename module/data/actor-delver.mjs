import TWTActorBase from "./base-actor.mjs";
import { SKILL_KEYS, SLOT_GROUPS, TRAIT_KEYS } from "../helpers/config.mjs";
import { SPEED_LADDER } from "../helpers/effects.mjs";

/**
 * The Delver: the player character of Time Without Tide.
 *
 * Three traits, each with its own health pool equal to its score; six skills; the
 * three record-slot groups; armor, speed and the XP/Dust ledger.
 *
 * Two schema decisions worth naming:
 *
 * - `speed.base` is **not** an integer field (R9). ½ Speed is a defined state with
 *   its own rule, and Slowed steps an actor down the 2 → 1 → ½ → 0 ladder, which
 *   `choices: [0, 0.5, 1, 2]` expresses exactly.
 * - There is **no** `conditions` sub-schema. Every one of the fifteen conditions,
 *   Critical included, is an ActiveEffect status. A boolean mirror here would be a
 *   second source of truth that drifts out of step with `actor.statuses`.
 */
export default class TWTDelver extends TWTActorBase {
  static LOCALIZATION_PREFIXES = ["TWT.Actor", "TWT.Delver"];

  static defineSchema() {
    const fields = foundry.data.fields;
    const requiredInteger = { required: true, nullable: false, integer: true };
    const schema = super.defineSchema();

    // A trait's health pool has no stored `max` — it is always the score, derived
    // below, so raising the score raises the pool without a migration.
    schema.traits = new fields.SchemaField(
      Object.fromEntries(
        TRAIT_KEYS.map((key) => [
          key,
          new fields.SchemaField({
            score: new fields.NumberField({ ...requiredInteger, initial: 3, min: 1, max: 5 }),
            hp: new fields.SchemaField({
              value: new fields.NumberField({ ...requiredInteger, initial: 3, min: 0 })
            })
          })
        ])
      )
    );

    schema.skills = new fields.SchemaField(
      Object.fromEntries(
        SKILL_KEYS.map((key) => [
          key,
          new fields.NumberField({ ...requiredInteger, initial: 0, min: 0, max: 5 })
        ])
      )
    );

    // `current` is the armor left this turn (it refills from `base` each combat
    // turn); `temp` is bonus armor granted on top of what the worn item provides.
    schema.armor = new fields.SchemaField({
      current: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 }),
      temp: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 })
    });

    schema.speed = new fields.SchemaField({
      base: new fields.NumberField({
        required: true,
        nullable: false,
        initial: 1,
        choices: [0, 0.5, 1, 2]
      })
    });

    schema.progression = new fields.SchemaField({
      xp: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 }),
      dust: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 })
    });

    return schema;
  }

  /* -------------------------------------------- */

  /**
   * Embedded Items are prepared before this runs (the order is fixed in
   * `ClientDocument#prepareData`), so each owned item's own derived `slotCost` is
   * already available here.
   */
  prepareDerivedData() {
    const items = this.parent.items;

    /** Items in a given equip state. @type {(state: string) => Item[]} */
    const equipped = (state) =>
      items.filter((i) => i.type === "equipment" && i.system.equipState === state);

    // A trait's health ceiling is its score, nothing more.
    for (const key of TRAIT_KEYS) this.traits[key].hp.max = this.traits[key].score;

    // Record slots: twice the associated trait score, filled by each record's own
    // slotCost so heaviness (equipment) and tier (adaptations) feed one number.
    this.slots = {};
    for (const [group, { trait }] of Object.entries(SLOT_GROUPS)) {
      this.slots[group] = { max: this.traits[trait].score * 2, used: 0 };
    }
    for (const item of items) {
      const group = Object.keys(SLOT_GROUPS).find(
        (g) => SLOT_GROUPS[g].itemType === item.type
      );
      if (group) this.slots[group].used += item.system.slotCost ?? 0;
    }

    // Two hands to wield with, one body to wear on. A double-wielded weapon
    // commits both hands.
    this.equipLimits = {
      wield: {
        max: 2,
        used: equipped("wielded").reduce((n, i) => n + (i.system.doubleWielded ? 2 : 1), 0)
      },
      worn: { max: 1, used: equipped("worn").length }
    };

    // Ward is the light actually held up. Stowed light wards nothing.
    this.ward.value = equipped("wielded")
      .filter((i) => i.system.category === "lantern")
      .reduce((n, i) => n + i.system.wardValue, 0);

    // A Delver's armor comes from the one piece they are wearing.
    this.armor.base = equipped("worn")
      .filter((i) => i.system.category === "armor")
      .reduce((n, i) => n + i.system.armorBonus, 0);

    // Speed, with conditions on top. `this.parent.statuses` is filled during
    // `prepareEmbeddedDocuments`, which runs before this, so the conditions are already
    // in place here.
    this.speed.current = this.speed.base;
    const statuses = this.parent.statuses;
    if (statuses.has("immobilized") || statuses.has("grappled")) {
      this.speed.current = 0;
    } else if (statuses.has("slowed") || statuses.has("prone") || statuses.has("grappling")) {
      // One step down the ladder: 2 → 1 → ½ → 0.
      const step = SPEED_LADDER.indexOf(this.speed.current);
      this.speed.current = SPEED_LADDER[Math.max(0, step - 1)];
    }
  }

  /* -------------------------------------------- */

  /** Trait and skill scores, so a formula can read `@body` or `@violence`. */
  getRollData() {
    const data = {};
    for (const key of TRAIT_KEYS) data[key] = this.traits[key].score;
    for (const key of SKILL_KEYS) data[key] = this.skills[key];
    return data;
  }
}

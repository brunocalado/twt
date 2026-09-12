import TWTActorBase from "./base-actor.mjs";
import { SKILL_KEYS, TRAIT_KEYS } from "../helpers/config.mjs";
import { SPEED_LADDER } from "../helpers/effects.mjs";

/**
 * An NPC: one health pool, dead at 0 with no recovery test, and never able to strain.
 *
 * Traits and skills are plain numbers with **no maximum** — the Quickstart is
 * explicit that non-human monsters can exceed the human limit of 5.
 *
 * `armor.base` is stored here and derived on a Delver: an NPC's armor is an
 * intrinsic statblock number, a Delver's comes from the piece they are wearing.
 *
 * `abilities` and `actions` are structured rather than prose (R11). Every printed
 * statblock carries both, and the sheet's one-click rolls need `trait` and `skill`
 * as data.
 */
export default class TWTNPC extends TWTActorBase {
  static LOCALIZATION_PREFIXES = ["TWT.Actor", "TWT.NPC"];

  static defineSchema() {
    const fields = foundry.data.fields;
    const requiredInteger = { required: true, nullable: false, integer: true };
    const schema = super.defineSchema();

    schema.creatureType = new fields.StringField({
      required: true,
      nullable: false,
      blank: false,
      initial: "human",
      choices: ["human", "horror", "construct"]
    });

    schema.threat = new fields.NumberField({
      required: true,
      nullable: false,
      initial: 1,
      choices: [0.5, 1, 2, 4]
    });

    schema.size = new fields.NumberField({
      required: true,
      nullable: false,
      initial: 1,
      min: 0.5
    });

    schema.speed = new fields.NumberField({
      required: true,
      nullable: false,
      initial: 1,
      choices: [0, 0.5, 1, 2]
    });

    schema.tagline = new fields.StringField();
    schema.tactics = new fields.HTMLField();

    // Authored rather than computed, so the pool carries its own max.
    schema.hp = new fields.SchemaField({
      value: new fields.NumberField({ ...requiredInteger, initial: 5, min: 0 }),
      max: new fields.NumberField({ ...requiredInteger, initial: 5, min: 1 })
    });

    schema.armor = new fields.SchemaField({
      base: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 }),
      current: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 })
    });

    schema.traits = new fields.SchemaField(
      Object.fromEntries(
        TRAIT_KEYS.map((key) => [
          key,
          new fields.NumberField({ ...requiredInteger, initial: 3, min: 0 })
        ])
      )
    );

    schema.skills = new fields.SchemaField(
      Object.fromEntries(
        SKILL_KEYS.map((key) => [
          key,
          new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 })
        ])
      )
    );

    schema.abilities = new fields.ArrayField(
      new fields.SchemaField({
        name: new fields.StringField({ required: true, blank: false }),
        description: new fields.StringField()
      })
    );

    // `difficulty: null` means "roll against the target's own targetDifficulty".
    schema.actions = new fields.ArrayField(
      new fields.SchemaField({
        name: new fields.StringField({ required: true, blank: false }),
        actionType: new fields.StringField({
          required: true,
          nullable: false,
          blank: false,
          initial: "major",
          choices: ["major", "minor", "free"]
        }),
        trait: new fields.StringField({
          required: true,
          nullable: false,
          blank: false,
          initial: "body",
          choices: TRAIT_KEYS
        }),
        skill: new fields.StringField({
          required: true,
          nullable: false,
          blank: false,
          initial: "violence",
          choices: SKILL_KEYS
        }),
        difficulty: new fields.NumberField({ initial: null, min: 1, integer: true }),
        damage: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 }),
        damageType: new fields.StringField({
          required: true,
          nullable: false,
          blank: false,
          initial: "body",
          choices: TRAIT_KEYS
        }),
        piercing: new fields.BooleanField({ initial: false }),
        range: new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 }),
        // Free text: "once per segment", "once per round".
        frequency: new fields.StringField(),
        description: new fields.StringField(),
        // Free text: "Spend 1 boon to grapple the target."
        boons: new fields.StringField()
      })
    );

    return schema;
  }

  /* -------------------------------------------- */

  prepareDerivedData() {
    // One name for "speed after conditions" across both actor types, so the condition
    // layer has a single property to read on either. `this.parent.statuses` is filled
    // during `prepareEmbeddedDocuments`, which runs before this.
    this.speedCurrent = this.speed;
    const statuses = this.parent.statuses;
    if (statuses.has("immobilized") || statuses.has("grappled")) {
      this.speedCurrent = 0;
    } else if (statuses.has("slowed") || statuses.has("prone") || statuses.has("grappling")) {
      const step = SPEED_LADDER.indexOf(this.speedCurrent);
      this.speedCurrent = SPEED_LADDER[Math.max(0, step - 1)];
    }
  }

  /* -------------------------------------------- */

  getRollData() {
    const data = {};
    for (const key of TRAIT_KEYS) data[key] = this.traits[key];
    for (const key of SKILL_KEYS) data[key] = this.skills[key];
    return data;
  }
}

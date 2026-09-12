import TWTItemBase from "./base-item.mjs";
import { SKILL_KEYS } from "../helpers/config.mjs";

/**
 * A Feature: a special a Delver earns from a skill. Junior at skill 2, veteran at
 * skill 4. `skill` is blankable because a few Features come from a background
 * rather than from any one skill.
 */
export default class TWTFeature extends TWTItemBase {
  static LOCALIZATION_PREFIXES = ["TWT.Item", "TWT.Feature"];

  static defineSchema() {
    const fields = foundry.data.fields;
    const schema = super.defineSchema();

    schema.skill = new fields.StringField({ blank: true, choices: SKILL_KEYS });

    schema.tier = new fields.StringField({
      required: true,
      nullable: false,
      blank: false,
      initial: "junior",
      choices: ["junior", "veteran"]
    });

    return schema;
  }

  /* -------------------------------------------- */

  prepareDerivedData() {
    this.slotCost = 1;
  }
}

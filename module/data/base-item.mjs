/**
 * Fields shared by every record a Delver can hold.
 *
 * `rules` is deliberate (R10). The real records in the book are bespoke — the
 * Hand? Gun! cannot fire until reloaded as a minor action, the Parade Uniform
 * reflects damage as WILL damage, the Screwy Driver makes a whole category of
 * tests easier. Each would need its own schema branch. They get prose instead, and
 * the Keeper adjudicates.
 *
 * `restoreTrigger` is kept separate from `rules` because restoring *is* a
 * lifecycle the system drives (Safe Rest), and the text belongs on the record for
 * the player to read.
 */
export default class TWTItemBase extends foundry.abstract.TypeDataModel {
  static LOCALIZATION_PREFIXES = ["TWT.Item"];

  static defineSchema() {
    const fields = foundry.data.fields;
    const requiredInteger = { required: true, nullable: false, integer: true };

    return {
      description: new fields.HTMLField(),
      rules: new fields.HTMLField(),

      state: new fields.StringField({
        required: true,
        nullable: false,
        blank: false,
        initial: "normal",
        choices: ["normal", "exhausted", "destroyed"]
      }),

      charges: new fields.SchemaField({
        enabled: new fields.BooleanField({ initial: false }),
        value: new fields.NumberField({ ...requiredInteger, initial: 3, min: 0 }),
        max: new fields.NumberField({ ...requiredInteger, initial: 3, min: 0 })
      }),

      restoreTrigger: new fields.StringField()
    };
  }
}

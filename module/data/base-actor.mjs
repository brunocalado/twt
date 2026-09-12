/**
 * Fields shared by every Actor subtype.
 *
 * `targetDifficulty` lives here even though the Quickstart only prints one for
 * NPCs (R6): an NPC attacking a Delver still needs a number to roll against, and
 * 2M is the stated standard difficulty.
 *
 * `ward.warded` lives here (R5) so `isWarded()` works from the damage pipeline
 * onward without reaching into the scene-zone machinery that eventually drives it.
 */
export default class TWTActorBase extends foundry.abstract.TypeDataModel {
  static LOCALIZATION_PREFIXES = ["TWT.Actor"];

  static defineSchema() {
    const fields = foundry.data.fields;
    const requiredInteger = { required: true, nullable: false, integer: true };

    return {
      biography: new fields.HTMLField(),
      notes: new fields.HTMLField(),

      targetDifficulty: new fields.NumberField({ ...requiredInteger, initial: 2, min: 1 }),

      ward: new fields.SchemaField({
        warded: new fields.BooleanField({ initial: false })
      })
    };
  }
}

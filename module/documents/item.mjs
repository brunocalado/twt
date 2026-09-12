/**
 * The system Item — a record in one of a Delver's three slot grids.
 *
 * @extends {Item}
 */
export class TWTItem extends Item {
  /**
   * Per-subtype default artwork, so a new record already reads as equipment, a
   * feature or an adaptation before anyone edits it.
   * @type {Record<string, string>}
   */
  static DEFAULT_ICONS = {
    equipment: "icons/containers/bags/pack-leather-brown.webp",
    feature: "icons/skills/trades/academics-book-study-purple.webp",
    adaptation: "icons/magic/unholy/strike-body-explode-disintegrate.webp"
  };

  /** @inheritDoc */
  static getDefaultArtwork(itemData) {
    const img = TWTItem.DEFAULT_ICONS[itemData.type];
    return img ? { img } : super.getDefaultArtwork(itemData);
  }

  /* -------------------------------------------- */

  /** @inheritDoc */
  getRollData() {
    const rollData = { ...this.system };
    if (this.actor) rollData.actor = this.actor.getRollData();
    return rollData;
  }
}

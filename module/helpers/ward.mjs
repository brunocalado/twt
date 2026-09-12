/**
 * Whether an actor currently stands in warded light.
 *
 * The one reader for `system.ward.warded` (R5). Every subsystem that needs to know —
 * the recovery test, turn-end exposure, the segment loop — asks through here, so when
 * scene zones eventually drive the stored flag, nothing else has to change.
 *
 * @param {Actor} actor
 * @returns {boolean}
 */
export function isWarded(actor) {
  return actor?.system?.ward?.warded === true;
}

import { SYSTEM_ID, TEMPLATE_ROOT } from "../helpers/config.mjs";
import { describeCalendar, endSegment, makeCamp, relayHome, SEGMENTS } from "../helpers/travel.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * The expedition's clock: which day and segment it is, how long since anyone slept, and
 * the Keeper's controls for moving it along.
 *
 * Players see it read-only. Advancing a segment damages Delvers their user may not own,
 * so the button only exists for the Keeper and the work happens on that client.
 */
export class TWTSegmentClock extends HandlebarsApplicationMixin(ApplicationV2) {
  /** @override */
  static DEFAULT_OPTIONS = {
    id: "twt-segment-clock",
    classes: [SYSTEM_ID, "twt-clock"],
    // Wide enough for the three footer controls to sit on one line each.
    position: { width: 300, height: "auto" },
    window: { title: "TWT.Travel.ClockTitle", icon: "fa-solid fa-hourglass-half" },
    actions: {
      advance: TWTSegmentClock.#onAdvance,
      camp: TWTSegmentClock.#onCamp,
      relay: TWTSegmentClock.#onRelay
    }
  };

  /** @override */
  static PARTS = {
    clock: { template: `${TEMPLATE_ROOT}/hud/segment-clock.hbs` }
  };

  /* -------------------------------------------- */

  /** @override */
  async _prepareContext() {
    const clock = describeCalendar();
    return {
      clock,
      isGM: game.user.isGM,
      segments: SEGMENTS.map((key, index) => ({
        key,
        label: `TWT.Travel.Segment.${key}`,
        active: index === clock.segment
      })),
      party: party().map((a) => ({ id: a.id, name: a.name, warded: a.system.ward?.warded }))
    };
  }

  /* -------------------------------------------- */

  /** @this {TWTSegmentClock} */
  static async #onAdvance() {
    await endSegment(party());
    this.render();
  }

  /** @this {TWTSegmentClock} */
  static async #onCamp() {
    await makeCamp(party());
    this.render();
  }

  /** @this {TWTSegmentClock} */
  static async #onRelay() {
    await relayHome(party());
  }
}

/**
 * The expedition: every Delver a connected player is playing, falling back to every
 * Delver in the world when nobody is logged in.
 *
 * @returns {Actor[]}
 */
export function party() {
  const linked = game.users
    .filter((u) => !u.isGM && u.character?.type === "delver")
    .map((u) => u.character);
  if (linked.length) return [...new Set(linked)];
  return game.actors.filter((a) => a.type === "delver" && a.hasPlayerOwner);
}

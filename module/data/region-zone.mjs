/**
 * A zone: the abstract space combat is fought in.
 *
 * This is a **RegionBehaviorType** rather than a bag of flags on the Region, for one
 * practical reason — `TOKEN_ENTER` and `TOKEN_EXIT` are delivered to behaviors and to
 * nothing else. Making the zone itself the behavior means "is this region a zone" and
 * "does this region receive movement events" are the same question, and a Keeper adds a
 * zone the same way they add any other region behavior.
 *
 * **Adjacency is explicit, never spatial.** Zones are an abstraction: two regions can be
 * drawn touching and be mechanically distant, or drawn apart and connect by a stair.
 * Inferring adjacency from geometry would give wrong answers on exactly the maps where
 * zones matter most, so the Keeper lists the neighbours.
 */
export default class TWTZone extends foundry.data.regionBehaviors.RegionBehaviorType {
  static LOCALIZATION_PREFIXES = ["TWT.Zone"];

  static defineSchema() {
    const fields = foundry.data.fields;

    return {
      events: this._createEventsField({
        events: [CONST.REGION_EVENTS.TOKEN_ENTER, CONST.REGION_EVENTS.TOKEN_EXIT],
        initial: [CONST.REGION_EVENTS.TOKEN_ENTER, CONST.REGION_EVENTS.TOKEN_EXIT]
      }),

      terrain: new fields.StringField({
        required: true,
        nullable: false,
        blank: false,
        initial: "normal",
        choices: ["normal", "woods", "water", "barricade", "hazardous"]
      }),

      /** Whether light currently reaches this zone. */
      warded: new fields.BooleanField({ initial: false }),

      /** The Delver whose ward is spent on it, so a forced move can clear it. */
      wardedBy: new fields.StringField({ required: false, blank: true, initial: "" }),

      /** Neighbouring regions, by id. Drawn by the Keeper, not inferred. */
      adjacent: new fields.SetField(new fields.StringField({ blank: false }))
    };
  }

  /* -------------------------------------------- */

  /**
   * Recompute who is warded whenever a token crosses this zone's border.
   *
   * Region events are delivered to **every** connected client, so both handlers open by
   * standing down unless this one is the active GM. Without that guard each player's
   * client would issue the same actor update.
   */
  static events = {
    [CONST.REGION_EVENTS.TOKEN_ENTER]: async function (event) {
      if (!game.user.isActiveGM) return;
      const { syncWardedState, onZoneEntered } = await import("../helpers/zones.mjs");
      await onZoneEntered(this.region, event.data.token);
      await syncWardedState(this.region.parent);
    },

    [CONST.REGION_EVENTS.TOKEN_EXIT]: async function (event) {
      if (!game.user.isActiveGM) return;
      const { syncWardedState, onZoneExited } = await import("../helpers/zones.mjs");
      await onZoneExited(this.region, event.data.token, event.user);
      await syncWardedState(this.region.parent);
    }
  };
}

/**
 * The behavior subtype id.
 *
 * Bare, not `twt.zone`: a **system** declares its subtypes under plain names in
 * `system.json`'s `documentTypes`, exactly as `delver` and `equipment` are declared. The
 * `package-id.` prefix is the form modules use, and Foundry rejects it from a system with
 * "is not a valid type for the RegionBehavior Document class".
 */
export const ZONE_TYPE = "zone";

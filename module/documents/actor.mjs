/**
 * The system Actor.
 *
 * @extends {Actor}
 */
export class TWTActor extends Actor {
  /**
   * Prototype token defaults per subtype. Both actor types keep health at a
   * different path, which is exactly why the manifest declares no
   * `primaryTokenAttribute` — a single global path cannot serve both.
   *
   * A Delver's bars show the two pools a fight most often threatens: BODY takes
   * the hits, WILL takes what the Unknown does to a person.
   * @type {Record<string, object>}
   */
  static PROTOTYPE_TOKEN_DEFAULTS = {
    delver: {
      bar1: { attribute: "traits.body.hp" },
      bar2: { attribute: "traits.will.hp" },
      actorLink: true,
      sight: { enabled: true },
      disposition: CONST.TOKEN_DISPOSITIONS.FRIENDLY
    },
    npc: {
      bar1: { attribute: "hp" },
      bar2: { attribute: null },
      actorLink: false,
      disposition: CONST.TOKEN_DISPOSITIONS.HOSTILE
    }
  };

  /* -------------------------------------------- */

  /**
   * Seed the prototype token per subtype. A creation payload that already names a
   * bar attribute (a compendium import, a duplicate) keeps what it brought.
   * @inheritDoc
   */
  async _preCreate(data, options, user) {
    const allowed = await super._preCreate(data, options, user);
    if (allowed === false) return false;

    const defaults = TWTActor.PROTOTYPE_TOKEN_DEFAULTS[data.type];
    if (!defaults) return;
    if (data.prototypeToken?.bar1?.attribute !== undefined) return;

    this.updateSource({ prototypeToken: defaults });
  }

  /* -------------------------------------------- */

  /**
   * The whole system model, plus the flat trait/skill shorthands each subtype
   * contributes, so a formula can say `@body` as well as `@traits.body.score`.
   * @inheritDoc
   */
  getRollData() {
    return { ...this.system, ...this.system.getRollData?.() };
  }
}

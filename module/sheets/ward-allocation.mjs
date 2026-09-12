import { SYSTEM_ID, TEMPLATE_ROOT, TWT } from "../helpers/config.mjs";
import {
  assignWard,
  describeZone,
  reachableZones,
  sceneHasZones,
  zonesOccupiedBy
} from "../helpers/zones.mjs";
import { allocateTravelWard, travelWardPool } from "../helpers/travel.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Spending ward — on zones in combat, on people on the road.
 *
 * The two modes share a window because they are the same decision at two scales: a
 * finite pool of light, and more darkness than it covers.
 */
export class TWTWardAllocation extends HandlebarsApplicationMixin(ApplicationV2) {
  /**
   * @param {object} options
   * @param {"zones"|"travel"} options.mode
   * @param {Actor} [options.actor]    The Delver spending, in zone mode.
   * @param {Actor[]} [options.party]  The expedition, in travel mode.
   */
  constructor({ mode = "zones", actor = null, party = [], ...options } = {}) {
    super(options);
    this.mode = mode;
    this.actor = actor;
    this.party = party;
    /** Ids picked so far: region ids in zone mode, actor ids in travel mode. */
    this.picked = new Set();

    // Repel allocates before it rolls, so the caller has to be able to wait for this.
    this.promise = new Promise((resolve) => {
      this.#resolve = resolve;
    });
  }

  /** @type {(value: object|null) => void} */
  #resolve;

  /** Whether the promise has already settled. */
  #settled = false;

  /**
   * Resolve exactly once, so closing after a submit cannot overwrite the result.
   * @param {object|null} value
   */
  #settle(value) {
    if (this.#settled) return;
    this.#settled = true;
    this.#resolve(value);
  }

  /** @override */
  _onClose(options) {
    super._onClose(options);
    this.#settle(null);
  }

  /** @override */
  static DEFAULT_OPTIONS = {
    id: "twt-ward-allocation",
    classes: [SYSTEM_ID, "twt-dialog", "ward-allocation"],
    tag: "form",
    position: { width: 460, height: "auto" },
    window: { title: "TWT.Ward.Title", icon: "fa-solid fa-fire" },
    form: { handler: TWTWardAllocation.#onSubmit, closeOnSubmit: true },
    actions: { toggleTarget: TWTWardAllocation.#onToggleTarget }
  };

  /** @override */
  static PARTS = {
    form: { template: `${TEMPLATE_ROOT}/dialogs/ward-allocation.hbs` }
  };

  /* -------------------------------------------- */

  /**
   * Open the right mode, or explain why it cannot open.
   *
   * @param {object} options
   * @returns {TWTWardAllocation|null}
   */
  static open(options) {
    if (options.mode === "zones") {
      const scene = options.actor?.getActiveTokens?.(false, true)[0]?.parent ?? canvas.scene;
      // Zones are an enhancement, never a prerequisite: without them the sheet toggle is
      // still the whole feature, so say so rather than opening an empty window.
      if (!sceneHasZones(scene)) {
        ui.notifications.info("TWT.Ward.NoZones", { localize: true });
        return null;
      }
    }
    const app = new this(options);
    app.render({ force: true });
    return app;
  }

  /* -------------------------------------------- */

  /** @override */
  async _prepareContext() {
    if (this.mode === "travel") return this.#travelContext();
    return this.#zoneContext();
  }

  /**
   * Zone mode: this Delver's own zone first, then outward along the adjacency list as far
   * as their ward reaches.
   * @returns {object}
   */
  #zoneContext() {
    const pool = this.actor?.system.ward?.value ?? 0;
    const token = this.actor?.getActiveTokens?.(false, true)[0] ?? null;
    const origin = token ? zonesOccupiedBy(token)[0] : null;

    // Reach is the ward itself: one point lights your own zone, two lights a neighbour.
    const candidates = origin ? reachableZones(origin, Math.max(0, pool - 1)) : [];

    return {
      mode: "zones",
      actor: this.actor,
      pool,
      spent: this.picked.size,
      remaining: pool - this.picked.size,
      hasOrigin: !!origin,
      targets: candidates.map((region, index) => {
        const described = describeZone(region);
        return {
          ...described,
          id: region.id,
          isOrigin: index === 0,
          picked: this.picked.has(region.id),
          terrainLabel: TWT.terrains[described.terrain]
        };
      })
    };
  }

  /**
   * Travel mode: the pool is everyone's lanterns together, and each point covers one
   * Delver.
   * @returns {object}
   */
  #travelContext() {
    const pool = travelWardPool(this.party);
    return {
      mode: "travel",
      pool,
      spent: this.picked.size,
      remaining: pool - this.picked.size,
      hasOrigin: true,
      targets: this.party.map((actor) => ({
        id: actor.id,
        name: actor.name,
        img: actor.img,
        contributes: actor.system.ward?.value ?? 0,
        picked: this.picked.has(actor.id)
      }))
    };
  }

  /* -------------------------------------------- */

  /** @this {TWTWardAllocation} */
  static #onToggleTarget(event, target) {
    const id = target.dataset.targetId;
    if (this.picked.has(id)) this.picked.delete(id);
    else {
      const context = this.mode === "travel" ? this.#travelContext() : this.#zoneContext();
      if (context.remaining <= 0) {
        ui.notifications.warn("TWT.Ward.PoolSpent", { localize: true });
        return;
      }
      this.picked.add(id);
    }
    this.render();
  }

  /** @this {TWTWardAllocation} */
  static async #onSubmit() {
    const ids = [...this.picked];
    if (this.mode === "travel") {
      this.#settle(await allocateTravelWard(this.party, ids));
      return;
    }
    const scene = this.actor.getActiveTokens(false, true)[0]?.parent ?? canvas.scene;
    this.#settle(await assignWard(this.actor, scene, ids));
  }
}

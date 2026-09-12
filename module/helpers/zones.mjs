import { SYSTEM_ID, TWT } from "./config.mjs";
import { asGM, defineDelegate, resolveDelegated } from "./delegate.mjs";
import { setCondition } from "./effects.mjs";
import { ZONE_TYPE } from "../data/region-zone.mjs";

/**
 * Zones: reading them, counting what is in them, and keeping `ward.warded` in step with
 * which zone each token stands in.
 *
 * **Every path here checks for zones before assuming them.** Many tables will never draw
 * one, and in that mode ward falls back to the actor-level toggle on the sheet while the
 * turn-end and segment-end checks keep firing. Zone automation is an enhancement, never a
 * prerequisite.
 */

/** Over this many spaces a zone is Crowded. */
const CROWDED_AT = 4;

/* -------------------------------------------- */
/*  Reading                                     */
/* -------------------------------------------- */

/**
 * The zone behavior on a region, or null when the region is not a zone.
 *
 * @param {RegionDocument} region
 * @returns {RegionBehavior|null}
 */
export function zoneBehavior(region) {
  return region?.behaviors?.find((b) => b.type === ZONE_TYPE && !b.disabled) ?? null;
}

/**
 * Every zone on a scene.
 *
 * @param {Scene} scene
 * @returns {RegionDocument[]}
 */
export function zonesOf(scene) {
  if (!scene?.regions?.size) return [];
  return scene.regions.filter((r) => !!zoneBehavior(r));
}

/**
 * Whether this scene uses zones at all. Every caller asks before assuming.
 *
 * @param {Scene} scene
 * @returns {boolean}
 */
export function sceneHasZones(scene) {
  return zonesOf(scene).length > 0;
}

/**
 * The zones a token currently occupies. Regions can overlap, so this is a list.
 *
 * @param {TokenDocument} token
 * @returns {RegionDocument[]}
 */
export function zonesOccupiedBy(token) {
  if (!token?.regions?.size) return [];
  return [...token.regions].filter((r) => !!zoneBehavior(r));
}

/* -------------------------------------------- */

/**
 * How full a zone is.
 *
 * Occupancy is measured in spaces: a size-½ creature is half a space, a size-1 creature
 * one, a size-2 creature two. A Delver has no `size` field at all and always counts as
 * one, which the fallback covers.
 *
 * @param {RegionDocument} region
 * @returns {{spaces: number, crowded: boolean, tokens: number}}
 */
export function zoneOccupancy(region) {
  // `RegionDocument#tokens` is a Set, so it is spread before it is reduced.
  const tokens = [...(region?.tokens ?? [])];
  const spaces = tokens.reduce((n, t) => n + (t.actor?.system.size ?? 1), 0);
  return { spaces, crowded: spaces > CROWDED_AT, tokens: tokens.length };
}

/**
 * The zones reachable from one zone, out to a number of steps along the adjacency list.
 *
 * @param {RegionDocument} origin
 * @param {number} [steps=1]
 * @returns {RegionDocument[]}  The origin first, then each ring outward.
 */
export function reachableZones(origin, steps = 1) {
  const scene = origin?.parent;
  if (!scene) return [];

  const found = [origin];
  const seen = new Set([origin.id]);
  let frontier = [origin];

  for (let step = 0; step < steps; step++) {
    const next = [];
    for (const region of frontier) {
      const behavior = zoneBehavior(region);
      for (const id of behavior?.system.adjacent ?? []) {
        if (seen.has(id)) continue;
        const neighbour = scene.regions.get(id);
        if (!neighbour || !zoneBehavior(neighbour)) continue;
        seen.add(id);
        found.push(neighbour);
        next.push(neighbour);
      }
    }
    frontier = next;
    if (!frontier.length) break;
  }

  return found;
}

/* -------------------------------------------- */
/*  Terrain and crowding                        */
/* -------------------------------------------- */

/**
 * The modifiers a token's surroundings contribute to a test, each named so the roller
 * sees the reason and can drop it.
 *
 * Terrain is offered, never applied: the Keeper overrules it constantly.
 *
 * @param {Actor} actor
 * @param {object} [context]
 * @param {string} [context.trait]
 * @param {"attack"|"ranged"|"other"} [context.kind]
 * @returns {{id: string, label: string, value: number, suggested: boolean}[]}
 */
export function collectZoneModifiers(actor, { trait, kind = "other" } = {}) {
  const token = actor?.getActiveTokens?.(false, true)[0] ?? actor?.token ?? null;
  const zones = token ? zonesOccupiedBy(token) : [];
  if (!zones.length) return [];

  const mods = [];
  for (const zone of zones) {
    const behavior = zoneBehavior(zone);
    const { crowded } = zoneOccupancy(zone);

    if (crowded && trait === "body") {
      mods.push({ id: `crowded:${zone.id}`, label: "TWT.Zone.CrowdedModifier", value: 1, suggested: true });
    }
    if (behavior?.system.terrain === "woods" && kind === "ranged") {
      mods.push({ id: `cover:${zone.id}`, label: "TWT.Zone.CoverModifier", value: 1, suggested: false });
    }
  }
  return mods;
}

/* -------------------------------------------- */
/*  Ward allocation                             */
/* -------------------------------------------- */

/**
 * Register the privileged writes. A player's Shine assigns ward to regions, and region
 * documents are GM-owned in most worlds.
 */
export function registerZoneDelegates() {
  defineDelegate("setZoneWard", async (payload, { user }) => {
    const scene = await resolveDelegated(payload.sceneUuid, user);
    if (!scene) return { ok: false, reason: "not-found" };

    const actor = payload.actorUuid ? await resolveDelegated(payload.actorUuid, user) : null;
    // The boundary check: a player may only spend their own Delver's ward.
    if (actor && !actor.testUserPermission(user, "OWNER")) {
      return { ok: false, reason: "not-owner" };
    }

    return applyZoneWard(scene, payload.regionIds ?? [], {
      warded: payload.warded !== false,
      wardedBy: actor?.uuid ?? "",
      clearOthersBy: payload.clearOthersBy
    });
  });
}

/**
 * Light up a set of zones, and put out any this actor had lit before.
 *
 * @param {Scene} scene
 * @param {string[]} regionIds
 * @param {object} [options]
 * @param {boolean} [options.warded=true]
 * @param {string} [options.wardedBy]
 * @param {string} [options.clearOthersBy]  Drop this actor's other warded zones first.
 * @returns {Promise<object>}
 */
export async function applyZoneWard(scene, regionIds, { warded = true, wardedBy = "", clearOthersBy } = {}) {
  const updates = [];

  for (const region of zonesOf(scene)) {
    const behavior = zoneBehavior(region);
    const wanted = regionIds.includes(region.id);
    const heldByActor = clearOthersBy && behavior.system.wardedBy === clearOthersBy;

    if (wanted) {
      updates.push({ region, warded, wardedBy: warded ? wardedBy : "" });
    } else if (heldByActor && behavior.system.warded) {
      // A Delver's ward moves with them; it is not left burning behind.
      updates.push({ region, warded: false, wardedBy: "" });
    }
  }

  // One write per region's behavior collection, which is as batched as embedded
  // documents two levels down allow.
  for (const { region, warded: value, wardedBy: by } of updates) {
    const behavior = zoneBehavior(region);
    await region.updateEmbeddedDocuments("RegionBehavior", [
      { _id: behavior.id, "system.warded": value, "system.wardedBy": by }
    ]);
  }

  await syncWardedState(scene);
  return { ok: true, changed: updates.length };
}

/**
 * Assign ward from an actor, delegating when this client cannot write regions.
 *
 * @param {Actor} actor
 * @param {Scene} scene
 * @param {string[]} regionIds
 * @returns {Promise<object>}
 */
export function assignWard(actor, scene, regionIds) {
  const payload = {
    sceneUuid: scene.uuid,
    actorUuid: actor.uuid,
    regionIds,
    warded: true,
    clearOthersBy: actor.uuid
  };
  if (scene.canUserModify(game.user, "update")) {
    return applyZoneWard(scene, regionIds, {
      warded: true,
      wardedBy: actor.uuid,
      clearOthersBy: actor.uuid
    });
  }
  return asGM("setZoneWard", payload);
}

/* -------------------------------------------- */

/**
 * Push each token's zone state onto its actor.
 *
 * This is the **one** place `system.ward.warded` is written while zones are in play, so
 * the flag can never disagree with the map. On a scene with no zones it does nothing at
 * all, leaving the sheet toggle in charge.
 *
 * @param {Scene} scene
 * @returns {Promise<number>}  How many actors changed.
 */
export async function syncWardedState(scene) {
  if (!sceneHasZones(scene)) return 0;

  const updates = new Map();
  for (const token of scene.tokens) {
    const actor = token.actor;
    if (!actor) continue;

    const warded = zonesOccupiedBy(token).some((r) => zoneBehavior(r)?.system.warded);
    if (actor.system.ward?.warded === warded) continue;

    // An unlinked token carries its own actor data, so it is written through the token.
    updates.set(actor.uuid, { actor, warded });
  }

  for (const { actor, warded } of updates.values()) {
    await actor.update({ "system.ward.warded": warded });
  }
  return updates.size;
}

/* -------------------------------------------- */
/*  Movement                                    */
/* -------------------------------------------- */

/**
 * Entering a zone. A Crowded zone slows whoever pushes into it.
 *
 * @param {RegionDocument} region
 * @param {TokenDocument} token
 * @returns {Promise<void>}
 */
export async function onZoneEntered(region, token) {
  const actor = token?.actor;
  if (!actor) return;

  const behavior = zoneBehavior(region);
  const { crowded } = zoneOccupancy(region);

  if (crowded && !actor.statuses.has("slowed")) {
    await setCondition(actor, "slowed", { active: true });
  }
  if (["woods", "water"].includes(behavior?.system.terrain) && !actor.statuses.has("slowed")) {
    await setCondition(actor, "slowed", { active: true });
  }
}

/**
 * Leaving a zone.
 *
 * A Delver forced out drops every zone they were lighting — the ward went with them, and
 * the rules make the party reassign it. Walking out under your own power does not.
 *
 * Telling those apart cannot be `testUserPermission(user, "OWNER")`: a GM owns every
 * actor in the world, so that test would call a Keeper shoving a Delver across the map
 * "their own move" and the ward would never drop. The honest question is whether the
 * person who moved them is the person playing them.
 *
 * @param {RegionDocument} region
 * @param {TokenDocument} token
 * @param {User} user   Whoever caused the movement.
 * @returns {Promise<void>}
 */
export async function onZoneExited(region, token, user) {
  const actor = token?.actor;
  if (!actor) return;

  if (isOwnMove(actor, user)) return;

  const lit = zonesOf(region.parent).filter(
    (r) => zoneBehavior(r)?.system.wardedBy === actor.uuid
  );
  if (!lit.length) return;

  await applyZoneWard(region.parent, [], { warded: false, clearOthersBy: actor.uuid });
  ui.notifications.info(
    game.i18n.format("TWT.Zone.WardDisrupted", { name: actor.name, zones: lit.length })
  );
}

/**
 * Whether an actor moved under its own power.
 *
 * True when a player who owns it moved it, and true when the Keeper moved something no
 * player is playing — a Keeper's own creature walking is not being shoved. Everything
 * else is somebody else's doing.
 *
 * @param {Actor} actor
 * @param {User} user
 * @returns {boolean}
 */
export function isOwnMove(actor, user) {
  if (!user) return true;
  if (!user.isGM) return actor.testUserPermission(user, "OWNER");
  return !actor.hasPlayerOwner;
}

/* -------------------------------------------- */

/**
 * A readable summary of a zone, for the allocation dialog and the region config.
 *
 * @param {RegionDocument} region
 * @returns {object}
 */
export function describeZone(region) {
  const behavior = zoneBehavior(region);
  const { spaces, crowded } = zoneOccupancy(region);
  return {
    id: region.id,
    name: region.name,
    terrain: behavior?.system.terrain ?? "normal",
    terrainLabel: TWT.terrains[behavior?.system.terrain ?? "normal"],
    warded: !!behavior?.system.warded,
    wardedBy: behavior?.system.wardedBy ?? "",
    spaces,
    crowded,
    occupants: [...(region.tokens ?? [])].map((t) => t.name)
  };
}

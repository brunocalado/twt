import { SYSTEM_ID } from "./config.mjs";

/**
 * The system's one path for privileged writes.
 *
 * Almost every automation here crosses a permission line: a player's attack damages
 * an NPC they do not own, a turn-start refills armor on somebody else's Delver, a
 * segment-end check damages several Delvers at once. None of that works from a
 * player client, and improvising a proxy per subsystem produces several
 * incompatible half-solutions.
 *
 * So: `CONFIG.queries`, not raw sockets. A query is addressed to **one** user, so
 * the caller can await a result and see a failure. A raw `game.socket.emit` is a
 * fire-and-forget broadcast every client receives, which is the bug pattern this
 * exists to avoid — five connected clients all running the handler and all issuing
 * the same update.
 *
 * Two rules every caller follows:
 *
 * 1. **One writer.** Either the owner writes directly or it goes through `asGM`.
 *    Never both branches at once.
 * 2. **Validate at the boundary.** A payload arrives from another client as JSON, so
 *    it carries UUIDs rather than documents. Resolve them, confirm the sending user
 *    owns what they claim to act with, clamp the numbers. The system's own internals
 *    are trusted; this edge is not.
 */

/** Registered operations, by short name. @type {Map<string, Function>} */
const DELEGATES = new Map();

/**
 * Register a privileged operation under the system's query namespace.
 *
 * The handler runs **only** on the receiving client, and receives the requesting
 * `User` so it can check ownership before it writes. Each subsystem calls this for
 * its own operations during `init`, so this module never has to import them — the
 * dependency runs one way.
 *
 * @param {string} name  Short operation name, e.g. `"applyDamage"`.
 * @param {(payload: object, context: {user: User}) => Promise<*>} handler
 * @returns {string}     The full namespaced query name.
 */
export function defineDelegate(name, handler) {
  const queryName = `${SYSTEM_ID}.${name}`;
  DELEGATES.set(name, handler);
  CONFIG.queries[queryName] = handler;
  return queryName;
}

/* -------------------------------------------- */

/**
 * Run a privileged operation: locally when this client is the active GM, and
 * through the active GM otherwise.
 *
 * Never silently no-ops. A world with no GM connected, or one that has revoked the
 * `QUERY_USER` permission from players, comes back as a named failure with a
 * notification, so the cause is diagnosable rather than mysterious.
 *
 * @param {string} name       A name passed to {@link defineDelegate}.
 * @param {object} [payload]  JSON-serialisable data. UUIDs, never documents.
 * @returns {Promise<*>}      The handler's result, or `{ ok: false, reason }`.
 */
export async function asGM(name, payload = {}) {
  const handler = DELEGATES.get(name);
  if (!handler) throw new Error(`Unregistered TWT delegate "${name}"`);

  if (game.user.isActiveGM) return handler(payload, { user: game.user });

  const gm = game.users.activeGM;
  if (!gm) {
    ui.notifications.warn("TWT.Warning.NoActiveGM", { localize: true });
    return { ok: false, reason: "no-gm" };
  }

  // `User#query` throws outright when the caller lacks QUERY_USER. It is granted to
  // players by default, but a world that has tightened role permissions would
  // otherwise break every delegated write with nothing to point at.
  if (!game.user.hasPermission("QUERY_USER")) {
    ui.notifications.error("TWT.Warning.NoQueryPermission", { localize: true });
    return { ok: false, reason: "no-permission" };
  }

  try {
    return await gm.query(`${SYSTEM_ID}.${name}`, payload, { timeout: 10_000 });
  } catch (err) {
    console.error(`${SYSTEM_ID} | delegate "${name}" failed:`, err);
    ui.notifications.error("TWT.Warning.DelegateFailed", { localize: true });
    return { ok: false, reason: "failed", message: err.message };
  }
}

/* -------------------------------------------- */

/**
 * Resolve a UUID from a query payload and confirm the requesting user may act with
 * it. The single boundary check every handler opens with.
 *
 * @param {string} uuid                   The document UUID from the payload.
 * @param {User} user                     The requesting user.
 * @param {object} [options]
 * @param {boolean} [options.requireOwner=false]  Also require the user to own it.
 * @returns {Promise<Document|null>}      The document, or null when it fails the check.
 */
export async function resolveDelegated(uuid, user, { requireOwner = false } = {}) {
  if (typeof uuid !== "string") return null;
  const doc = await foundry.utils.fromUuid(uuid);
  if (!doc) return null;
  if (requireOwner && !doc.testUserPermission(user, "OWNER")) {
    console.warn(`${SYSTEM_ID} | ${user.name} is not an owner of ${uuid}; refusing.`);
    return null;
  }
  return doc;
}

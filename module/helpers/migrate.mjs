import { SETTINGS, SYSTEM_ID } from "./config.mjs";

/**
 * World migration.
 *
 * Cheap to add now, impossible to retrofit once worlds exist. For 0.0.1 the table
 * is empty — the plumbing is the point.
 *
 * Two conventions every migration here follows, because they are the difference
 * between a migration that finishes and one that times out:
 *
 * - **Batch.** One `updateDocuments` per collection, never one update per document.
 * - **Cover everything.** World actors, world items, unlocked compendium packs, and
 *   scene tokens carrying unlinked actor data. The unlinked tokens are the ones a
 *   migration forgets and a user reports.
 */

/**
 * @typedef {object} Migration
 * @property {string} version  The system version this migration brings a world up to.
 * @property {(report: MigrationReport) => Promise<void>} fn
 */

/**
 * Migrations in ascending version order. Each runs once, for any world whose last
 * migrated version is older than its `version`.
 * @type {Migration[]}
 */
const MIGRATIONS = [];

/* -------------------------------------------- */

/**
 * Run the migration gate. Called from `ready`, GM-only.
 *
 * @returns {Promise<boolean>}  Whether anything was migrated.
 */
export async function migrateWorld() {
  if (!game.user.isActiveGM) return false;

  const last = game.settings.get(SYSTEM_ID, SETTINGS.systemVersion);
  const current = game.system.version;

  // A fresh world stamps the current version and runs nothing. Only a world that
  // predates this build has anything to migrate.
  if (!foundry.utils.isNewerVersion(current, last)) return false;

  const pending = MIGRATIONS.filter((m) => foundry.utils.isNewerVersion(m.version, last));

  if (pending.length) {
    ui.notifications.info("TWT.Migration.Started", { localize: true, permanent: true });
    for (const migration of pending) {
      try {
        await migration.fn();
        console.log(`${SYSTEM_ID} | migrated world to ${migration.version}`);
      } catch (err) {
        console.error(`${SYSTEM_ID} | migration to ${migration.version} failed:`, err);
        ui.notifications.error("TWT.Migration.Failed", { localize: true, permanent: true });
        return false;
      }
    }
    ui.notifications.info("TWT.Migration.Complete", { localize: true, permanent: true });
  }

  await game.settings.set(SYSTEM_ID, SETTINGS.systemVersion, current);
  return pending.length > 0;
}

/* -------------------------------------------- */

/**
 * Walk every place an Actor or Item can live and apply a per-document transform,
 * batched one write per collection.
 *
 * Exported rather than private because a migration in the table above is the only
 * caller, and keeping the traversal in one place is what stops the next migration
 * from forgetting unlinked tokens.
 *
 * @param {object} transforms
 * @param {(actorData: object) => object|null} [transforms.actor]  Update data, or null to skip.
 * @param {(itemData: object) => object|null} [transforms.item]
 * @returns {Promise<void>}
 */
export async function migrateDocuments({ actor: actorFn, item: itemFn } = {}) {
  /** Collect `{_id, ...changes}` for every document a transform wants changed. */
  const collect = (documents, fn) => {
    if (!fn) return [];
    const updates = [];
    for (const doc of documents) {
      const changes = fn(doc.toObject());
      if (changes && !foundry.utils.isEmpty(changes)) updates.push({ _id: doc.id, ...changes });
    }
    return updates;
  };

  // World collections.
  const actorUpdates = collect(game.actors, actorFn);
  if (actorUpdates.length) await Actor.implementation.updateDocuments(actorUpdates);

  const itemUpdates = collect(game.items, itemFn);
  if (itemUpdates.length) await Item.implementation.updateDocuments(itemUpdates);

  // Items owned by world actors, one batch per actor.
  if (itemFn) {
    for (const actor of game.actors) {
      const owned = collect(actor.items, itemFn);
      if (owned.length) await actor.updateEmbeddedDocuments("Item", owned);
    }
  }

  // Unlocked compendium packs of our own document types.
  for (const pack of game.packs) {
    if (pack.locked) continue;
    if (!["Actor", "Item"].includes(pack.documentName)) continue;
    const documents = await pack.getDocuments();
    const fn = pack.documentName === "Actor" ? actorFn : itemFn;
    const updates = collect(documents, fn);
    if (updates.length) {
      await pack.documentClass.implementation.updateDocuments(updates, { pack: pack.collection });
    }
  }

  // Scene tokens carrying their own unlinked actor data — the easy ones to miss.
  for (const scene of game.scenes) {
    const tokenUpdates = [];
    for (const token of scene.tokens) {
      if (token.actorLink || !token.actor) continue;
      const changes = actorFn?.(token.actor.toObject());
      if (changes && !foundry.utils.isEmpty(changes)) {
        tokenUpdates.push({ _id: token.id, delta: { ...changes } });
      }
    }
    if (tokenUpdates.length) await scene.updateEmbeddedDocuments("Token", tokenUpdates);
  }
}

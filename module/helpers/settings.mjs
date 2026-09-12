import { SETTINGS, SHEET_THEMES, SYSTEM_ID } from "./config.mjs";
import { registerProjectSetting } from "./projects.mjs";

/**
 * Every world and client setting the system owns, registered in one place.
 *
 * The automation toggles all default to **on**, and each is honoured at the single
 * point where its automation fires — never re-checked at the call sites, which is
 * how a toggle ends up half-respected.
 */
export function registerSettings() {
  // Hidden: the version this world was last migrated to. Written only by the
  // migration gate.
  game.settings.register(SYSTEM_ID, SETTINGS.systemVersion, {
    scope: "world",
    config: false,
    type: String,
    default: "0.0.0"
  });

  // Hidden: the travel clock. Shaped here so Phase 09 has somewhere to write.
  game.settings.register(SYSTEM_ID, SETTINGS.calendar, {
    scope: "world",
    config: false,
    type: Object,
    default: { day: 1, segment: 0, segmentsSinceCamp: 0 }
  });

  game.settings.register(SYSTEM_ID, SETTINGS.autoRecoveryTest, {
    name: "TWT.Setting.AutoRecoveryTest.Name",
    hint: "TWT.Setting.AutoRecoveryTest.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(SYSTEM_ID, SETTINGS.autoArmorRefill, {
    name: "TWT.Setting.AutoArmorRefill.Name",
    hint: "TWT.Setting.AutoArmorRefill.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(SYSTEM_ID, SETTINGS.autoUnknownExposure, {
    name: "TWT.Setting.AutoUnknownExposure.Name",
    hint: "TWT.Setting.AutoUnknownExposure.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(SYSTEM_ID, SETTINGS.enforceSlotLimits, {
    name: "TWT.Setting.EnforceSlotLimits.Name",
    hint: "TWT.Setting.EnforceSlotLimits.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  // The project list lives with the rest of the world state rather than as a Document
  // collection: a project is a name and two numbers.
  registerProjectSetting();

  game.settings.register(SYSTEM_ID, SETTINGS.sheetTheme, {
    name: "TWT.Setting.SheetTheme.Name",
    hint: "TWT.Setting.SheetTheme.Hint",
    scope: "client",
    config: true,
    type: String,
    choices: SHEET_THEMES,
    default: "soot",
    requiresReload: false
  });
}

/* -------------------------------------------- */

/**
 * Read one of this system's settings.
 * @param {string} key  A key from {@link SETTINGS}.
 * @returns {*}         The setting's current value.
 */
export function setting(key) {
  return game.settings.get(SYSTEM_ID, key);
}

/**
 * Time Without Tide — system entry point.
 *
 * Registers the data models, document classes, sheets, settings, conditions and
 * privileged operations, and hangs the system's own namespace off `game.twt` so macros
 * and the console have one documented way in.
 */
import { TWTActor } from "./documents/actor.mjs";
import { TWTItem } from "./documents/item.mjs";
import { TWTCombat } from "./documents/combat.mjs";
import TWTZone, { ZONE_TYPE } from "./data/region-zone.mjs";
import { TWTSegmentClock, party } from "./sheets/segment-clock.mjs";
import { TWTWardAllocation } from "./sheets/ward-allocation.mjs";
import { TWTDelverSheet, TWTNPCSheet } from "./sheets/actor-sheet.mjs";
import { TWTItemSheet } from "./sheets/item-sheet.mjs";
import { TWTTestDialog } from "./sheets/test-dialog.mjs";
import { TWTDamageDialog } from "./sheets/damage-dialog.mjs";
import { SYSTEM_ID, TEMPLATE_ROOT, TWT } from "./helpers/config.mjs";
import { registerSettings, setting } from "./helpers/settings.mjs";
import { asGM, defineDelegate } from "./helpers/delegate.mjs";
import { migrateWorld } from "./helpers/migrate.mjs";
import { registerConditions, setCondition } from "./helpers/effects.mjs";
import { MARK_THRESHOLD, performTest, strainTest } from "./helpers/roll.mjs";
import { activateTestCard, requestTest } from "./helpers/test-flow.mjs";
import {
  applyDamage,
  applyDamageToMany,
  damage,
  healActor,
  previewDamage,
  refillArmor,
  registerDamageDelegate
} from "./helpers/damage.mjs";
import { manifestMalignantAdaptation, runRecoveryTest } from "./helpers/recovery.mjs";
import { safeRest } from "./helpers/rest.mjs";
import {
  attackOptions,
  performAction,
  performAttack,
  refundAction,
  spendAction
} from "./helpers/actions.mjs";
import { isWarded } from "./helpers/ward.mjs";
import {
  assignWard,
  describeZone,
  registerZoneDelegates,
  sceneHasZones,
  syncWardedState,
  zoneOccupancy,
  zonesOf
} from "./helpers/zones.mjs";
import {
  allocateTravelWard,
  describeCalendar,
  endSegment,
  makeCamp,
  registerSegmentDelegate,
  registerTravelDelegates,
  relayHome,
  setCalendar,
  travelWardPool
} from "./helpers/travel.mjs";
import { contributeToProject, deleteProject, projects, registerProjectDelegates, startProject } from "./helpers/projects.mjs";
import * as models from "./data/_module.mjs";

const collections = foundry.documents.collections;

/* -------------------------------------------- */
/*  Namespace                                   */
/* -------------------------------------------- */

// Assigned while this module's top-level code runs, which is before `globalThis.game`
// exists. The `init` hook below mirrors it onto `game.twt`, the first point a macro can
// reach it. Compendium macros call through this, so the surface is deliberate rather
// than whatever happened to be importable.
globalThis.twt = {
  config: TWT,
  documents: { TWTActor, TWTItem },
  applications: {
    TWTDelverSheet,
    TWTNPCSheet,
    TWTItemSheet,
    TWTTestDialog,
    TWTDamageDialog,
    TWTSegmentClock,
    TWTWardAllocation
  },
  delegate: { asGM, defineDelegate },
  settings: { setting },
  roll: { performTest, strainTest, requestTest, MARK_THRESHOLD },
  damage: { applyDamage, applyDamageToMany, damage, previewDamage, healActor, refillArmor },
  recovery: { runRecoveryTest, manifestMalignantAdaptation },
  conditions: { setCondition },
  rest: { safeRest },
  actions: { performAction, performAttack, attackOptions, spendAction, refundAction },
  ward: { isWarded, assignWard, syncWardedState },
  zones: { zonesOf, zoneOccupancy, describeZone, sceneHasZones },
  travel: {
    describeCalendar,
    setCalendar,
    endSegment,
    makeCamp,
    relayHome,
    allocateTravelWard,
    travelWardPool,
    party
  },
  projects: { projects, startProject, contributeToProject, deleteProject },
  models
};

/* -------------------------------------------- */
/*  Init                                        */
/* -------------------------------------------- */

Hooks.once("init", () => {
  game.twt = globalThis.twt;

  CONFIG.TWT = TWT;

  registerSettings();
  registerConditions();
  registerDamageDelegate();
  registerZoneDelegates();
  registerTravelDelegates();
  registerSegmentDelegate();
  registerProjectDelegates();

  // A zone is a Region Behavior rather than a bag of flags, because TOKEN_ENTER and
  // TOKEN_EXIT are delivered to behaviors and to nothing else.
  CONFIG.RegionBehavior.dataModels[ZONE_TYPE] = TWTZone;
  CONFIG.RegionBehavior.typeLabels[ZONE_TYPE] = "TWT.Zone.TypeLabel";
  CONFIG.RegionBehavior.typeIcons[ZONE_TYPE] = "fa-solid fa-vector-square";

  CONFIG.Actor.documentClass = TWTActor;
  CONFIG.Actor.dataModels.delver = models.TWTDelver;
  CONFIG.Actor.dataModels.npc = models.TWTNPC;

  CONFIG.Combat.documentClass = TWTCombat;
  // The manifest already declares `"initiative": "1d6"`, which `Combatant#_getInitiativeFormula`
  // falls through to — so no subclass is needed for initiative itself. Only the display
  // needs fixing: core defaults to two decimals, which renders a d6 as "4.00".
  CONFIG.Combat.initiative.decimals = 0;

  CONFIG.Item.documentClass = TWTItem;
  CONFIG.Item.dataModels.equipment = models.TWTEquipment;
  CONFIG.Item.dataModels.feature = models.TWTFeature;
  CONFIG.Item.dataModels.adaptation = models.TWTAdaptation;

  // Token bars and the resource picker. Two registrations rather than a manifest
  // `primaryTokenAttribute`, because the two actor types keep health at different paths
  // and that field is a single global one.
  CONFIG.Actor.trackableAttributes = {
    delver: {
      bar: ["traits.body.hp", "traits.mind.hp", "traits.will.hp"],
      value: ["armor.current", "ward.value", "speed.current"]
    },
    npc: {
      bar: ["hp"],
      value: ["armor.current", "speed"]
    }
  };

  collections.Actors.registerSheet(SYSTEM_ID, TWTDelverSheet, {
    types: ["delver"],
    makeDefault: true,
    label: "TWT.SheetLabel.Delver"
  });
  collections.Actors.registerSheet(SYSTEM_ID, TWTNPCSheet, {
    types: ["npc"],
    makeDefault: true,
    label: "TWT.SheetLabel.NPC"
  });
  collections.Items.registerSheet(SYSTEM_ID, TWTItemSheet, {
    types: ["equipment", "feature", "adaptation"],
    makeDefault: true,
    label: "TWT.SheetLabel.Item"
  });

  // Partials pulled in with `{{> ... }}`, as opposed to ApplicationV2 PARTS, which load
  // themselves. Registered by name so the templates stay readable.
  foundry.applications.handlebars.loadTemplates({
    "twt.record-card": `${TEMPLATE_ROOT}/actor/parts/record-card.hbs`,
    "twt.item-charges": `${TEMPLATE_ROOT}/item/parts/charges.hbs`
  });
});

/* -------------------------------------------- */
/*  Chat                                        */
/* -------------------------------------------- */

/**
 * Wire the buttons a test card carries.
 *
 * This hook fires on every client, so the handler only attaches listeners — what each
 * button does is guarded at click time, because two clients can race the same card.
 * `renderChatMessageHTML` is the v13+ name and hands over an `HTMLElement`; the older
 * `renderChatMessage` is deprecated.
 */
Hooks.on("renderChatMessageHTML", (message, html) => {
  activateTestCard(message, html);
});

/* -------------------------------------------- */
/*  Ready                                       */
/* -------------------------------------------- */

Hooks.once("ready", async () => {
  await migrateWorld();

  // Zone occupancy decides who is warded, and tokens move for reasons other than a
  // region event — a scene load, a Keeper dragging somebody. One reconciliation pass on
  // ready keeps the flag honest without polling.
  if (game.user.isActiveGM && canvas.scene && sceneHasZones(canvas.scene)) {
    await syncWardedState(canvas.scene);
  }
});

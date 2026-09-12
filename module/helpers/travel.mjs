import { SETTINGS, SYSTEM_ID } from "./config.mjs";
import { setting } from "./settings.mjs";
import { asGM, defineDelegate } from "./delegate.mjs";
import { requestTest } from "./test-flow.mjs";
import { applyDamageToMany } from "./damage.mjs";
import { setCondition } from "./effects.mjs";
import { isWarded } from "./ward.mjs";
import { postCard } from "./chat.mjs";

/**
 * The travel clock and the segment loop.
 *
 * Ward and travel are one rule wearing two hats. The Unknown attacks after each action:
 * once per turn in combat, once per segment on the road. The check is identical — Will +
 * Survival or 1 Will damage — and only the cadence and the allocation model differ.
 */

/** Three segments to a day. */
export const SEGMENTS = ["morning", "afternoon", "night"];

/** Six days to a sixday. */
export const DAY_NAMES = ["Oneday", "Twoday", "Threeday", "Fourday", "Fiveday", "Sixday"];

/** Camp is owed once a day, which is every three segments. */
const SEGMENTS_PER_CAMP = SEGMENTS.length;

/* -------------------------------------------- */
/*  The clock                                   */
/* -------------------------------------------- */

/**
 * The expedition's clock, as stored.
 * @returns {{day: number, segment: number, segmentsSinceCamp: number, fatigueStep: number}}
 */
export function calendar() {
  const stored = setting(SETTINGS.calendar) ?? {};
  return {
    day: stored.day ?? 1,
    segment: stored.segment ?? 0,
    segmentsSinceCamp: stored.segmentsSinceCamp ?? 0,
    // The Fatigued test escalates across segments, and that is a property of the
    // expedition rather than of any one Delver.
    fatigueStep: stored.fatigueStep ?? 0
  };
}

/**
 * The clock, spelled out.
 * @returns {object}
 */
export function describeCalendar() {
  const clock = calendar();
  return {
    ...clock,
    segmentKey: SEGMENTS[clock.segment] ?? SEGMENTS[0],
    segmentLabel: `TWT.Travel.Segment.${SEGMENTS[clock.segment] ?? SEGMENTS[0]}`,
    dayName: DAY_NAMES[(clock.day - 1) % DAY_NAMES.length],
    sixday: Math.floor((clock.day - 1) / DAY_NAMES.length) + 1,
    campOwed: clock.segmentsSinceCamp >= SEGMENTS_PER_CAMP
  };
}

/** Register the privileged clock writes — the calendar is a world setting. */
export function registerTravelDelegates() {
  defineDelegate("setCalendar", async (payload, { user }) => {
    if (!user.isGM) return { ok: false, reason: "not-gm" };
    await game.settings.set(SYSTEM_ID, SETTINGS.calendar, payload.calendar);
    return { ok: true, calendar: calendar() };
  });
}

/**
 * Write the clock, through the Keeper when this client cannot.
 *
 * @param {object} changes  Merged onto the current clock.
 * @returns {Promise<object>}
 */
export async function setCalendar(changes) {
  const next = { ...calendar(), ...changes };
  if (game.user.isGM) {
    await game.settings.set(SYSTEM_ID, SETTINGS.calendar, next);
    return { ok: true, calendar: next };
  }
  return asGM("setCalendar", { calendar: next });
}

/* -------------------------------------------- */
/*  The segment loop                            */
/* -------------------------------------------- */

/**
 * Pool the party's ward and spread it over the Delvers.
 *
 * Each point of ward protects one Delver. Whoever is left over travels unwarded and is
 * flagged as such, because that is the decision the table has to make out loud.
 *
 * @param {Actor[]} party
 * @param {string[]} wardedIds   The Delvers the party chose to protect.
 * @returns {Promise<object>}
 */
export async function allocateTravelWard(party, wardedIds) {
  const pool = travelWardPool(party);
  const protectedIds = wardedIds.slice(0, pool);

  const updates = party.map((actor) => ({
    _id: actor.id,
    "system.ward.warded": protectedIds.includes(actor.id)
  }));
  if (updates.length) await Actor.implementation.updateDocuments(updates);

  return {
    ok: true,
    pool,
    warded: protectedIds.length,
    unwarded: party.length - protectedIds.length
  };
}

/**
 * The party's total ward: every wielded lantern across every Delver.
 *
 * @param {Actor[]} party
 * @returns {number}
 */
export function travelWardPool(party) {
  return party.reduce((n, actor) => n + (actor.system.ward?.value ?? 0), 0);
}

/**
 * End a segment: expose the unwarded, check fatigue, and advance the clock.
 *
 * This damages several actors the acting user may not own, so it runs on the Keeper's
 * client and writes in **one batch** rather than one update per Delver.
 *
 * @param {Actor[]} party
 * @param {object} [options]
 * @param {boolean} [options.camp=false]  This segment was spent making camp.
 * @returns {Promise<object>}
 */
export async function endSegment(party, { camp = false } = {}) {
  if (!game.user.isGM) return asGM("endSegment", { partyIds: party.map((a) => a.id), camp });

  const clock = calendar();
  const report = { exposed: [], fatigued: [], camp, segment: describeCalendar() };

  /* ---- The Unknown, for anyone travelling without light ---- */
  if (setting(SETTINGS.autoUnknownExposure)) {
    const unwarded = party.filter((a) => !isWarded(a));
    const failures = [];

    for (const actor of unwarded) {
      const rolled = await requestTest(actor, {
        trait: "will",
        skill: "survival",
        difficulty: 2,
        label: game.i18n.localize("TWT.Unknown.Exposure"),
        skipDialog: true
      });
      report.exposed.push({ name: actor.name, success: !!rolled?.result.success });
      if (!rolled?.result.success) failures.push(actor);
    }

    if (failures.length) {
      await applyDamageToMany(failures, {
        amount: 1,
        type: "will",
        piercing: true,
        source: "TWT.Unknown.Source",
        silent: true
      });
    }
  }

  /* ---- Fatigue ---- */
  const { applyFatigue } = await import("./fatigue.mjs");
  report.fatigued = await applyFatigue(party, { camp });

  /* ---- The clock ---- */
  // `fatigueStep` is deliberately absent: applyFatigue has just raised it, and writing
  // back the value read at the top of this function would wipe the escalation every time.
  const segment = (clock.segment + 1) % SEGMENTS.length;
  const day = segment === 0 ? clock.day + 1 : clock.day;
  await setCalendar({
    day,
    segment,
    segmentsSinceCamp: camp ? 0 : clock.segmentsSinceCamp + 1,
    ...(camp ? { fatigueStep: 0 } : {})
  });

  await postSegmentCard(report);
  return report;
}

/** Register the delegated form, so a player can end a segment the Keeper resolves. */
export function registerSegmentDelegate() {
  defineDelegate("endSegment", async (payload, { user }) => {
    if (!user.isGM) return { ok: false, reason: "not-gm" };
    const party = (payload.partyIds ?? []).map((id) => game.actors.get(id)).filter(Boolean);
    return endSegment(party, { camp: payload.camp === true });
  });
}

/* -------------------------------------------- */

/**
 * Report the segment that just ended.
 *
 * @param {object} report
 * @returns {Promise<ChatMessage>}
 */
async function postSegmentCard(report) {
  const sections = [];

  if (report.camp) sections.push({ content: game.i18n.localize("TWT.Travel.Camped") });

  if (report.exposed.length) {
    sections.push({
      label: "TWT.Unknown.Exposure",
      content: report.exposed
        .map((e) =>
          game.i18n.format(e.success ? "TWT.Travel.Endured" : "TWT.Travel.Succumbed", { name: e.name })
        )
        .join("<br>")
    });
  }

  if (report.fatigued.length) {
    sections.push({
      label: "TWT.Condition.Fatigued",
      content: report.fatigued
        .map((f) =>
          game.i18n.format(f.success ? "TWT.Travel.Rested" : "TWT.Travel.Worn", {
            name: f.name,
            difficulty: f.difficulty
          })
        )
        .join("<br>")
    });
  }

  const next = describeCalendar();
  return postCard({
    kind: "rest",
    title: game.i18n.localize("TWT.Travel.SegmentEnded"),
    subtitle: game.i18n.format("TWT.Travel.NowReads", {
      day: next.day,
      dayName: next.dayName,
      segment: game.i18n.localize(next.segmentLabel)
    }),
    badge: next.campOwed ? game.i18n.localize("TWT.Travel.CampOwed") : "",
    sections
  });
}

/* -------------------------------------------- */

/**
 * Make camp: the clock resets, Fatigued lifts.
 *
 * @param {Actor[]} party
 * @returns {Promise<object>}
 */
export async function makeCamp(party) {
  for (const actor of party) {
    if (actor.statuses.has("fatigued")) await setCondition(actor, "fatigued", { active: false });
  }
  return endSegment(party, { camp: true });
}

/**
 * The relay home. There is no world map to move tokens across, so this is bookkeeping
 * the table narrates rather than an automation.
 *
 * @param {Actor[]} party
 * @returns {Promise<ChatMessage>}
 */
export async function relayHome(party) {
  return postCard({
    kind: "rest",
    title: game.i18n.localize("TWT.Travel.Relay"),
    subtitle: game.i18n.localize("TWT.Travel.RelaySubtitle"),
    sections: [
      { content: game.i18n.format("TWT.Travel.RelayBody", { names: party.map((a) => a.name).join(", ") }) }
    ]
  });
}

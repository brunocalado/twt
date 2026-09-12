/**
 * The system's dependency-free constant leaf.
 *
 * Nothing in here imports from the rest of the system, so every other module can
 * import it without any risk of a circular import. Every system-wide constant
 * lives here: the id, the path roots, flag and setting keys, and the `TWT`
 * configuration object exposed as `CONFIG.TWT`.
 *
 * Every human-readable value in `TWT` is a localization key, never a display
 * string — `lang/en.json` resolves them.
 */

/** The system id, exactly as it appears in `system.json`. Never written as a literal elsewhere. */
export const SYSTEM_ID = "twt";

/** Root of the Handlebars template tree, as Foundry's template loader sees it. */
export const TEMPLATE_ROOT = `systems/${SYSTEM_ID}/templates`;

/** Root of the shipped asset tree (logo, glyphs, backgrounds). */
export const ASSET_ROOT = `systems/${SYSTEM_ID}/assets`;

/* -------------------------------------------- */
/*  Key orders                                  */
/* -------------------------------------------- */

/** The three traits, in sheet order. Each has a health pool equal to its score. */
export const TRAIT_KEYS = ["body", "mind", "will"];

/** The six skills, in sheet order. */
export const SKILL_KEYS = [
  "culture",
  "industry",
  "navigation",
  "skulduggery",
  "survival",
  "violence"
];

/** Adaptation tiers from least to most developed. Effects accumulate along this order (R1). */
export const ADAPTATION_TIER_ORDER = ["malignant", "awakened1", "awakened2", "awakened3"];

/** Record slot groups: the item type each holds, and the trait whose score doubles into its max. */
export const SLOT_GROUPS = {
  items: { itemType: "equipment", trait: "body" },
  features: { itemType: "feature", trait: "mind" },
  adaptations: { itemType: "adaptation", trait: "will" }
};

/* -------------------------------------------- */
/*  Flag & setting keys                         */
/* -------------------------------------------- */

/**
 * Flag keys used with `getFlag`/`setFlag` under the `SYSTEM_ID` scope.
 *
 * `test` holds a whole test's state on its chat message. The card re-renders from
 * it, which is what makes a strain one `message.update()` rather than a bespoke
 * broadcast.
 */
export const FLAGS = {
  test: "test",
  /** Timestamp of the last hit an actor took, for the out-of-combat armor rest. */
  lastHitAt: "lastHitAt",
  /** Combatant flags: whether this turn's major and minor action have been spent. */
  majorUsed: "majorUsed",
  minorUsed: "minorUsed",
  /** Combatant flag: surprised combatants take no actions in round 1. */
  surprised: "surprised"
};

/**
 * World/client setting keys. Every `game.settings` call names one of these rather
 * than a string literal, and always under the `SYSTEM_ID` scope.
 */
export const SETTINGS = {
  /** Last version this world was migrated to. Drives the migration gate. */
  systemVersion: "systemVersion",
  /** Day, segment index, and segments since the last camp. */
  calendar: "calendar",
  /** Roll the recovery test automatically at 0 health, or only prompt for it. */
  autoRecoveryTest: "autoRecoveryTest",
  /** Refill armor at the start of each combat turn. */
  autoArmorRefill: "autoArmorRefill",
  /** Prompt the unwarded exposure check at turn and segment end. */
  autoUnknownExposure: "autoUnknownExposure",
  /** Block records that overflow a slot group, or warn and allow. */
  enforceSlotLimits: "enforceSlotLimits",
  /** Per-viewer sheet theme variant. */
  sheetTheme: "sheetTheme"
};

/** Choices for the `sheetTheme` client setting. */
export const SHEET_THEMES = {
  soot: "TWT.Setting.SheetTheme.Soot",
  parchment: "TWT.Setting.SheetTheme.Parchment"
};

/* -------------------------------------------- */
/*  CONFIG.TWT                                  */
/* -------------------------------------------- */

/** The game configuration object, exposed as `CONFIG.TWT`. */
export const TWT = {
  traits: {
    body: {
      label: "TWT.Trait.Body",
      abbr: "TWT.Trait.BodyAbbr",
      img: `${ASSET_ROOT}/icons/body.svg`
    },
    mind: {
      label: "TWT.Trait.Mind",
      abbr: "TWT.Trait.MindAbbr",
      img: `${ASSET_ROOT}/icons/mind.svg`
    },
    will: {
      label: "TWT.Trait.Will",
      abbr: "TWT.Trait.WillAbbr",
      img: `${ASSET_ROOT}/icons/will.svg`
    }
  },

  skills: {
    culture: {
      label: "TWT.Skill.Culture",
      abbr: "TWT.Skill.CultureAbbr",
      img: `${ASSET_ROOT}/icons/culture.svg`
    },
    industry: {
      label: "TWT.Skill.Industry",
      abbr: "TWT.Skill.IndustryAbbr",
      img: `${ASSET_ROOT}/icons/industry.svg`
    },
    navigation: {
      label: "TWT.Skill.Navigation",
      abbr: "TWT.Skill.NavigationAbbr",
      img: `${ASSET_ROOT}/icons/navigation.svg`
    },
    skulduggery: {
      label: "TWT.Skill.Skulduggery",
      abbr: "TWT.Skill.SkulduggeryAbbr",
      img: `${ASSET_ROOT}/icons/skulduggery.svg`
    },
    survival: {
      label: "TWT.Skill.Survival",
      abbr: "TWT.Skill.SurvivalAbbr",
      img: `${ASSET_ROOT}/icons/survival.svg`
    },
    violence: {
      label: "TWT.Skill.Violence",
      abbr: "TWT.Skill.ViolenceAbbr",
      img: `${ASSET_ROOT}/icons/violence.svg`
    }
  },

  equipCategories: {
    weapon: "TWT.Category.Weapon",
    armor: "TWT.Category.Armor",
    lantern: "TWT.Category.Lantern",
    gear: "TWT.Category.Gear"
  },

  equipStates: {
    stored: "TWT.EquipState.Stored",
    wielded: "TWT.EquipState.Wielded",
    worn: "TWT.EquipState.Worn"
  },

  recordStates: {
    normal: "TWT.State.Normal",
    exhausted: "TWT.State.Exhausted",
    destroyed: "TWT.State.Destroyed"
  },

  creatureTypes: {
    human: "TWT.CreatureType.Human",
    horror: "TWT.CreatureType.Horror",
    construct: "TWT.CreatureType.Construct"
  },

  featureTiers: {
    junior: "TWT.Feature.Junior",
    veteran: "TWT.Feature.Veteran"
  },

  adaptationTiers: {
    malignant: { label: "TWT.Adaptation.Malignant", slotCost: 1 },
    awakened1: { label: "TWT.Adaptation.Awakened1", slotCost: 1 },
    awakened2: { label: "TWT.Adaptation.Awakened2", slotCost: 2 },
    awakened3: { label: "TWT.Adaptation.Awakened3", slotCost: 3 }
  },

  actionTypes: {
    major: "TWT.ActionType.Major",
    minor: "TWT.ActionType.Minor",
    free: "TWT.ActionType.Free"
  },

  speeds: {
    0: "TWT.Speed.None",
    0.5: "TWT.Speed.Half",
    1: "TWT.Speed.Standard",
    2: "TWT.Speed.Fast"
  },

  threats: {
    0.5: "TWT.Threat.Mook",
    1: "TWT.Threat.Equal",
    2: "TWT.Threat.Elite",
    4: "TWT.Threat.Boss"
  },

  terrains: {
    normal: "TWT.Terrain.Normal",
    woods: "TWT.Terrain.Woods",
    water: "TWT.Terrain.Water",
    barricade: "TWT.Terrain.Barricade",
    hazardous: "TWT.Terrain.Hazardous"
  }
};

/* -------------------------------------------- */
/*  The action list                             */
/* -------------------------------------------- */

/**
 * The major actions, in the order the Quickstart prints them.
 *
 * `trait` and `skill` are the pair the action tests; a null pair means the action needs
 * no test at all. `boons` names what a surplus buys, for the card to offer.
 */
TWT.majorActions = {
  assist: {
    label: "TWT.Action.Assist.Label",
    hint: "TWT.Action.Assist.Hint",
    trait: null,
    skill: null
  },
  attack: {
    label: "TWT.Action.Attack.Label",
    hint: "TWT.Action.Attack.Hint",
    // The weapon decides the trait: Body in melee and thrown, Mind at range.
    trait: "body",
    skill: "violence",
    kind: "attack"
  },
  brace: {
    label: "TWT.Action.Brace.Label",
    hint: "TWT.Action.Brace.Hint",
    trait: "body",
    skill: "industry",
    boons: "TWT.Action.Brace.Boons"
  },
  dash: {
    label: "TWT.Action.Dash.Label",
    hint: "TWT.Action.Dash.Hint",
    trait: "body",
    skill: "navigation",
    boons: "TWT.Action.Dash.Boons"
  },
  direct: {
    label: "TWT.Action.Direct.Label",
    hint: "TWT.Action.Direct.Hint",
    trait: "will",
    skill: "culture",
    boons: "TWT.Action.Direct.Boons"
  },
  grapple: {
    label: "TWT.Action.Grapple.Label",
    hint: "TWT.Action.Grapple.Hint",
    trait: "body",
    skill: "violence"
  },
  hide: {
    label: "TWT.Action.Hide.Label",
    hint: "TWT.Action.Hide.Hint",
    trait: "body",
    skill: "skulduggery",
    // Offered in the dialog, never assumed: the system cannot read the fiction.
    modifiers: [
      { id: "hideEnemyPresent", label: "TWT.Action.Hide.EnemyPresent", value: 1 },
      { id: "hideCarryingWard", label: "TWT.Action.Hide.CarryingWard", value: 1 },
      { id: "hideCover", label: "TWT.Action.Hide.Cover", value: -1 },
      { id: "hideShadow", label: "TWT.Action.Hide.Shadow", value: -1 }
    ]
  },
  repel: {
    label: "TWT.Action.Repel.Label",
    hint: "TWT.Action.Repel.Hint",
    trait: "will",
    skill: "survival"
  },
  search: {
    label: "TWT.Action.Search.Label",
    hint: "TWT.Action.Search.Hint",
    trait: "mind",
    skill: "skulduggery"
  },
  shove: {
    label: "TWT.Action.Shove.Label",
    hint: "TWT.Action.Shove.Hint",
    trait: "body",
    skill: "navigation",
    boons: "TWT.Action.Shove.Boons"
  }
};

/**
 * The minor actions.
 *
 * The last two are not in the printed action list — they are written into the Grappled
 * and Prone conditions — but a player looking for "how do I stand up" looks here.
 */
TWT.minorActions = {
  move: { label: "TWT.Action.Move.Label", hint: "TWT.Action.Move.Hint", trait: null, skill: null },
  equip: { label: "TWT.Action.Equip.Label", hint: "TWT.Action.Equip.Hint", trait: null, skill: null },
  pass: {
    label: "TWT.Action.Pass.Label",
    hint: "TWT.Action.Pass.Hint",
    trait: "body",
    skill: "culture",
    difficulty: 1
  },
  shine: { label: "TWT.Action.Shine.Label", hint: "TWT.Action.Shine.Hint", trait: null, skill: null },
  breakGrapple: {
    label: "TWT.Action.BreakGrapple.Label",
    hint: "TWT.Action.BreakGrapple.Hint",
    trait: "body",
    skill: "violence"
  },
  standUp: { label: "TWT.Action.StandUp.Label", hint: "TWT.Action.StandUp.Hint", trait: null, skill: null }
};

/**
 * What a surplus buys on an attack. Costs and requirements are the rules', not a
 * convenience: Cleave without a heavy weapon is simply not a legal purchase.
 */
TWT.attackBoons = {
  flurry: {
    label: "TWT.Boon.Flurry",
    hint: "TWT.Boon.FlurryHint",
    cost: 1,
    requires: "secondWeapon",
    oncePerTurn: true
  },
  cleave: {
    label: "TWT.Boon.Cleave",
    hint: "TWT.Boon.CleaveHint",
    cost: 2,
    requires: "heavyWeapon"
  },
  deadly: {
    label: "TWT.Boon.Deadly",
    hint: "TWT.Boon.DeadlyHint",
    cost: 2,
    bonusDamage: 1
  }
};

/**
 * Attacking with no weapon, or with whatever was to hand.
 *
 * A heavy improvised object has to be double-wielded, which is why it is a separate row
 * rather than a flag on the plain one.
 */
TWT.improvisedAttacks = {
  unarmed: {
    label: "TWT.Attack.Unarmed",
    damage: 1,
    damageType: "body",
    modifier: 1,
    boon: "TWT.Attack.UnarmedBoon"
  },
  improvised: {
    label: "TWT.Attack.Improvised",
    damage: 1,
    damageType: "body",
    modifier: 0,
    boon: "TWT.Attack.ImprovisedBoon"
  },
  improvisedHeavy: {
    label: "TWT.Attack.ImprovisedHeavy",
    damage: 2,
    damageType: "body",
    modifier: 0,
    doubleWielded: true,
    boon: "TWT.Attack.ImprovisedBoon"
  }
};

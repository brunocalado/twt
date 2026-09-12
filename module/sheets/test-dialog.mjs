import { SKILL_KEYS, SYSTEM_ID, TEMPLATE_ROOT, TRAIT_KEYS, TWT } from "../helpers/config.mjs";
import { assistDiceFor } from "../helpers/roll.mjs";
import { collectTestModifiers } from "../helpers/effects.mjs";
import { collectZoneModifiers } from "../helpers/zones.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Gathers the parameters of a test and nothing else: it does not roll, post to chat or
 * touch an actor. That is what lets a sheet click, a macro and an NPC action all reuse it.
 *
 * Trait and skill are free to change after the dialog opens, because the book's tests
 * routinely offer a choice — "3M WILL + CULTURE/SURVIVAL" — and hard-coding one pair
 * would make half of them unrollable.
 */
export class TWTTestDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  /**
   * @param {object} options
   * @param {Actor} options.actor
   * @param {string} [options.trait]
   * @param {string} [options.skill]
   * @param {number} [options.difficulty]
   * @param {string} [options.label]
   * @param {string} [options.kind]
   */
  constructor({ actor, trait, skill, difficulty = 2, label = "", kind = "other",
    extraModifiers = [], modifier = 0, ...options } = {}) {
    super(options);
    this.actor = actor;
    this.label = label;
    this.kind = kind;

    // Modifiers an action contributes on top of the actor's conditions — Hide's cover
    // and shadow, an unarmed attack's penalty. Offered unticked: they depend on fiction.
    this.extraModifiers = extraModifiers;

    /** Current selections, mutated by the form and read on submit. Not `state` — `ApplicationV2` already defines that getter. */
    this.params = {
      trait: trait ?? "body",
      skill: skill ?? "violence",
      difficulty,
      modifier,
      assistActorId: "",
      // Condition modifiers start ticked only when the condition applies unambiguously.
      modifierIds: collectTestModifiers(actor, { trait, kind })
        .filter((m) => m.suggested)
        .map((m) => m.id)
    };

    /** Resolved with the chosen parameters, or null when dismissed. */
    this.promise = new Promise((resolve) => {
      this.#resolve = resolve;
    });
  }

  /** @type {(value: object|null) => void} */
  #resolve;

  /** Whether {@link #resolve} has already been called. */
  #settled = false;

  /* -------------------------------------------- */

  /** @override */
  static DEFAULT_OPTIONS = {
    id: "twt-test-dialog",
    classes: [SYSTEM_ID, "twt-dialog", "test-dialog"],
    tag: "form",
    position: { width: 420, height: "auto" },
    window: { title: "TWT.Test.DialogTitle", icon: "fa-solid fa-dice-d6" },
    form: { handler: TWTTestDialog.#onSubmit, closeOnSubmit: true },
    actions: {
      step: TWTTestDialog.#onStep
    }
  };

  /** @override */
  static PARTS = {
    form: { template: `${TEMPLATE_ROOT}/dialogs/test-dialog.hbs` }
  };

  /* -------------------------------------------- */

  /**
   * Open the dialog and wait for it.
   *
   * @param {object} options  See the constructor.
   * @returns {Promise<object|null>}  The chosen parameters, or null if dismissed.
   */
  static async prompt(options) {
    const app = new this(options);
    app.render({ force: true });
    return app.promise;
  }

  /* -------------------------------------------- */

  /** @override */
  async _prepareContext() {
    const scores = this.#scores();
    const assistCandidates = this.#assistCandidates();
    const assistActor = assistCandidates.find((c) => c.id === this.params.assistActorId);
    const assistDice = assistActor ? assistActor.dice : 0;

    const available = [
      ...collectTestModifiers(this.actor, { trait: this.params.trait, kind: this.kind }),
      // Where the actor is standing matters too: a Crowded zone, cover in the woods.
      ...collectZoneModifiers(this.actor, { trait: this.params.trait, kind: this.kind }),
      ...this.extraModifiers.map((m) => ({ suggested: false, ...m }))
    ];
    const modifierTotal = available
      .filter((m) => this.params.modifierIds.includes(m.id))
      .reduce((n, m) => n + m.value, 0);

    const requested = this.params.difficulty + this.params.modifier + modifierTotal;

    return {
      actor: this.actor,
      label: this.label,
      traits: TRAIT_KEYS.map((key) => ({
        key,
        label: TWT.traits[key].label,
        score: scores.traits[key],
        selected: key === this.params.trait
      })),
      skills: SKILL_KEYS.map((key) => ({
        key,
        label: TWT.skills[key].label,
        score: scores.skills[key],
        selected: key === this.params.skill
      })),
      conditionModifiers: available.map((m) => ({
        ...m,
        active: this.params.modifierIds.includes(m.id)
      })),
      params: this.params,
      assistCandidates,
      assistDice,
      assistName: assistActor?.name ?? "",
      traitScore: scores.traits[this.params.trait],
      skillScore: scores.skills[this.params.skill],
      pool: Math.max(0, scores.traits[this.params.trait] + scores.skills[this.params.skill] + assistDice),
      requested,
      // A test eased below 1M stays at 1M and pays the difference in extra boons.
      difficulty: Math.max(1, requested),
      floored: requested < 1,
      bonusBoons: Math.max(0, 1 - requested)
    };
  }

  /* -------------------------------------------- */

  /**
   * Trait and skill scores, flattened across both actor types — a Delver keeps a trait
   * score under `traits.<k>.score`, an NPC keeps the number directly.
   * @returns {{traits: Record<string, number>, skills: Record<string, number>}}
   */
  #scores() {
    const system = this.actor.system;
    const traits = {};
    for (const key of TRAIT_KEYS) {
      traits[key] = this.actor.type === "delver" ? system.traits[key].score : system.traits[key];
    }
    return { traits, skills: { ...system.skills } };
  }

  /**
   * Allies who could assist, with the dice each would bring. One ally per test, which
   * is why this is a single-select rather than a list of checkboxes.
   * @returns {{id: string, name: string, dice: number}[]}
   */
  #assistCandidates() {
    return game.actors
      .filter((a) => a.type === "delver" && a.id !== this.actor.id)
      .map((a) => ({ id: a.id, name: a.name, dice: assistDiceFor(a, this.params.skill) }))
      .filter((c) => c.dice > 0)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /* -------------------------------------------- */

  /** @override */
  _onRender(context, options) {
    super._onRender(context, options);

    // Everything that is not a click: the selects, the steppers' typed values and the
    // condition checkboxes all re-render so the live pool readout stays honest.
    this.element.addEventListener("change", (event) => {
      const field = event.target;
      const name = field.name;
      if (!name) return;

      if (name === "modifierIds") {
        const id = field.value;
        this.params.modifierIds = field.checked
          ? [...new Set([...this.params.modifierIds, id])]
          : this.params.modifierIds.filter((m) => m !== id);
      } else if (name in this.params) {
        this.params[name] = field.type === "number" ? Number(field.value) : field.value;
      }

      // A different skill changes what each ally would contribute, so a stale pick is
      // dropped rather than silently contributing the wrong number of dice.
      if (name === "skill" && this.params.assistActorId) {
        const still = this.#assistCandidates().some((c) => c.id === this.params.assistActorId);
        if (!still) this.params.assistActorId = "";
      }

      this.render();
    });
  }

  /* -------------------------------------------- */

  /** @this {TWTTestDialog} */
  static #onStep(event, target) {
    const { field, by } = target.dataset;
    this.params[field] = Number(this.params[field]) + Number(by);
    if (field === "difficulty") this.params.difficulty = Math.max(1, this.params.difficulty);
    this.render();
  }

  /** @this {TWTTestDialog} */
  static async #onSubmit() {
    const context = await this._prepareContext();
    this.#settle({
      trait: this.params.trait,
      skill: this.params.skill,
      traitScore: context.traitScore,
      skillScore: context.skillScore,
      difficulty: this.params.difficulty,
      modifier: this.params.modifier + context.conditionModifiers
        .filter((m) => m.active)
        .reduce((n, m) => n + m.value, 0),
      assistDice: context.assistDice,
      assistName: context.assistName,
      assistActorId: this.params.assistActorId,
      label: this.label,
      kind: this.kind,
      appliedModifiers: context.conditionModifiers.filter((m) => m.active).map((m) => m.id)
    });
  }

  /** @override */
  _onClose(options) {
    super._onClose(options);
    // Dismissing the window is a cancellation, not an empty test.
    this.#settle(null);
  }

  /**
   * Resolve exactly once, so closing after a submit cannot overwrite the result with null.
   * @param {object|null} value
   */
  #settle(value) {
    if (this.#settled) return;
    this.#settled = true;
    this.#resolve(value);
  }
}

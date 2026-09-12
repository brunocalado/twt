import { SYSTEM_ID, TEMPLATE_ROOT, TRAIT_KEYS, TWT } from "../helpers/config.mjs";
import { applyDamageToMany, previewDamage } from "../helpers/damage.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Deal damage to one or more actors, previewing the arithmetic before anything is
 * written — armor, Vulnerable and overkill all spelled out, so nobody has to
 * reconstruct where a number went.
 *
 * Reached from the token context menu, a chat card's apply button, or a macro.
 */
export class TWTDamageDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  /**
   * @param {object} options
   * @param {Actor[]} options.targets
   * @param {number} [options.amount]
   * @param {string} [options.type]
   * @param {boolean} [options.piercing]
   * @param {string} [options.source]
   */
  constructor({ targets = [], amount = 1, type = "body", piercing = false, source = "", ...options } = {}) {
    super(options);
    this.targets = targets;
    this.params = { amount, type, piercing, source };
  }

  /** @override */
  static DEFAULT_OPTIONS = {
    id: "twt-damage-dialog",
    classes: [SYSTEM_ID, "twt-dialog", "damage-dialog"],
    tag: "form",
    position: { width: 460, height: "auto" },
    window: { title: "TWT.Damage.DialogTitle", icon: "fa-solid fa-droplet" },
    form: { handler: TWTDamageDialog.#onSubmit, closeOnSubmit: true },
    actions: {
      step: TWTDamageDialog.#onStep
    }
  };

  /** @override */
  static PARTS = {
    form: { template: `${TEMPLATE_ROOT}/dialogs/damage-dialog.hbs` }
  };

  /* -------------------------------------------- */

  /**
   * Open the dialog for the currently selected tokens, or for an explicit list.
   *
   * @param {object} [options]
   * @returns {TWTDamageDialog|null}
   */
  static open(options = {}) {
    const targets =
      options.targets ??
      canvas.tokens?.controlled.map((t) => t.actor).filter(Boolean) ??
      [];
    if (!targets.length) {
      ui.notifications.warn("TWT.Damage.NoTargets", { localize: true });
      return null;
    }
    const app = new this({ ...options, targets });
    app.render({ force: true });
    return app;
  }

  /* -------------------------------------------- */

  /** @override */
  async _prepareContext() {
    return {
      params: this.params,
      types: TRAIT_KEYS.map((key) => ({
        key,
        label: TWT.traits[key].label,
        selected: key === this.params.type
      })),
      // One preview row per target, because armor and conditions differ per actor.
      rows: this.targets.map((actor) => ({
        actor,
        isDelver: actor.type === "delver",
        preview: previewDamage(actor, this.params),
        poolLabel: game.i18n.localize(
          actor.type === "delver" ? TWT.traits[this.params.type].label : "TWT.Card.Health"
        )
      }))
    };
  }

  /* -------------------------------------------- */

  /** @override */
  _onRender(context, options) {
    super._onRender(context, options);
    this.element.addEventListener("change", (event) => {
      const field = event.target;
      if (!field.name || !(field.name in this.params)) return;
      this.params[field.name] =
        field.type === "checkbox"
          ? field.checked
          : field.type === "number"
            ? Number(field.value)
            : field.value;
      this.render();
    });
  }

  /** @this {TWTDamageDialog} */
  static #onStep(event, target) {
    const { by } = target.dataset;
    this.params.amount = Math.max(0, this.params.amount + Number(by));
    this.render();
  }

  /** @this {TWTDamageDialog} */
  static async #onSubmit() {
    await applyDamageToMany(this.targets, { ...this.params });
  }
}

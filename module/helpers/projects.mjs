import { SETTINGS, SYSTEM_ID } from "./config.mjs";
import { asGM, defineDelegate } from "./delegate.mjs";
import { postCard } from "./chat.mjs";

/**
 * Projects: the extended-test mechanic.
 *
 * Worth having here because obstacles and camp activities both use it. A project has a
 * length in successes, several characters may contribute, and — the part that matters —
 * **each boon spent adds one more success**, which is what makes a good roll on a project
 * feel different from a good roll on anything else.
 *
 * The list is a world setting rather than a document collection: a project is a few
 * numbers and a name, and giving it a Document would mean a compendium type nobody asked
 * for.
 */

/** The world setting key holding every project. */
export const PROJECTS_KEY = "projects";

/** Register the store. Called from the settings module. */
export function registerProjectSetting() {
  game.settings.register(SYSTEM_ID, PROJECTS_KEY, {
    scope: "world",
    config: false,
    type: Array,
    default: []
  });
}

/** Register the privileged writes — the list is world-scoped. */
export function registerProjectDelegates() {
  defineDelegate("writeProjects", async (payload, { user }) => {
    if (!user.isGM) return { ok: false, reason: "not-gm" };
    await game.settings.set(SYSTEM_ID, PROJECTS_KEY, payload.projects ?? []);
    return { ok: true };
  });
}

/**
 * @returns {object[]}
 */
export function projects() {
  return game.settings.get(SYSTEM_ID, PROJECTS_KEY) ?? [];
}

/**
 * Write the whole list, through the Keeper when needed.
 *
 * @param {object[]} next
 * @returns {Promise<object>}
 */
async function writeProjects(next) {
  if (game.user.isGM) {
    await game.settings.set(SYSTEM_ID, PROJECTS_KEY, next);
    return { ok: true };
  }
  return asGM("writeProjects", { projects: next });
}

/**
 * Start a project.
 *
 * @param {object} spec
 * @param {string} spec.name
 * @param {number} spec.length     Successes needed, the printed PL.
 * @param {string} [spec.trait]
 * @param {string} [spec.skill]
 * @param {string} [spec.description]
 * @returns {Promise<object>}  The created project.
 */
export async function startProject({ name, length, trait = "mind", skill = "industry", description = "" }) {
  const project = {
    id: foundry.utils.randomID(),
    name,
    length: Math.max(1, Math.floor(length)),
    successes: 0,
    trait,
    skill,
    description,
    contributions: []
  };
  await writeProjects([...projects(), project]);
  return project;
}

/**
 * Record a contribution.
 *
 * A success is worth one, and **every boon spent is worth one more** — the rule that
 * makes boons the difference between grinding a project out and finishing it.
 *
 * @param {string} projectId
 * @param {Actor} actor
 * @param {object} result   A test result.
 * @param {number} [boonsSpent]  Defaults to every boon the roll produced.
 * @returns {Promise<object|null>}  The updated project.
 */
export async function contributeToProject(projectId, actor, result, boonsSpent) {
  const all = projects().map((p) => ({ ...p, contributions: [...p.contributions] }));
  const project = all.find((p) => p.id === projectId);
  if (!project) return null;

  const boons = Math.max(0, Math.min(boonsSpent ?? result.boons, result.boons));
  const gained = result.success ? 1 + boons : 0;

  project.successes = Math.min(project.length, project.successes + gained);
  project.contributions.push({
    actorId: actor.id,
    actorName: actor.name,
    successes: gained,
    boons,
    at: Date.now()
  });

  await writeProjects(all);
  await postProjectCard(actor, project, gained, boons);
  return project;
}

/**
 * @param {string} projectId
 * @returns {Promise<object>}
 */
export async function deleteProject(projectId) {
  return writeProjects(projects().filter((p) => p.id !== projectId));
}

/* -------------------------------------------- */

/**
 * @param {Actor} actor
 * @param {object} project
 * @param {number} gained
 * @param {number} boons
 * @returns {Promise<ChatMessage>}
 */
async function postProjectCard(actor, project, gained, boons) {
  const complete = project.successes >= project.length;
  return postCard(
    {
      kind: "rest",
      img: actor.img,
      title: project.name,
      subtitle: game.i18n.localize("TWT.Project.Contribution"),
      badge: `${project.successes}/${project.length}`,
      outcome: complete
        ? game.i18n.localize("TWT.Project.Complete")
        : game.i18n.format("TWT.Project.Gained", { gained }),
      success: complete,
      sections: boons
        ? [{ content: game.i18n.format("TWT.Project.BoonsAdded", { boons }) }]
        : []
    },
    { actor }
  );
}

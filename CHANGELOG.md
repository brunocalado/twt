# Changelog

All notable changes to this system are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[semantic versioning](https://semver.org/).

## [0.0.2] — 2026-09-12

- Move the Install section above Screenshots
- Add interface screenshots to the README

## [0.0.1] — 2026-09-12

The first complete pass: every subsystem from the Quickstart, built and verified in a live client.

### Added

- **Data models** for both Actor types and all three record types, with health, record slots,
  armor, ward and speed derived rather than stored.
- **Settings and GM delegation.** One `CONFIG.queries` path every privileged write goes through,
  and a migration gate that runs once, on the Keeper's client.
- **The dice engine.** D6 pools counting 5s and 6s as Marks, the 1M difficulty floor with its
  bonus boons, one-ally assists, and a Strain reroll that updates its chat card in place.
- **The damage pipeline.** Armor and piercing, Vulnerable before armor, overkill captured before
  the clamp, Critical death, recovery tests, and Safe Rest.
- **Fifteen conditions** as status effects, with condition-aware speed and test modifiers.
- **The Delver folio:** a stat ledger, a slot-exact record grid, a combat bar and a journal.
- **Record sheets** for equipment, features and adaptations, with the record lifecycle and charges.
- **The NPC statblock**, reproducing the printed profile with one-click action rolls.
- **Combat:** 1d6 initiative, the turn lifecycle, the action economy, the full action list, and the
  three attack boons.
- **Ward, zones and travel:** zones as Region Behaviors with explicit adjacency, ward allocation,
  the segment clock, escalating fatigue, and projects.
- **Seven compendium packs** holding the Quickstart's printed content.

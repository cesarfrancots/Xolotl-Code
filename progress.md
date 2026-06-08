Original prompt: Add an interactive pixel axolotl civilization game/eval lab to the app, with saved sessions, player interventions, buffs/debuffs, AI-controlled civilization turns, and generated game assets.

Progress:
- Started implementation in Default mode.
- Chosen v1 scope: single model civilization, observer/god-player controls, Tauri backend module, Phaser canvas, saved sessions.
- Added `tauri-app/src-tauri/src/civilization.rs` with deterministic sessions, interventions, AI turn parsing, scoring, and Tauri events.
- `cargo test civilization --lib` compiled but the Tauri test binary failed to start with Windows `STATUS_ENTRYPOINT_NOT_FOUND`; use `cargo check` for backend verification unless the harness issue is fixed.
- Added fallback project-local pixel PNGs under `tauri-app/public/civ/` after built-in image generation returned a rate limit.
- Replaced the placeholder worker with a 12-variant `axolotl-seeds.png` sheet and updated Phaser to assign stable seed frames per axolotl.
- Frontend tests, frontend build, Rust `cargo check --lib`, and `graphify update .` passed.

TODO:
- Retry `$imagegen` for higher-quality project-bound assets when the service is available.
- Browser screenshot verification was not completed because the Browser tool was not exposed and Playwright is not installed in this app.

2026-06-05 possession/MVP slice:
- Added frontend parity for backend biome/resource expansion: kelp, ore, ice, coral, sulfur, amber, herbs plus coral reef, glacier, volcanic, bog, salt flats, and abyss display fallbacks.
- Added a compact MVP status surface around the current target of surviving 20 turns with a living, non-fragile colony.
- Added player possession mode in the Civ tab: select/possess/release an axolotl, camera follows it, WASD/arrows move through the water column with seabed clamping, and E/Space interacts with nearby resources, buildings, or NPC axolotls.
- `window.render_game_to_text()` now reports player possession, current player coordinates, and last interaction for automation.
- Player resource interactions currently grant +1 to the active civ through existing interventions; they do not yet deplete the world tile or persist the player's tile position into the backend save.
- Verification passed: `npm test -- civStore.test.ts App.test.tsx`, `npm run build`, `cargo check`, official web-game client state capture, and a full-page Playwright screenshot at `output/web-game/civ-possession/full-page-verified.png`.
- Caveat: the official web-game client's canvas-only PNGs are black in headless WebGL readback, but full-page Playwright screenshots show the Civ canvas rendering correctly with possession and NPC interaction feedback.

Next TODO:
- Persist player-controlled position/actions in the backend if possession should survive turns/session reloads.
- Replace the current resource-interaction grant with true tile harvesting/depletion.
- Add explicit NPC dialogue/task interactions beyond the current nearby-axolotl greeting event.
- Consider a lightweight collision/jump/climb model if the game should become more Terraria-like rather than free-swimming underwater movement.

2026-06-05 Codex player loop:
- Added `tauri-app/scripts/codex-play-civ.mjs` and `npm run civ:codex-play` for a visible/headless Codex browser player. Goals: `tour`, `gather`, `greet`, `explore`, `return`.
- The driver opens the Civ tab, possesses an axolotl, reads `window.render_game_to_text()`, chooses targets, sends keyboard input, and can save screenshots plus JSON state per step.
- Improved player text state with `nearby_interactions` so Codex can see reachable resources, buildings, and NPCs without image parsing.
- Replaced player resource collection with real `harvest_resource`: the backend and browser preview now grant the yielded resource and deplete the world tile. Moss yields food.
- Increased player swim speed slightly and improved the driver with diagonal movement plus short-term interaction memory so `tour` does not spam the same greeting.
- Playtest evidence: `output/web-game/codex-player-tour/codex-play-17.png` shows the watched play loop after greeting NPCs and harvesting wood; `codex-play-17.json` shows wood at 23 and tile interaction state.
- Verification passed: `npm test -- civStore.test.ts App.test.tsx`, `npm run build`, `cargo check`, official web-game client smoke (`output/web-game/civ-driver-smoke`), headless driver `gather` and `tour`, and visible headed driver `tour`.
- Rust unit test `player_harvest_depletes_tile_and_grants_yield` compiles but cannot execute because the repo still hits the known Windows Tauri test-binary `STATUS_ENTRYPOINT_NOT_FOUND` issue.

Next TODO:
- Add richer NPC interaction outcomes (dialogue/tasks/trading) so Codex has reasons to talk beyond greetings.
- Persist player position/action intent through backend turns and reloads.
- Add an in-app "Codex pilot" toggle if we want the app itself to host the automation, instead of launching the external Playwright driver.

2026-06-05 possession playability pass:
- Persisted possessed-axolotl movement into the simulation via `move_entity`, with browser-preview parity, so player-controlled tile position survives backend/frontend state refreshes.
- Upgraded player interactions: resources use true tile harvest/depletion, NPC talk nudges target mood + colony morale, and building use applies role-specific colony benefits (`pond` improves clean water/health, nests morale, farms food, workshops tools, storage fiber).
- Found and fixed a Codex pilot gap where the `return` goal could reach Pond Heart but never interact because it treated the pond as a permanent far waypoint.
- Found and fixed a playability exploit where repeated Space presses could farm unlimited NPC morale or building resources in one turn; `talk_entity` and `use_building` now produce their bonus once per target per turn in both Rust and browser preview.
- Playtest evidence:
  - `output/web-game/codex-player-return-cooldown/codex-play-33.json` shows Pond Heart interaction with clean water 40 -> 41 and health 82 -> 82.6, not the previous runaway 57/92.
  - `output/web-game/codex-player-talk-cooldown/focused-final.png` plus state inspection shows five Space presses near Axolotl 2 only moved morale 78 -> 79 and set the NPC activity to `socialize`.
  - `output/web-game/civ-action-smoke-latest/` captures the official web-game smoke after the latest changes.
- Verification passed: `npm test -- civStore.test.ts App.test.tsx`, `npm run build`, and `cargo check`.
- Targeted Rust unit `player_move_talk_and_building_use_have_sim_effects` compiles, then still cannot execute because the repo hits the known Windows Tauri test-binary `STATUS_ENTRYPOINT_NOT_FOUND` issue.

Next TODO:
- Add actual NPC dialogue/task/trade content instead of one-shot morale bumps.
- Add an in-app "Codex pilot" toggle if we want users to watch Codex play without launching the external Playwright driver.
- Start terrain/platform playability work if the target is truly Terraria-like movement rather than the current underwater free-swim model.

2026-06-05 NPC request loop pass:
- Added a single active NPC request loop derived from player log markers, avoiding a new save-schema field while still surviving snapshot refreshes/reloads.
- Talking to an NPC now opens a fetch request (for example Axolotl 2 asks for food from moss), `render_game_to_text()` exposes `player_task`, harvesting progresses it above the recorded baseline, and returning to the requester completes it for morale/mood reward.
- Added HUD/drawer task status and cleaned player log display so machine-readable task markers do not leak into the visible log text.
- Fixed a delivery targeting gap: when a task is ready, the canvas prioritizes the requester over a closer neighboring NPC.
- Taught `npm run civ:codex-play -- --goal task` to request, gather, deliver, and then patrol after task completion instead of spamming the same NPC.
- Playtest evidence:
  - `output/web-game/codex-player-task-create/codex-play-00.json` shows `player_task` open with `resource=food`, `sourceResource=moss`, `baseline=45`, and `remaining=2`.
  - `output/web-game/codex-player-task-loop-priority/codex-play-14.json` shows task progress ready with food at 47 and remaining 0.
  - `output/web-game/codex-player-task-loop-hud/codex-play-24.png` shows the full-page game view with the HUD message `Delivered food to Axolotl 2`.
  - `output/web-game/codex-player-task-loop-patrol/` shows the pilot completing the request and then patrolling.
  - `output/web-game/civ-task-smoke/` captures the official web-game client smoke; canvas-only PNGs remain black from headless WebGL readback, but JSON state is valid.
- Verification passed: `npm test -- civStore.test.ts App.test.tsx`, `npm run build`, and `cargo check`.
- Targeted Rust unit `player_move_talk_and_building_use_have_sim_effects` compiles in the test profile, then still cannot execute due the known Windows Tauri `STATUS_ENTRYPOINT_NOT_FOUND` harness issue.

Next TODO:
- Add several NPC request types (trade, escort, building repair, rescue) so the loop has variety beyond fetch quests.
- Consider an in-app Codex pilot toggle once the external Playwright pilot is stable enough.
- Start terrain/platform feel work if the goal remains Terraria-like rather than free-swim exploration.

2026-06-05 varied NPC task pass:
- Added multiple NPC request types with backend/browser-preview parity: fetch resource, trade resource for a reward, and visit a specific building.
- NPC requests now vary by morph/role: wild/leucistic/albino/piebald ask for moss-to-food fetches, gold/copper/firefly ask for wood-to-tools trades, blue/gfp ask for fiber-to-clean-water trades, and melanoid/axanthic/mystic/elder axolotls ask the player to check Pond Heart or Reed Nest.
- Shared task parsing in `tauri-app/src/lib/civPlayerTasks.ts` keeps HUD copy, text state, and the Codex pilot aligned across task kinds.
- Updated the player HUD/drawer/log messages so completed trades and building visits read like explicit outcomes instead of generic use events.
- Improved interaction targeting for active tasks: requested buildings are prioritized during visit tasks and the requester NPC is prioritized once a task is ready to turn in.
- Extended the Codex pilot goals with `task-fetch`, `task-trade`, and `task-visit`; fixed a targeting gap where the pilot could talk to the wrong nearby NPC before reaching the intended requester.
- After task completion, the pilot now patrols near the pond instead of drifting indefinitely away from the playable village space.
- Playtest evidence:
  - `output/web-game/codex-player-task-trade/codex-play-26.png` shows `Traded wood with Axolotl 3 for tools`; matching JSON shows tools increased and the task cleared.
  - `output/web-game/codex-player-task-visit-hud/codex-play-17.png` shows `Checked Pond Heart for Axolotl 4`; matching JSON shows clean water, health, morale, and requester activity updates.
  - `output/web-game/civ-varied-task-smoke/state-1.json` confirms the official web-game client can read Civ state after the varied-task changes.
- Verification passed: `npm test -- civStore.test.ts App.test.tsx`, `npm run build`, and `cargo check`.
- Caveat: official web-game client canvas-only PNGs remain black in headless WebGL capture, but the full-page pilot screenshots render correctly and the official JSON state is valid.
- Targeted Rust unit `player_move_talk_and_building_use_have_sim_effects` compiles in the test profile, then still cannot execute because the repo hits the known Windows Tauri `STATUS_ENTRYPOINT_NOT_FOUND` harness issue.

Next TODO:
- Add world-object request types beyond log markers: escort, rescue, repair, and delivery targets that create visible map goals.
- Add an in-app Codex pilot toggle/overlay so users can watch Codex play without launching `tauri-app/scripts/codex-play-civ.mjs` separately.
- Start the Terraria-like feel pass: terrain collision, ground/swim mode boundaries, mining/placing tiles, and object interaction previews.

2026-06-05 in-app Codex pilot pass:
- Added an in-app Codex pilot toggle and goal selector to the Civ hotbar, plus a Player drawer control/status card.
- Added `tauri-app/src/lib/civPilot.ts` so the app can use the same text-state driven decision policy as the external Playwright pilot: request tasks, gather resources, return to NPCs, check buildings, tour, gather, greet, return home, and explore.
- Added a structured `pilotCommand` bridge into `CivilizationGameCanvas`; Phaser now accepts programmatic move/explore/interact commands while preserving normal WASD/arrows/E/Space control.
- HUD now exposes `Codex pilot: ...` status so the user can watch what the pilot is trying to do, and the status explicitly marks `task done` before returning home/patrolling.
- Fixed a playability/readability gap found during in-app testing: after completing a task the pilot now settles closer to Pond Heart and shows `task done: return home` / `task done: patrol pond` instead of a generic return status.
- Browser playtest evidence:
  - `output/web-game/civ-inapp-pilot-ui/pilot-17.png` shows the visible in-app Pilot button/status after completing a fetch loop; `samples.json` shows request -> moss harvest -> ready -> task cleared.
  - `output/web-game/civ-inapp-pilot-trade/task-trade-31.png` shows the in-app Trade pilot running; matching state shows `tools` increased 2 -> 3 and task cleared.
  - `output/web-game/civ-inapp-pilot-visit/task-visit-25.png` shows the in-app Visit pilot running; matching state shows clean water 40 -> 41, health 82 -> 82.8, morale 78 -> 81, and task cleared.
- Verification passed: `npm test -- civStore.test.ts App.test.tsx`, `npm run build`, and `cargo check`.
- Caveat: the official `develop-web-game` client failed from this shell because its skill directory could not resolve a `playwright` package. The targeted browser runs used the bundled Codex Node runtime with Playwright modules and had no console/page errors.

Next TODO:
- Add world-object quests that create actual visible targets and hazards, not just log-derived tasks.
- Start the Terraria-like feel pass with terrain collision/mining/placing and a better ground/water movement split.
- Consider code-splitting the Civ view if the growing game chunk starts hurting app startup.

2026-06-05 terrain edit playability pass:
- Added player terrain editing toward the Terraria-like loop: `mine_tile` breaks nearby substrate into water/deepwater and grants a mapped material; `place_tile` spends a placeable material and creates substrate in nearby water.
- Backend and browser-preview parity added for terrain mining/placing. Placeable materials are stone, clay, wood, fiber, coral, and ice; terrain yields map moss/peat -> fiber, mud/earth/sand/salt -> clay, crystal -> glowshards, etc.
- Added Use/Mine/Build hotbar modes. Use keeps resource/NPC/building interactions; Mine targets nearby substrate; Build targets a nearby water tile using the selected material.
- Fixed a rendering gap: the Phaser terrain bake now includes a terrain signature, so mined/placed tiles force the substrate layer to redraw instead of staying visually stale.
- Fixed an input focus gap found during playtest: after clicking Mine/Build, Space could be swallowed by the last hotbar button. Tool buttons now prevent mouse-focus capture; both E and Space trigger in-game interactions after selecting a tool.
- Added a backend unit `player_mine_and_place_tile_edits_world` that compiles and asserts the world/resource mutation path.
- Browser playtest evidence:
  - `output/web-game/civ-terrain-edit-focus/after-mine.png` shows Mine mode with `Mined moss for fiber`; JSON shows `lastInteraction.kind=terrain`, `action=mine_tile`, and fiber 12 -> 13.
  - `output/web-game/civ-terrain-edit-focus/after-build.png` shows Build mode with `Placed stone using stone`; JSON shows `action=place_tile` and stone 11 -> 10.
  - A follow-up Space-key test confirmed Mine works immediately after clicking the hotbar Mine button without requiring a canvas refocus.
- Verification passed: `npm test -- civStore.test.ts App.test.tsx`, `npm run build`, and `cargo check`.
- Caveats:
  - Official `develop-web-game` client still cannot run from this shell because Node ESM cannot resolve `playwright` from the skill script, even with the bundled `NODE_PATH`.
  - Targeted Rust unit `player_mine_and_place_tile_edits_world` compiles, then still cannot execute due the existing Windows Tauri `STATUS_ENTRYPOINT_NOT_FOUND` harness issue.

Next TODO:
- Add actual terrain collision/platform feel instead of the current free-swim seabed clamp.
- Add visible world-object quests that use terrain edits, such as repair a breached nest, rescue an axolotl behind blocks, or bridge to a resource pocket.
- Add a lightweight tile target reticle/preview so Mine and Build show the exact tile before E/Space.

2026-06-05 terrain targeting reticle pass:
- Added a visible active-target reticle to the Phaser canvas for possessed-player interactions. Terrain targets now show a bracketed tile, tether line, and high-contrast marker so Mine/Build targets are no longer guesswork.
- Added `player.active_target` to `window.render_game_to_text()` so browser automation can verify the exact tile/object that E/Space will affect before interacting.
- Reticle is driven by the same `findPlayerInteraction()` path as actual E/Space interactions, so the preview target and the real action stay aligned.
- Browser playtest evidence:
  - `output/web-game/civ-terrain-reticle-final/before-mine-reticle.png` shows Mine mode with the active terrain marker visible.
  - `output/web-game/civ-terrain-reticle-final/summary.json` shows `active_target.kind=terrain`, `action=mine_tile`, and `targetId=tile:48,49`.
  - Earlier reticle runs also verified Build mode target reporting at `output/web-game/civ-terrain-reticle-strong/summary.json`.
- Verification passed: `npm test -- civStore.test.ts App.test.tsx`, `npm run build`, and `cargo check`.

Next TODO:
- Add actual terrain collision/platform feel instead of free-swim-only movement.
- Add visible terrain-edit quests: repair a breach, rescue behind blocks, or bridge to a resource pocket.
- Consider an on-canvas contextual glyph for Use-mode NPC/resource/building targets if they feel ambiguous in broader playtests.

2026-06-05 grounded movement pass:
- Added terrain-aware possessed-player locomotion. When the axolotl reaches the seabed and moves horizontally, it now enters a grounded walk that follows the generated terrain instead of drifting like free-swim movement.
- Added `locomotion` and `floor_y` to `window.render_game_to_text()` player state, so Codex/browser playtests can verify whether the player is grounded, swimming, and correctly aligned with terrain.
- Added ground stickiness through small drops plus steep-rise blocking, while keeping ArrowUp/W swim input as the explicit break back into swimming.
- Browser playtest evidence:
  - `output/web-game/civ-grounded-movement-2/summary.json` shows `settled` at `y=776/floor_y=776`, `walk-right` at `y=680/floor_y=680` with `locomotion=grounded`, and `swim-up` at `y=507/floor_y=680` with `locomotion=swim`.
  - `output/web-game/civ-grounded-movement-2/settled-grounded.png`, `walk-right.png`, and `swim-up.png` were visually inspected and match the text state.
- Verification passed: `npm test -- civStore.test.ts App.test.tsx`, `npm run build`, and `cargo check`.
- Caveat: the official `develop-web-game` client still cannot run from this shell because Node ESM cannot resolve `playwright` from the skill script, even with the bundled module path. Targeted browser runs used the bundled Codex Node runtime with Playwright and had no console/page errors.

Next TODO:
- Add real tile side-collision and a jump/dash decision if the game should become more Terraria-like than aquatic platforming.
- Add visible terrain-edit quests that make mining/building matter: repair a breach, rescue behind blocks, or bridge to a resource pocket.
- Add NPC/world-object interactions with explicit map targets, hazards, and rewards so the in-app Codex pilot has more to perform than fetch/trade/visit loops.

2026-06-05 visible repair quest pass:
- Added a visible `object` entity type usage for the axolotl game via a damaged `Nest Breach` near each new colony nest. The renderer draws it as a cracked marker when damaged and a sealed marker after repair, without adding new asset files.
- Added an elder repair quest: elder NPCs can ask the player to gather 2 fiber, then repair the marked Nest Breach. The task uses existing log markers plus a new `task=repair_object` / `object=<id>` marker, so HUD, text state, backend, and browser preview stay aligned without a new save-schema field.
- Added backend/browser-preview parity for `repair_object`: it consumes the requested fiber, repairs the object, rewards morale/health/clean water, boosts the requester, and clears the task.
- Taught the in-app Codex pilot and external `civ:codex-play` driver about `task-repair`. The pilot can request the repair from an elder, gather fiber, target the breach object, interact, and return home.
- Found and fixed a playability gap during the first repair-pilot run: the pilot created the repair task but drifted across the map because task-relevant fiber was crowded out of `nearby_interactions`. The text output now reserves slots for active-task resources/objects, and new colonies seed a local fiber patch near the breach.
- Browser playtest evidence:
  - Failed/stuck run: `output/web-game/civ-repair-object-pilot-2/summary.json` shows `task=repair_object` stuck open with no ready state while the pilot drifted to the map edge.
  - Fixed run: `output/web-game/civ-repair-object-pilot-3/summary.json` shows `sawRepairTask=true`, `sawFiberTarget=true`, `sawReady=true`, `sawObjectTarget=true`, and final `task=null` with `breach.activity=repaired`.
  - Visual evidence: `output/web-game/civ-repair-object-pilot-3/repair-target.png` and `after-complete.png` show the in-app Repair pilot targeting/completing the Nest Breach.
- Verification passed: `npm test -- civStore.test.ts App.test.tsx`, `npm run build`, and `cargo check`.

Next TODO:
- Add side-collision/jump-or-dash tuning if the target feel should move further from aquatic movement toward Terraria-like platforming.
- Add another world-object quest with a different verb, such as rescue behind blocks or bridge to a resource pocket, so repair is not the only object interaction.
- Add hazards or blockers that make terrain edits tactically necessary instead of optional.

2026-06-05 dash traversal pass:
- Added a possessed-player burst/dash on `Shift` or `Q`, with a 1350ms cooldown. The dash uses the current movement vector, stays inside the existing world/floor clamps, creates a visible wake/pulse, and does not affect short interactions unless the player or pilot asks for it.
- Added `dash_ready` and `dash_cooldown_ms` to `window.render_game_to_text()` player state so Codex can tell when traversal burst is available.
- Taught the in-app Codex pilot to request burst movement on long move decisions, and taught the external `civ:codex-play` driver to hold `Shift` on long target moves.
- Browser playtest evidence:
  - `output/web-game/civ-dash-manual/summary.json` compares the same 650ms right movement: normal movement moved 105px, while Shift dash moved 211px and reported a positive dash cooldown.
  - `output/web-game/civ-dash-manual/walk-right.png` and `dash-right.png` were visually inspected.
  - `output/web-game/civ-dash-pilot-repair/summary.json` shows the in-app Repair pilot used dash (`sawCooldown=true`), reached the repair object (`sawObject=true`), and completed the task with `breach.activity=repaired`.
  - `output/web-game/civ-dash-pilot-repair/object-target.png` and `after-complete.png` were visually inspected.
- Verification passed: `npm test -- civStore.test.ts App.test.tsx`, `npm run build`, and `cargo check`.

Next TODO:
- Add true side-collision or a wall-grab/slide rule if terrain should behave more like Terraria platforms instead of aquatic slopes.
- Add another object quest with a different verb, such as rescue behind blocks or bridge to a resource pocket.
- Add hazards/blockers that make mining, building, and dash timing matter.

2026-06-05 side-collision and mine-targeting pass:
- Added player terrain collision feedback. The possessed axolotl now records recent `blocked` state in `window.render_game_to_text()` with tile coordinates and reason, and the canvas flashes the blocked tile so a human watcher can see why movement stopped.
- Added a solid-tile cache during terrain bake and a sampled horizontal collision resolver, so long movement/dash bursts cannot silently pass through solid terrain. Small one-tile rises remain climbable; tall/steep rises block unless the player deliberately swims upward around them.
- Found and fixed a mine targeting playability gap: after placing a block near the player, Mine mode could choose a slightly closer vein/ground tile instead of the facing block. Mine now prefers a recent blocked tile and a short facing ray before falling back to nearest terrain.
- Browser playtest evidence:
  - `output/web-game/civ-side-collision/scan-left.png` plus JSON samples show walking left into a steep rise holds the player near `x=1025,y=808` with `blocked.reason=steep_rise`.
  - `output/web-game/civ-side-collision/swim-over-left.png` shows holding up+left breaks into swim, clears the collision, and moves around the obstruction.
  - `output/web-game/civ-side-collision/preferred-mine-after-mine.png` shows Build placed stone at `tile:49,48`, Mine targeted that facing stone first, and E mined it back out.
- Verification passed: `npm test -- civStore.test.ts App.test.tsx`, `npm run build`, and `cargo check`.
- Caveats:
  - Official `develop-web-game` client remains unavailable from this shell because its ESM import cannot resolve Playwright; browser runs used the bundled Codex Node runtime with Playwright.
  - Browser console had no page errors; only normal Phaser/Vite logs and WebGL readback warnings.

Next TODO:
- Add a true jump/wall-slide choice if the movement should become less aquatic and more strictly Terraria-like.
- Add hazards/blockers that require mining/building/dashing to solve, not just optional terrain edits.
- Add another object quest with a different verb, such as rescue behind blocks or bridge to a resource pocket.

2026-06-06 rescue-object quest and Codex play pass:
- Added a blocked rescue quest for the axolotl game. New colonies now spawn a `Trapped Juvenile` object behind three rubble tiles, and a scout NPC can request `task=rescue_object`.
- Added backend/browser-preview parity for `rescue_object`: the task counts remaining rubble from terrain state, refuses completion until the rubble is cleared, then marks the trapped object `rescued` and rewards morale/health.
- Taught the HUD, text renderer, in-app Codex pilot, and external `civ:codex-play` driver about Rescue. The pilot can request the scout task, navigate to the blocked object, switch to Mine for rubble, switch back to Use, rescue the juvenile, and keep moving afterward.
- Found and fixed two playability gaps during headed Codex runs:
  - After mining the rubble, the pilot stayed in Mine mode and could not rescue the object. Task interactions now explicitly switch back to Use.
  - A ledge-descent approach could hold Down against the floor clamp before rubble entered targeting range. The rescue approach now uses a side target when the object is below a ledge, and the external driver presses horizontal movement during steep vertical descents.
- Browser playtest evidence:
  - Stuck Mine-mode run: `output/web-game/civ-rescue-pilot-1/` shows the rescue object in reach while active target stayed `No mineable tile in reach`.
  - Fixed rescue but sticky return run: `output/web-game/civ-rescue-pilot-2/` shows `trapped-1.activity=rescued` and exposed post-task terrain recovery tuning.
  - Ledge-descent regression run: `output/web-game/civ-rescue-pilot-3/` shows the pilot pinned above the rescue pocket before the approach fix.
  - Final run: `output/web-game/civ-rescue-pilot-4/` shows request, rubble progress, rescue completion, final `player_task=none`, `trapped-1.activity=rescued`, and no final blocked state.
- Verification passed: `npm test -- civStore.test.ts App.test.tsx`, `npm run build`, and `cargo check` (same existing unused `TauriPermissionPrompter` warning).

Next TODO:
- Add a true jump/wall-slide choice if the movement should become less aquatic and more strictly Terraria-like.
- Add one more terrain-dependent objective, such as building a bridge to a resource pocket, so Build becomes as mission-critical as Mine.
- Add lightweight NPC follow-up behavior after rescue so the scout or rescued juvenile visibly reacts beyond the log/morale reward.

2026-06-06 bridge-build quest and Build playability pass:
- Added a `Bridge Gap` object and a builder NPC role. New colonies now spawn a three-tile water gap near a glowshard pocket, and the builder can request `task=build_bridge`.
- Added backend/browser-preview parity for `build_bridge`: task progress is calculated from terrain state, and the task completes only after the target bridge tiles become substrate. Completion marks the bridge `built`, rewards morale/health, and grants a glowshard.
- Added HUD text, task panel labels, pilot goal option, bridge marker rendering, and Codex pilot/driver support for the bridge loop.
- Found and fixed two playability gaps during headed Codex runs:
  - Task request range was too strict: the player could sit 19px from the builder while the pilot used an 18px request threshold. Task requests now use a wider interaction threshold.
  - After placing one bridge tile, remaining bridge tiles were hard to target. Build targeting now considers farther forward tiles, and the bridge pilot uses movement-only side sweeps instead of interacting with an approach point.
- Browser playtest evidence:
  - Request-radius failure: `output/web-game/civ-bridge-pilot-1/` shows the player parked beside `Axolotl 2` with no request log.
  - One-tile stall: `output/web-game/civ-bridge-pilot-2/` shows `build_bridge` stuck at `1/3` with `No buildable water in reach`.
  - Final run: `output/web-game/civ-bridge-pilot-3/` shows request, bridge placement progress, final `player_task=none`, `bridge-1.activity=built`, morale 82, glowshards 2, and no final blocked state.
- Verification passed: `npm test -- civStore.test.ts App.test.tsx`, `npm run build`, and `cargo check` (same existing unused `TauriPermissionPrompter` warning).

Next TODO:
- Add lightweight NPC follow-up behavior after rescue/bridge completion so the requesting NPC visibly moves toward or celebrates at the completed object.
- Consider a true jump/wall-slide choice if the movement should become less aquatic and more strictly Terraria-like.
- Add one small hazard or timed pressure around terrain edits so Mine/Build choices matter under mild risk, not just as static objectives.

2026-06-06 NPC follow-up and watched Codex play pass:
- Added completion follow-through for visible object tasks. Repair, rescue, and bridge completion now assign the requester a `celebrate` activity plus `target_x/target_y` at the completed object, so NPCs visibly swim toward the finished site instead of only changing logs/rewards.
- Rescue completion now spawns a real juvenile axolotl NPC (`rescued-<object id>`) beside the rescued marker and increments population once. Browser preview and Rust backend share the same behavior.
- Added `target_x`/`target_y` to `window.render_game_to_text()` visible entities so Codex playtests can verify NPC follow-up movement directly.
- Found and fixed a rescue playability gap while watching Codex play: rescue mining could target generic mud/earth near the marker instead of the three required rubble tiles, causing long oscillation. Rescue tasks now surface exact rubble targets, Mine mode prioritizes those task tiles, and the pilot approaches mine targets from water instead of steering into solid tile centers.
- Browser playtest evidence:
  - Slow rescue run before targeting fix: `output/web-game/civ-rescue-followup-1/` completed only at step 55 but confirmed population 9 and `rescued-trapped-1`.
  - Fixed rescue run: `output/web-game/civ-rescue-followup-2/` completes rescue at step 15 with `player_task=null`, population 9, scout `activity=celebrate` at the rescue target, and `rescued-trapped-1.activity=rescued`.
  - Bridge regression: `output/web-game/civ-bridge-followup-1/` completes at step 13 with `bridge-1.activity=built` and builder `activity=celebrate` at the bridge target.
  - Repair regression: `output/web-game/civ-repair-followup-1/` completes at step 14 with `breach-1.activity=repaired` and elder `activity=celebrate` at the breach target.
- Verification passed: `npm test -- civStore.test.ts App.test.tsx`, `npm run build`, and `cargo check` (same existing unused `TauriPermissionPrompter` warning).

Next TODO:
- Add a true jump/wall-slide choice if the movement should become less aquatic and more strictly Terraria-like.
- Add one small hazard or timed pressure around terrain edits so Mine/Build choices matter under mild risk, not just as static objectives.
- Consider ending Codex pilot runs once a task completes, so watched demos do not continue into repetitive post-task patrol loops unless requested.

2026-06-06 Codex pilot stop-on-complete pass:
- Fixed the watched-play pacing gap where task demos kept wandering after the objective was already complete.
- The in-app Codex pilot now stops itself for task goals as soon as the active task clears, sets status to `Task complete`, clears the pilot command, and leaves the player at the completed scene.
- The external `tauri-app/scripts/codex-play-civ.mjs` driver now stops task-goal runs immediately after writing the final completion screenshot/state, returns completion metadata, and still supports `--continue-after-task` for free-form follow-up movement.
- Synced the external driver with the in-app rescue pilot by targeting the exact three rescue rubble tiles and approaching mine targets from adjacent water instead of steering into solid tile centers.
- Browser playtest evidence:
  - External watched bridge run: `output/web-game/civ-bridge-stop-on-complete-1/` was allowed 40 steps but stopped after 12 with `completed=true`, `player_task=null`, `bridge-1.activity=built`, and no `codex-play-12.*` post-completion artifact.
  - In-app Bridge pilot run: `output/web-game/civ-inapp-pilot-stop-1/` shows the Pilot button back to `Pilot`, HUD message `Codex pilot completed the task.`, `player_task=null`, and builder `activity=celebrate` at the bridge target.
- Verification passed: `node --check tauri-app/scripts/codex-play-civ.mjs`, `npm test -- civStore.test.ts App.test.tsx`, and `npm run build`.

Next TODO:
- Add a true jump/wall-slide choice if the movement should become less aquatic and more strictly Terraria-like.
- Add one small hazard or timed pressure around terrain edits so Mine/Build choices matter under mild risk, not just as static objectives.
- Add a small task summary overlay or completion badge if the user should be able to tell at a glance why the pilot stopped after a watched run.

2026-06-06 silt vent hazard pass:
- Added a small terrain-work hazard to the bridge objective. New colonies and browser preview sessions now spawn a `Silt Vent` object beside the bridge gap.
- The Civ canvas renders active vents as an amber plume/radius, exposes `player.hazard_contact` in `window.render_game_to_text()`, and mildly slows possessed-player swim/walk/dash while inside the plume.
- Bridge completion now seals nearby seep vents in both Rust and browser preview, removing the active hazard once the build objective is finished.
- Kept vents non-interactive so Use mode does not mistake them for repair/rescue targets; they are environmental pressure around the Build task rather than another UI verb.
- Browser playtest evidence:
  - First headed bridge hazard run: `output/web-game/civ-bridge-hazard-1/` shows `hazard_contact` while working near `seep-1`, final `bridge-1.activity=built`, and `seep-1.activity=sealed`.
  - Tuned visual replay: `output/web-game/civ-bridge-hazard-2/` completed reliably in 13 steps, showed the stronger visible plume during bridge work, and ended with the seep sealed and no post-completion step artifact.
- Verification passed: `npm test -- civStore.test.ts App.test.tsx`, `npm run build`, and `cargo check` (same existing unused `TauriPermissionPrompter` warning).

Next TODO:
- Add a true jump/wall-slide choice if the movement should become less aquatic and more strictly Terraria-like.
- Add a small task summary overlay or completion badge if the user should be able to tell at a glance why the pilot stopped after a watched run.
- Consider adding a hazard-aware task prompt/log line so the builder explicitly warns the player about the silt vent before bridge work begins.

2026-06-06 bridge hazard warning pass:
- Added hazard-aware bridge wording across Rust sessions, browser preview sessions, and the player task UI. Builder request/pending/completion logs now explain that the silt vent slows the crossing until the bridge is sealed while keeping the `task=build_bridge` machine markers intact.
- Updated the always-visible task strip to read `Build through silt`, and the task panel/NPC task copy now calls out the silt plume and sealed vent states.
- Added a parser regression test for bridge requests containing hazard copy so visible log text can change without breaking `activeCivPlayerTask`.
- Browser playtest evidence:
  - `output/web-game/civ-bridge-warning-1/` completed the headed Bridge pilot in 14 steps with no browser errors.
  - `codex-play-01.png` shows the new `Build through silt` task strip after the request.
  - `codex-play-12.json` shows `hazard_contact` with active `seep-1` while bridge work is in progress.
  - `codex-play-13.json` shows `player_task=null`, `bridge-1.activity=built`, `seep-1.activity=sealed`, morale 82, and glowshards 2.
- Verification passed: `npm test -- civStore.test.ts App.test.tsx`, `npm run build`, and `cargo check` (same existing unused `TauriPermissionPrompter` warning; same large Civilization chunk warning).

Next TODO:
- Add a true jump/wall-slide choice if the movement should become less aquatic and more strictly Terraria-like.
- Add a small task summary overlay or completion badge if the user should be able to tell at a glance why the pilot stopped after a watched run.
- Consider exposing the full active task panel more directly during watched Codex runs; the always-visible strip is clear, but the detailed warning lives in the Observer/Player panel path.

2026-06-06 task completion badge pass:
- Added a compact HUD completion strip that appears when the latest `Task complete` player log is recent and no active task remains. This keeps watched Codex runs from looking like the task simply disappeared.
- The badge uses `cleanCivLogBody()` so it preserves the visible completion summary while excluding task markers, and it truncates long text to avoid HUD overlap.
- Browser playtest evidence:
  - `output/web-game/civ-bridge-complete-badge-1/` completed the headed Bridge pilot in 16 steps with no browser errors.
  - `codex-play-15.png` shows the new `Task complete` HUD strip directly under the objective strip.
  - `codex-play-15.json` shows `player_task=null`, `bridge-1.activity=built`, `seep-1.activity=sealed`, morale 82, and glowshards 2.
- Verification passed: `npm test -- civStore.test.ts App.test.tsx`, `npm run build`, and `cargo check` (same existing unused `TauriPermissionPrompter` warning; same large Civilization chunk warning).

Next TODO:
- Add a true jump/wall-slide choice if the movement should become less aquatic and more strictly Terraria-like.
- Consider exposing the full active task panel more directly during watched Codex runs; the always-visible strip and completion badge are clear, but the detailed task panel still lives in the Observer/Player panel path.
- Add another mild pressure loop outside bridge work, such as a temporary leak or low-oxygen pocket, if MVP needs repeated hazard variety rather than one scripted bridge hazard.

2026-06-06 grounded jump control pass:
- Added a scoped Terraria-like jump for possessed axolotls. Pressing Up/W from the floor now applies a jump impulse, exposes `locomotion: "jump"` plus `jump_velocity_y` in `window.render_game_to_text()`, and lands back into `grounded` locomotion under gravity.
- Preserved swim control away from the floor so the underwater traversal still works; the jump arc only activates from grounded/floor-adjacent state.
- Added a small particle/pulse wake on jump takeoff using the existing visual effect system.
- Browser playtest evidence:
  - First setup run `output/web-game/civ-jump-control-1/` confirmed that pressing W while mid-water still swims, which is the intended non-grounded behavior.
  - Grounded jump run `output/web-game/civ-jump-control-2/` shows `jump-before.json` as grounded at y=776, `jump-mid.json` as `locomotion="jump"` with y=719 and `jump_velocity_y=-2.47`, then `jump-after.json` grounded again at y=776.
  - Bridge regression `output/web-game/civ-bridge-after-jump-1/` still completes the watched Bridge pilot in 18 steps with no browser errors, final `player_task=null`, `bridge-1.activity=built`, and `seep-1.activity=sealed`.
- Verification passed: `npm test -- civStore.test.ts App.test.tsx`, `npm run build`, and `cargo check` (same existing unused `TauriPermissionPrompter` warning; same large Civilization chunk warning).

Next TODO:
- Consider wall-slide/wall-kick only after deciding whether the axolotl game should lean more terrestrial or remain mostly aquatic with grounded jump pockets.
- Consider exposing the full active task panel more directly during watched Codex runs; the always-visible strip and completion badge are clear, but the detailed task panel still lives in the Observer/Player panel path.
- Add another mild pressure loop outside bridge work, such as a temporary leak or low-oxygen pocket, if MVP needs repeated hazard variety rather than one scripted bridge hazard.

2026-06-06 wall-slide / wall-kick control pass:
- Added a Terraria-like wall-slide and wall-kick layer on top of possessed axolotl grounded jump. Holding into a solid terrain face while falling now caps descent as `locomotion="wall_slide"`, exposes `wall_contact` in `window.render_game_to_text()`, and pressing Up/W during contact kicks away from the wall.
- Added a short wall-kick input lockout so holding into the wall does not immediately cancel the away impulse. This came directly from the first headed probe: `output/web-game/civ-wall-slide-1/` found `wall_slide`, but the kick drifted back toward the wall.
- Browser playtest evidence:
  - `output/web-game/civ-wall-slide-2/wall-slide-left.json` shows `locomotion="wall_slide"`, `wall_contact.direction=-1`, and capped `jump_velocity_y=0.74`.
  - `output/web-game/civ-wall-slide-2/wall-kick-left.json` shows the kick moved from x=512 to x=538, away from the left wall, and returned to `locomotion="jump"`.
  - `wall-slide-left.png` and `wall-kick-left.png` were visually inspected and match the text state.
  - Bridge regression `output/web-game/civ-bridge-after-wallslide-1/` still completes the watched Bridge pilot in 20 steps with no browser errors, final `player_task=null`, `bridge-1.activity=built`, and `seep-1.activity=sealed`.
- Verification passed: `npm test -- civStore.test.ts App.test.tsx`, `npm run build`, and `cargo check` (same existing unused `TauriPermissionPrompter` warning; same large Civilization chunk warning).

Next TODO:
- Add another mild pressure loop outside bridge work, such as a temporary leak or low-oxygen pocket, if MVP needs repeated hazard variety rather than one scripted bridge hazard.
- Consider exposing the full active task panel more directly during watched Codex runs; the always-visible strip and completion badge are clear, but the detailed task panel still lives in the Observer/Player panel path.
- Revisit wall-slide tuning after more manual play if the axolotl should feel floatier than a terrestrial Terraria character.

2026-06-06 nest leak repair pressure pass:
- Added a second mild hazard loop around repair work. New colonies and browser-preview sessions now spawn a `Nest Leak` object beside the `Nest Breach`.
- The existing hazard renderer now handles amber silt vents and cyan nest leaks; `render_game_to_text()` reports `player.hazard_contact` for `Nest Leak`, and possessed-player movement is slowed while inside the leak plume.
- Repair completion now seals nearby leaks in Rust and browser preview, while request/pending/completion logs and the task UI explain that the leak slows the repair site until sealed.
- Added parser coverage for repair requests with nest-leak hazard copy, keeping saved-log task extraction stable.
- Found and fixed a real playability gap during the first headed repair run: the pilot reached the leak site but Use mode still targeted nearby moss before task fiber, stretching completion to 41 steps. Use mode now prefers the active task's required resource for fetch/trade/repair tasks before generic resources.
- Browser playtest evidence:
  - Slow first run: `output/web-game/civ-repair-leak-1/` completed repair, sealed `leak-1`, and exposed the moss-targeting gap.
  - Fixed repair run: `output/web-game/civ-repair-leak-2/` completes at step 16; `codex-play-14.json` shows active `Nest Leak` hazard contact and ready repair progress, and `codex-play-15.json` shows `player_task=null`, `breach-1.activity=repaired`, and `leak-1.activity=sealed`.
  - Bridge regression: `output/web-game/civ-bridge-after-leak-1/` completes at step 15 with `bridge-1.activity=built` and `seep-1.activity=sealed`, confirming Build tasks were not hijacked by the resource-targeting fix.
- Verification passed: `npm test -- civStore.test.ts App.test.tsx`, `npm run build`, and `cargo check` (same existing unused `TauriPermissionPrompter` warning; same large Civilization chunk warning).

Next TODO:
- Add a small in-game pilot/debug readout or camera-follow cue so users watching Codex immediately understand why it is taking a detour toward a resource.
- Consider adding a low-oxygen or timed rescue variant after the leak/vent hazards, but only if it creates a different decision instead of another slow aura.
- Continue tuning grounded/wall movement by manual play; the current wall-kick is functional, but the feel may still need to be more aquatic than Terraria's default.

2026-06-06 watched pilot intent readout pass:
- Added a compact in-game Codex pilot readout to the existing HUD strip. While the in-app pilot is running it now shows the current decision plus small chips for step, action, tool, target label, target tile, and distance.
- Cleared the readout on pilot stop, release, task completion, missing world state, and manual Mine/Build takeover so stale pilot intent does not linger.
- Verified the readout with the real in-app pilot rather than the external driver:
  - Repair readout: `output/web-game/civ-inapp-pilot-readout-1/pilot-readout-mid.png` shows `Codex pilot: gather fiber` with `Step 6`, `Move`, `fiber`, `tile 54,48`, and distance chips. Final screenshot/state show the pilot stopped and the task completion strip remained.
  - Bridge readout: `output/web-game/civ-inapp-pilot-readout-bridge-build-1/pilot-readout-build.png` shows the Build path directly with `Interact`, `Build`, `stone`, `tile 69,50`, and distance chips while the bridge task is in progress.
- Browser checks reported no console/page errors. The UI stayed compact and did not cover the active play area.
- Verification passed: `npm test -- civStore.test.ts App.test.tsx` and `npm run build` (same large Civilization chunk warning).

Next TODO:
- Use a watched manual movement pass to tune wall-kick/swim feel now that the pilot path is easier to understand.
- Consider adding a distinct timed/oxygen pressure objective only if it introduces a new decision, such as retreating to an oxygen pocket, rather than another generic slow aura.

2026-06-06 jump buffer / coyote control pass:
- Added explicit jump-buffer and ground-coyote windows to possessed axolotl movement: quick Up/W taps shortly before landing now trigger the next grounded jump instead of being swallowed.
- Added short wall-contact coyote support so wall-kick input remains forgiving around the contact frame. The existing jump impulse, wall-kick impulse, and underwater swim control were left intact.
- Exposed `jump_buffer_ms` and `coyote_ms` in `window.render_game_to_text()` for direct automation verification.
- Tightened grounded detection so the broad floor-proximity check does not refresh coyote time while an upward jump is still active, avoiding accidental double-jump behavior.
- Browser playtest evidence:
  - Initial setup miss: `output/web-game/civ-jump-buffer-1/` showed the player was still mid-water, so the run was correctly discarded as a setup failure.
  - Buffered landing jump: `output/web-game/civ-jump-buffer-2/buffer-pre-tap.json` shows the player falling near the floor with positive jump velocity, and `buffer-tapped.json` / `buffer-after.json` show a fresh jump with negative velocity after the early tap. Screenshot `buffer-tapped.png` visually confirms the second takeoff.
  - Wall-kick smoke: `output/web-game/civ-wall-after-coyote-1/` found left-wall contact at tile 31,44 and `wall-kick-probe.json` shows the player moved from x=512 to x=540 away from the wall after kick input.
  - Bridge regression: `output/web-game/civ-bridge-after-coyote-1/` still completes the Bridge task in 16 steps with `player_task=null`, `bridge-1.activity=built`, and `seep-1.activity=sealed`.
- Verification passed: `npm test -- civStore.test.ts App.test.tsx` and `npm run build` (same large Civilization chunk warning).

Next TODO:
- Consider adding a distinct timed/oxygen pressure objective only if it introduces a different decision loop than the existing slow-plume hazards.
- Do a manual-feel pass on horizontal acceleration/dash recovery after the control forgiveness changes; the buffered jump is better, but long underwater descents can still feel floaty.

2026-06-06 low-oxygen rescue pressure pass:
- Added a `Low Oxygen Pocket` object beside the trapped juvenile in Rust sessions and the browser preview fallback. It renders as a purple-blue pocket and is active only until the nearby trapped object is rescued.
- Added player oxygen state to possessed axolotl play: `window.render_game_to_text()` now reports `player.oxygen` with value/status/in-pocket state and oxygen hazard contact includes `role: "oxygen"`.
- Tuned the pocket as a pressure loop, not a movement trap. Oxygen drains inside the pocket, recovers outside, and only applies a mild critical movement penalty at the bottom of the meter.
- Updated rescue task copy to call out low oxygen, and taught both the in-app pilot and external watched driver to retreat upward out of the pocket, recover with hysteresis, then resume mining/rescue.
- Found and fixed a pilot targeting gap while testing repair: goal-specific task requests now wait until closer to the intended NPC, avoiding accidental task pickup from a nearby scout.
- Browser playtest evidence:
  - Failed tuning runs `output/web-game/civ-rescue-oxygen-1/` and `output/web-game/civ-rescue-oxygen-2/` showed the pilot recognizing oxygen but getting trapped/oscillating near the slope. This drove the vertical retreat and oxygen tuning fixes.
  - Fixed rescue run `output/web-game/civ-rescue-oxygen-3/` completed in 24 steps. `codex-play-16.json` and `codex-play-17.json` show oxygen draining in the pocket while progress reaches 2/3, `codex-play-18.json` and `codex-play-19.json` show recovery outside the pocket, and `codex-play-23.json` shows `player_task=null` after rescuing the trapped juvenile.
  - Bridge regression `output/web-game/civ-bridge-after-oxygen-1/` completed in 16 steps with `bridge-1.activity=built` and `seep-1.activity=sealed`.
  - Repair regression initially picked up the wrong scout task; after the targeting fix, `output/web-game/civ-repair-after-oxygen-2/` completed in 19 steps with `breach-1.activity=repaired` and `leak-1.activity=sealed`.
- Verification passed: `npm test -- civStore.test.ts App.test.tsx`, `npm run build`, and `cargo check` (same existing unused `TauriPermissionPrompter` warning; same large Civilization chunk warning).
- Note: the exact `develop-web-game` CLI script could not run directly from shell because the skill file lives outside a usable ESM `node_modules` tree and the bundled Playwright package is pnpm-linked. The watched/regression runs used the working Node REPL Playwright route and inspected screenshots plus `render_game_to_text()` state.

Next TODO:
- Add a compact on-canvas oxygen meter/chip when possessed so human players see the meter without needing `render_game_to_text()`.
- Consider giving the trapped juvenile a small idle animation or callout after rescue so the completed object reads more clearly from the game view.
- If more AI task types are added, make pilot task-request targeting target-id aware instead of relying only on closer movement before pressing Use.

2026-06-06 oxygen meter readability pass:
- Added a compact in-world oxygen meter above the possessed axolotl. It appears only when oxygen is below full or the player is inside the low-oxygen pocket, uses a small bubble icon plus a stable-width bar, and changes color for recovering/low/critical states.
- Kept the meter on the Phaser effects layer beside the existing player ring/reticle so it follows the character without adding another React HUD state loop.
- Browser playtest evidence:
  - Headed rescue run `output/web-game/civ-rescue-oxygen-meter-1/` completed in 29 steps with no browser errors.
  - `codex-play-16.json` shows `oxygen=53`, `status=draining`, `in_pocket=true`, `progress=2/3`; matching screenshot `codex-play-16.png` shows the meter over the player inside the pocket.
  - `codex-play-18.json` shows `oxygen=63`, `status=recovering`, `in_pocket=false`; matching screenshot `codex-play-18.png` shows the meter still visible while Codex recovers above the pocket.
  - `codex-play-28.json` shows the rescue complete and oxygen stable again.
- Verification passed: `npm test -- civStore.test.ts App.test.tsx` and `npm run build` (same large Civilization chunk warning).

Next TODO:
- Consider giving the trapped juvenile a small idle animation or callout after rescue so the completed object reads more clearly from the game view.
- If more AI task types are added, make pilot task-request targeting target-id aware instead of relying only on closer movement before pressing Use.
- Revisit whether the on-canvas meter should become a persistent HUD chip once multiple player vitals exist.

2026-06-06 rescued juvenile readability pass:
- Added an animated rescued-site effect for completed rescue objects on the Phaser effects layer: soft green pulse rings, a small check badge, and rising bubbles around any `object` with `role="trapped"` and `activity="rescued"`.
- This keeps the saved state readable in the game world after the HUD task strip clears, without adding more persistent text overlays.
- Browser playtest evidence:
  - Headed rescue run `output/web-game/civ-rescue-saved-marker-1/` completed in 29 steps with no browser errors.
  - `codex-play-28.json` shows `player_task=null`, `trapped-1.activity=rescued`, spawned `rescued-trapped-1` juvenile axolotl, and scout `axo-7.activity=celebrate` targeting the rescued tile.
  - `codex-play-28.png` was visually inspected and shows the completed rescue site with the new green pulse/check feedback next to the rescued juvenile.
- Verification passed: `npm test -- civStore.test.ts App.test.tsx` and `npm run build` (same large Civilization chunk warning).

Next TODO:
- If more AI task types are added, make pilot task-request targeting target-id aware instead of relying only on closer movement before pressing Use.
- Revisit whether the on-canvas oxygen meter should become a persistent HUD chip once multiple player vitals exist.
- Add another manual-feel pass around horizontal acceleration/dash recovery after the latest rescue/hazard loops.

2026-06-06 in-app pilot target/pathing pass:
- Made in-app pilot interaction commands carry their intended target id/tile/action through to Phaser, so Use/Mine/Build resolves against the pilot's requested target instead of whatever nearby interaction happens to sort first.
- Synced the selected player tool while the pilot is moving toward a target, keeping the HUD/reticle aligned with whether Codex intends to Use, Mine, or Build.
- Found two watched rescue gaps and fixed them:
  - `output/web-game/civ-inapp-target-aware-rescue-1/` got stuck above the trapped juvenile because the pilot approached rescue rubble from the wrong ledge. The rescue policy now uses a lower side approach for deep trapped-object rubble.
  - `output/web-game/civ-inapp-target-aware-rescue-2/` and `...-rescue-3/` reached `rescue_object:ready:3/3` but could not reach the object because ordinary terrain and resource-bearing terrain blocked the last path. The pilot now mines immediate path blockers during final rescue approach, and nearby interaction de-dupe preserves separate resource-harvest versus terrain-mine actions on the same tile.
- Added `tauri-app/src/lib/civPilot.test.ts` regression coverage for the ready-rescue blocker case and side-approach target.
- Browser playtest evidence:
  - `output/web-game/civ-inapp-target-aware-repair-1/` proved target-aware task pickup avoided the earlier wrong-scout task, completing repair with `breach-1.activity=repaired`.
  - `output/web-game/civ-inapp-target-aware-rescue-4/` completed the in-app Rescue pilot in 47 samples with no browser errors; final state shows `player_task=null`, `trapped-1.activity=rescued`, and `rescued-trapped-1.activity=rescued`.
  - `output/web-game/civ-inapp-target-aware-repair-2/` rechecked repair after the interaction de-dupe change and completed in 8 samples with `breach-1.activity=repaired`.
- Verification passed: `npm test -- civPilot.test.ts civStore.test.ts App.test.tsx` and `npm run build` (same large Civilization chunk warning). No Rust files changed in this pass.

Next TODO:
- The final rescue fallback can tunnel several tiles if the trapped object is behind a thick ledge. It is functional and Terraria-like, but manual feel may benefit from a smarter path/approach point before mining a corridor.
- Consider making the active task panel easier to keep open during watched runs, since the compact HUD is readable but hides some objective detail.
- Revisit horizontal acceleration/dash recovery after more manual play around the rescue tunnel.

2026-06-06 rescue reach / less-tunneling pass:
- Replayed the current in-app Rescue pilot specifically to measure the previous TODO. `output/web-game/civ-rescue-tunnel-measure-1/` reproduced a worse current gap: after reaching `rescue_object:ready:3/3`, the pilot mined 4 post-ready path tiles and still failed to rescue after 105 samples.
- Fixed the ready-rescue policy so Codex tries the rescue interaction first once the trapped object is within a broader but still local rescue radius, instead of mining more blockers before attempting Use.
- Increased ready-rescue object interaction reach in the canvas and target-aware pilot resolver while keeping normal repair reach unchanged.
- Added a blocked-tile fallback target in the pilot policy for cases where a real solid blocker is not present in the limited nearby terrain list, so the pilot can still clear the correct tile when the object remains out of rescue range.
- Mirrored the policy in `tauri-app/scripts/codex-play-civ.mjs` and added regression coverage for the final stuck state where the object was 78px away but the pilot kept mining.
- Browser playtest evidence:
  - Fixed rescue replay: `output/web-game/civ-rescue-tunnel-measure-2/` completed in 10 samples with no browser errors, `trapped-1.activity=rescued`, and only 1 post-ready mined tile, the final required rubble tile.
  - Repair regression: `output/web-game/civ-repair-after-rescue-reach-1/` completed in 8 samples with no browser errors and `breach-1.activity=repaired`.
  - Final screenshots from both runs were visually inspected and show task-complete badges plus correct world state.
- Verification passed: `npm test -- civPilot.test.ts civStore.test.ts App.test.tsx` and `npm run build` (same large Civilization chunk warning). No Rust files changed in this pass.

Next TODO:
- Do a manual movement-feel pass around horizontal acceleration/dash recovery now that the rescue tunnel is no longer the obvious blocker.
- Consider making the active task panel easier to keep open during watched runs, since the compact HUD is readable but hides some objective detail.
- Re-run a bridge watched pass if future Build/Use reach tuning touches generic object or terrain targeting.

2026-06-06 manual movement smoothing pass:
- Measured manual possession movement before tuning in `output/web-game/civ-manual-move-feel-1/`. The player stopped dead on key release (`release-after-right.totalDx=0`) and also stopped dead after dash release (`release-after-dash.totalDx=0`), which made swim movement and dash recovery feel like hard teleports.
- Added manual-only movement velocity for possessed axolotl control. Swim and grounded movement now accelerate into input and damp quickly after release; pilot movement remains direct so task automation does not inherit overshoot.
- Added `velocity_x` and `velocity_y` to `window.render_game_to_text()` so future movement probes can distinguish input velocity from just position deltas.
- Browser playtest evidence:
  - `output/web-game/civ-manual-move-feel-2/summary.json` shows release carry after right and dash changed from 0px to 10px, with velocity damping back to zero over the next samples.
  - `output/web-game/civ-grounded-move-feel-1/summary.json` shows the player reaches `locomotion=grounded`, walks along the terrain floor, and keeps grounded release/dash recovery tight; a dash into a terrain face reports the expected `blocked` tile.
  - `output/web-game/civ-rescue-after-manual-smoothing-1/` confirms the in-app Rescue pilot still completes after the smoothing change, with `trapped-1.activity=rescued` and no browser errors.
  - Final screenshots from all three runs were visually inspected; the possessed ring, HUD, terrain, and task-complete state remain readable.
- Verification passed: `npm test -- civPilot.test.ts civStore.test.ts App.test.tsx` and `npm run build` (same large Civilization chunk warning). No Rust files changed in this pass.

Next TODO:
- Consider making the active task panel easier to keep open during watched runs, since the compact HUD is readable but hides some objective detail.
- Re-run a bridge watched pass if future Build/Use reach tuning touches generic object or terrain targeting.
- Continue manual feel tuning only after longer hands-on play; current damping avoids both dead-stop movement and slippery uncontrolled swimming.

2026-06-06 active task HUD detail pass:
- Added a compact always-visible detail line and short target/status chips to the top-left active task strip. It reuses task state instead of opening the larger Player drawer, so watched Codex pilot runs keep the objective readable without covering the playfield.
- Kept the strip bounded with two-line clamping, fixed chip max widths, and a capped chip row so long NPC/object names cannot expand the HUD unpredictably.
- Browser playtest evidence:
  - Headed Rescue run `output/web-game/civ-task-detail-hud-1/` completed in 10 samples with no browser errors.
  - `summary.json` shows the active HUD detail text as `Mine 3 rubble tiles near Trapped Juvenile; retreat if oxygen drops.` and chips as `Mine|3 left|Trapped Juvenile`.
  - `active-task-detail.png` was visually inspected and shows the new detail line, chips, task progress, and pilot readout fitting in the existing top-left HUD while the game remains playable.
  - `final.png` was visually inspected and shows the task-complete strip after rescue.
- Verification passed: `npm test -- civPilot.test.ts civStore.test.ts App.test.tsx` and `npm run build` (same large Civilization chunk warning).

Next TODO:
- Re-run a bridge watched pass if future Build/Use reach tuning touches generic object or terrain targeting.
- Continue manual feel tuning only after longer hands-on play; current damping avoids both dead-stop movement and slippery uncontrolled swimming.
- Consider a small on-screen prompt for how to start/stop Codex pilot if new users miss the top toolbar selector.

2026-06-06 bridge center-tile targeting pass:
- Ran a watched Bridge playability pass and found a real stall in `output/web-game/civ-bridge-playability-1/`: Codex placed 2 of 3 bridge tiles, then spent the rest of the run moving around `Bridge Gap` instead of placing the final missing bridge tile.
- Root cause: bridge build task interactions were filtered through generic facing-based placement candidates. When the remaining task tile was the center water/deepwater cell under the possessed axolotl, it was absent from `nearby_interactions`, so the pilot could only see the bridge object and unrelated resource/mine targets.
- Fixed the canvas interaction source to enumerate the bridge task's three exact tiles directly and added direct tile resolution for pilot `place_tile` commands. This keeps manual Build and Codex pilot Build targeting aligned for the task-specific bridge loop.
- Added a `civPilot.test.ts` regression for the stuck `2/3` center bridge tile state: when `tile:70,50` is exposed as a place target, the pilot must interact with Build instead of orbiting the bridge object.
- Browser playtest evidence:
  - Failed baseline: `output/web-game/civ-bridge-playability-1/summary.json` stopped after 90 samples at `progress=2`, `remaining=1`, `finalPilot=reach Bridge Gap`.
  - Fixed replay: `output/web-game/civ-bridge-playability-2/summary.json` completed in 9 samples with no browser errors, `centerTileSeen=true`, `finalTask=null`, and task-complete text for `Built Bridge Gap`.
  - `active-task-detail.png` and `final.png` in `civ-bridge-playability-2/` were visually inspected; the task HUD remains readable and the completed bridge/hazard state is visible in the world.
- Verification passed: `npm test -- civPilot.test.ts civStore.test.ts App.test.tsx` and `npm run build` (same large Civilization chunk warning).

Next TODO:
- Continue manual feel tuning only after longer hands-on play; current damping avoids both dead-stop movement and slippery uncontrolled swimming.
- Consider a small on-screen affordance for discovering Codex pilot controls if new users miss the top toolbar selector.
- If bridge task variants move the bridge object or use non-horizontal bridge shapes, replace the hard-coded three-tile bridge task footprint with task metadata from the backend.

2026-06-06 Codex watch discoverability pass:
- Ran a first-entry manual possession pass in `output/web-game/civ-manual-entry-1/` to check the toolbar before and after possession. Movement itself worked: right movement moved the possessed axolotl +119px, and movement still worked after changing the pilot goal selector.
- Found a clearer UX gap instead: the watched-play entry point in the always-visible toolbar was labeled only `Pilot`, while the adjacent goal dropdown read `Task`. That was functional but underspecified for the user's requested "watch Codex play" flow.
- Renamed the toolbar bot button from `Pilot` / `Pilot On` to `Codex` / `Stop`, and changed its idle title to `Watch Codex pilot`. This keeps the control compact and avoids a tutorial overlay, while making the Codex-watched play entry point explicit.
- Browser playtest evidence:
  - `output/web-game/civ-codex-toolbar-label-1/summary.json` shows idle button text `Codex`, no old `Start Codex pilot` button, active button text `Stop`, `possessed=axo-1`, and the pilot strip running after click.
  - `idle-codex-button.png` and `active-codex-button.png` were visually inspected; the bottom toolbar still fits, the task HUD remains readable, and the active pilot is clearly stoppable.
- Verification passed: `npm test -- civPilot.test.ts civStore.test.ts App.test.tsx` and `npm run build` (same large Civilization chunk warning).

Next TODO:
- Continue manual feel tuning only after longer hands-on play; current damping avoids both dead-stop movement and slippery uncontrolled swimming.
- If bridge task variants move the bridge object or use non-horizontal bridge shapes, replace the hard-coded three-tile bridge task footprint with task metadata from the backend.
- Consider a compact tool-mode hint for manual Mine/Build only if hands-on testing shows players are accidentally using the wrong tool; avoid adding generic instructional text.

2026-06-06 quick interaction input-buffer pass:
- Ran a manual bridge-task pickup pass in `output/web-game/civ-manual-bridge-tool-1/` and found a more basic control reliability gap: after clicking `Possess`, a quick Playwright `Space` press did not talk to the nearby NPC even though `render_game_to_text()` showed `Axolotl 2` in range. Movement still worked because directional keys were held across frames.
- Root cause: E/Space interaction was sampled only through per-frame `key.isDown`. A very quick tap could go down/up between frames and never set `justInteracted`, which is exactly the kind of frustrating missed input a human can feel during Use/Mine/Build.
- Added a short interaction input buffer for E/Space key-down events, resetting it on possession changes and consuming it through the existing interaction debounce. Pilot interaction commands still use their nonce path and are unchanged.
- Browser playtest evidence:
  - Fixed replay `output/web-game/civ-interact-buffer-1/summary.json` shows quick Space now talks to `Axolotl 2`, creates the `build_bridge` task, records `lastInteraction.kind=npc`, and shows task HUD text `Build through silt 0/3`.
  - `after-quick-space.png` was visually inspected; the bridge task strip and player feedback are visible immediately after the quick interaction.
- Verification passed: `npm test -- civPilot.test.ts civStore.test.ts App.test.tsx` and `npm run build` (same large Civilization chunk warning).

Next TODO:
- Re-run the manual bridge flow after the input buffer to check wrong-tool feedback near the bridge gap; the first pass stopped early because quick task pickup was unreliable.
- Continue manual feel tuning only after longer hands-on play; current damping avoids both dead-stop movement and slippery uncontrolled swimming.
- If bridge task variants move the bridge object or use non-horizontal bridge shapes, replace the hard-coded three-tile bridge task footprint with task metadata from the backend.

2026-06-06 manual bridge tool-flow pass:
- Re-ran the manual bridge flow after the quick-interaction buffer. `output/web-game/civ-manual-bridge-tool-2/` reproduced the remaining playability gap: after Axolotl 2 assigned `build_bridge`, the active tool stayed `Use`. At the bridge gap, the build targets were in reach but `Use` targeted a nearby stone resource, printed `Gathered stone for Axolotl 2 (1/3)`, and left the bridge task at `0/3`.
- Added task-aware manual tool sync. When a new open bridge task appears, the toolbar selects `Build`; when a new open rescue task appears, it selects `Mine`; ready/delivery/object tasks stay on `Use`. Codex pilot tool forcing remains separate.
- Adjusted resource feedback so harvesting stone during a bridge task no longer reports fake bridge-task progress.
- Browser playtest evidence:
  - Fixed replay `output/web-game/civ-manual-bridge-tool-3/after-task-pickup.json` shows the active tool immediately changed to `Build` after task pickup.
  - `after-space-at-bridge.json` shows one Space at the gap placed `tile:69,50`, moving the bridge task to `1/3` without manually clicking Build first.
  - `after-complete-bridge.json` shows the manual flow completed through the center and final bridge tiles with `player_task=null` and message `Built Bridge Gap for Axolotl 2.`
  - Screenshots `after-task-pickup.png`, `after-space-at-bridge.png`, and `after-complete-bridge.png` were visually inspected; the selected Build button, task HUD, placed bridge tiles, and completion strip are readable.
- Verification passed: `npm test -- civPilot.test.ts civStore.test.ts App.test.tsx` and `npm run build` (same large Civilization chunk warning).

Next TODO:
- Continue hands-on manual play around rescue/object tasks to confirm the same task-aware tool selection feels natural for Mine -> Use transitions.
- Continue manual feel tuning only after longer hands-on play; current damping avoids both dead-stop movement and slippery uncontrolled swimming.
- If bridge task variants move the bridge object or use non-horizontal bridge shapes, replace the hard-coded three-tile bridge task footprint with task metadata from the backend.

2026-06-06 manual rescue feedback pass:
- Replayed the manual rescue/object flow from a fresh preview state. `output/web-game/civ-manual-rescue-tool-1/` confirmed the task-aware tool selection worked end-to-end: talking to scout Axolotl 7 selected `Mine`, clearing all three rubble tiles switched the toolbar to `Use`, and pressing Space on `Trapped Juvenile` completed the rescue with `player_task=null` and spawned `rescued-trapped-1`.
- Found a smaller but real feedback gap in the same run: rescue rubble mining still displayed generic messages like `Mined earth for clay`, so the immediate action feedback did not tell the player they were progressing the rescue task.
- Updated terrain-mine feedback for the three actual rescue rubble tiles. The first two rubble clears now report `Cleared rescue rubble for Axolotl 7 (n/3)`, and the final tile says to use `Trapped Juvenile` to finish the rescue.
- Browser playtest evidence:
  - Fixed replay `output/web-game/civ-manual-rescue-tool-2/summary.json` shows mine messages `Cleared rescue rubble for Axolotl 7 (1/3)`, `(2/3)`, then `Cleared the last rubble near Trapped Juvenile. Use Trapped Juvenile to finish the rescue.`
  - The same summary shows the toolbar changing from `Mine` to `Use` at ready, `active_target.kind=object` for `trapped-1`, and final rescue completion with `trapped-1.activity=rescued` plus `rescued-trapped-1`.
  - Screenshots `after-mine-1.png`, `after-rubble-ready.png`, and `after-rescue-space.png` were visually inspected; the task HUD, feedback line, reticle, and rescued state are readable.
- Verification passed: `npm test -- civPilot.test.ts civStore.test.ts App.test.tsx` and `npm run build` (same large Civilization chunk warning).

Next TODO:
- Do a manual repair-object flow around the elder/Nest Breach task to verify gather -> Use repair feedback is as clear as bridge/rescue.
- Continue manual feel tuning only after longer hands-on play; current damping avoids both dead-stop movement and slippery uncontrolled swimming.
- If bridge task variants move the bridge object or use non-horizontal bridge shapes, replace the hard-coded three-tile bridge task footprint with task metadata from the backend.

2026-06-06 manual repair feedback pass:
- Replayed the manual elder/Nest Breach repair flow from a fresh preview state. `output/web-game/civ-manual-repair-tool-1/` showed the loop already functionally completed: talking to elder Axolotl 8 created a `repair_object` task, gathering 2 fiber made the task ready, using `Nest Breach` repaired `breach-1`, sealed `leak-1`, spent the 2 fiber, and cleared `player_task`.
- Found the same final-step feedback gap seen in rescue: after the second fiber pickup the HUD changed to `Seal Nest Leak`, but the immediate message only said `Gathered fiber for Axolotl 8 (2/2)` instead of pointing the player to the breach.
- Updated repair resource feedback so non-final fiber says `Gathered fiber for Nest Breach (1/2)` and the final pickup says `Patch ready for Nest Breach. Use Nest Breach to seal the leak.`
- Browser playtest evidence:
  - Fixed replay `output/web-game/civ-manual-repair-tool-2/summary.json` shows the final gather message, ready `active_target.kind=object` for `breach-1`, and final completion with `breach-1.activity=repaired`, `leak-1.activity=sealed`, `fiber=12`, and `clean_water=41`.
  - Screenshots `after-gather-1.png`, `at-breach-before-use.png`, and `after-repair-space.png` were visually inspected; the task HUD, repair prompt, reticle, and completed repair strip are readable.
- Verification passed: `npm test -- civPilot.test.ts civStore.test.ts App.test.tsx` and `npm run build` (same large Civilization chunk warning).

Next TODO:
- Run one longer free-play pass across fetch/trade/visit plus object tasks to look for any remaining task-message contradictions now that bridge, rescue, and repair have task-specific final-step feedback.
- Continue manual feel tuning only after longer hands-on play; current damping avoids both dead-stop movement and slippery uncontrolled swimming.
- If bridge task variants move the bridge object or use non-horizontal bridge shapes, replace the hard-coded three-tile bridge task footprint with task metadata from the backend.

2026-06-06 Codex watched-play input and trade feedback pass:
- Replayed the watched-play entry path and found a focus/input reliability issue: after clicking toolbar controls such as `Possess`, quick E/Space interactions could still be missed unless the canvas was clicked or the key was held across frames.
- Focus now returns to the Phaser canvas after possession, Codex pilot toggles, player selection, and manual tool changes. The canvas also listens for DOM-level E/Space keydown events while possessed, so quick interactions are buffered even after toolbar clicks.
- Replayed trade gathering and found the final pickup left the HUD ready but the immediate message still read like ordinary progress. Trade/fetch/repair resource feedback now gives ready-step instructions on the final required pickup, and ready resource tasks give a reminder instead of fake extra progress.
- Clamped resource-task progress in `activeCivPlayerTask()` so ready trade/fetch/repair tasks stay at the requested amount even if the player gathers more matching resources after the task is ready.
- Browser playtest evidence:
  - `output/web-game/civ-manual-trade-focus-feedback-1/after-possess-no-canvas-click.json` shows the canvas becomes the active element immediately after `Possess`.
  - `output/web-game/civ-space-buffer-trade-gather-1/after-quick-space-axo3-targeted.json` shows a quick Space interaction creates an NPC trade task without a manual canvas click.
  - `output/web-game/civ-trade-ready-feedback-1/summary.json` shows patched trade messages: `Gathered wood for Axolotl 5's trade (1/2).` followed by `Trade ready for Axolotl 5. Return to trade wood for tools.`
  - `output/web-game/civ-trade-ready-feedback-1/ready-after-patched-final-gather.png` was visually inspected; the ready trade HUD, bottom controls, possessed player, and terrain remain readable.
- Verification passed: `npm test -- civPilot.test.ts civStore.test.ts App.test.tsx`, `npm run build` (same large Civilization chunk warning), and `graphify update .`.

Next TODO:
- Do a focused return-to-NPC movement/pathing pass. During `output/web-game/civ-manual-visit-flow-1/`, the player got stuck around the resource shelf after completing a ready trade and could not reliably swim back up to the surface NPC.
- Finish a clean fetch/visit free-play pass after the return path is fixed, because those loops depend on returning to NPCs more than bridge/rescue/repair do.
- If bridge task variants move the bridge object or use non-horizontal bridge shapes, replace the hard-coded three-tile bridge task footprint with task metadata from the backend.

2026-06-06 Codex post-task safety/rally pass:
- Re-ran the known return-path area. The old `civ-manual-visit-flow-1` Axolotl 5 shelf artifact showed no movement during its cleanup loop, but the current trade replay did swim from the same wood shelf back to a surface NPC, so the old failure appears covered by the later focus/input fixes rather than a current terrain resolver stall.
- Verified visit pathing separately in `output/web-game/civ-visit-return-repro-1/`: Codex requested a visit task from Axolotl 4, reached Pond Heart, interacted, and completed in 13 steps with no browser errors.
- Tried `task-fetch`, but the current preview roster has no generic fetch NPC when Axolotl 1 is possessed, so the harness fell back to the nearest builder and completed another bridge task in `output/web-game/civ-fetch-return-repro-1/`.
- Found a real longer-run safety gap in `output/web-game/civ-return-path-repro-1/`: after completing a trade and continuing free-play, Codex wandered into the low-oxygen pocket and reached critical oxygen (`oxygen=0`/`3`) while patrolling lower terrain.
- Tightened pilot oxygen behavior in both the app pilot and `scripts/codex-play-civ.mjs`: retreat now starts while oxygen is still recoverable, and the retreat target moves up and away from the oxygen pocket instead of straight upward.
- Tightened post-task free-play behavior: after a task completes, Codex rallies/holds near the last NPC or nearby friends rather than returning to the lower Pond Heart and patrolling into hazardous terrain.
- Browser playtest evidence:
  - `output/web-game/civ-oxygen-retreat-fix-1/` shows the earlier oxygen fix prevented critical oxygen; minimum oxygen stayed at 74, but the run still oscillated between return-home and oxygen-retreat decisions.
  - `output/web-game/civ-task-rally-fix-1/` shows the final behavior: after trading with Axolotl 3, Codex held at tile `53,15` near the NPC for 23 post-completion steps, with oxygen stable at 100 and no browser errors.
  - `output/web-game/civ-task-rally-fix-1/codex-play-55.png` was visually inspected; the completed task HUD, surface NPC cluster, possessed player ring, and bottom controls are readable.
- Added `civPilot.test.ts` coverage for early low-oxygen retreat and task-complete friend rally behavior.
- Verification passed: `npm test -- civPilot.test.ts civStore.test.ts App.test.tsx`, `npm run build` (same large Civilization chunk warning), and `graphify update .`.
- Attempted the standard `develop-web-game` Playwright client, but the skill script's static `playwright` import cannot resolve `playwright-core` from the bundled runtime package layout. The temporary module junction created for that attempt was removed.

Next TODO:
- Add or expose a deterministic way to target a specific NPC in `scripts/codex-play-civ.mjs` so Axolotl 5 trade and any future deep-return tasks can be replayed directly instead of depending on nearest-NPC selection.
- Add at least one generic fetch requester to the preview roster or allow the harness to possess a different starting axolotl, then run a true fetch gather-and-return pass.
- Resolve the standard `develop-web-game` client dependency issue if that skill client remains mandatory for future game passes; the project harness currently provides stronger Civ-specific evidence.

2026-06-06 targeted requester/fetch coverage pass:
- Added deterministic watched-play harness controls:
  - `--possess <axo-id>` selects the playable axolotl through the existing Player drawer select.
  - `--requester <axo-id>` forces the pilot to ask that NPC for the next task instead of relying on nearest/special-role selection.
- Added `preferredRequesterId` support to the shared in-app pilot memory so the same target-id decision path is covered by unit tests.
- Replayed the previously missing fetch path with `possessId=axo-3` and `requesterId=axo-1`. Baseline `output/web-game/civ-targeted-fetch-1/` exposed a real range bug: Codex got within 17-20px of Axolotl 1 but kept issuing micro-moves instead of interacting, so no task was created after 70 steps.
- Fixed task-request interaction range from 18px to 34px for preferred/forced requester targets. Pilot interaction still carries the target id, so this does not fall back to the nearest wrong NPC.
- Added entity `name` to `window.render_game_to_text().visible_entities` and used it for generated target labels. Forced runs now say `request task from Axolotl 1` instead of `request task from worker`.
- Browser playtest evidence:
  - `output/web-game/civ-targeted-fetch-2/` completed a true fetch loop in 30 steps: possessed Axolotl 3 requested from Axolotl 1, gathered moss/food, returned to Axolotl 1, cleared `player_task`, and stayed at stable oxygen.
  - `output/web-game/civ-targeted-axo5-trade-1/` forced the old risky Axolotl 5 trade path directly and completed in 15 steps: gathered wood from the lower shelf, returned to Axolotl 5, cleared the task, and increased tools to 3.
  - `output/web-game/civ-targeted-fetch-label-1/` confirms the harness readout now uses the NPC display name.
  - Final screenshots `output/web-game/civ-targeted-fetch-2/codex-play-29.png` and `output/web-game/civ-targeted-axo5-trade-1/codex-play-14.png` were visually inspected; both show readable task-complete HUDs, visible possessed rings, and the player back near surface NPCs.
- Added `civPilot.test.ts` coverage for preferred requester targeting and the practical NPC request range.
- Verification passed: `npm test -- civPilot.test.ts civStore.test.ts App.test.tsx`, `npm run build` (same large Civilization chunk warning), and `graphify update .`.

Next TODO:
- Add a longer randomized watched-play matrix across forced fetch/trade/visit/repair/rescue/bridge runs and fail on non-completion, critical oxygen, or long no-progress loops.
- Consider surfacing the selected target/requester in the in-app Codex pilot UI only if watched runs still feel opaque; avoid adding tutorial text unless playtesting shows users need it.
- Resolve the standard `develop-web-game` client dependency issue if that skill client remains mandatory for future game passes; the project harness now covers Civ-specific state more thoroughly.

2026-06-06 in-app watched-play matrix pass:
- Added matrix-grade failure gates to `tauri-app/scripts/codex-play-civ.mjs`: `--fail-on-incomplete`, `--fail-on-critical-oxygen`, and `--max-no-progress`.
- Added `--in-app-pilot` plus a narrow `window.civPilotControls` app bridge so scripted watched runs can start the same target-aware Codex pilot exposed by the toolbar, including forced goal/requester/possessed axolotl. The old physical keyboard path remains available, but forced NPC task pickup now uses the in-app pilot path.
- Found and fixed a fetch visibility gap from `output/web-game/civ-matrix-fetch-1/`: task resources were filtered after the nearest-resource slice, so the requested moss could disappear from text state after the player drifted. Task resource options now scan all world tiles before slicing.
- Found and fixed rescue stalls:
  - `output/web-game/civ-matrix-rescue-4/` and `...-5/` showed Codex got the correct Axolotl 7 rescue task but hovered around `0/3`.
  - Root causes were open-rescue path blockers not being mined, and oxygen retreat preempting rescue at 100 oxygen just because the player entered the low-O2 pocket.
  - Open rescue now mines immediate path blockers before unreachable lower rubble, and oxygen retreat starts when oxygen actually drops into the warning band instead of on full-oxygen entry.
  - Pilot terrain-mine target resolution now checks the exact target tile before generic mine options, and pilot move arrival radius was widened to avoid overshooting interactable targets between pilot ticks.
- Found and fixed a bridge stall in `output/web-game/civ-matrix-bridge-2/`: after placing 2/3 tiles, the final tile was visible at distance 49 while bridge pilot reach was 48 and the newly placed bridge tile blocked moving closer. Bridge build-task reach is now 60px.
- Added `civPilot.test.ts` regressions for:
  - in-range forced rescue rubble mining,
  - full-oxygen low-O2 pocket rescue blocker mining,
  - final bridge tile build from an adjacent perch.
- In-app watched-play matrix evidence, all strict gates passed with no browser errors/failures:
  - Fetch: `output/web-game/civ-matrix-fetch-3/` completed in 6 samples.
  - Trade: `output/web-game/civ-matrix-trade-3/` completed in 7 samples.
  - Visit: `output/web-game/civ-matrix-visit-3/` completed in 4 samples.
  - Repair: `output/web-game/civ-matrix-repair-3/` completed in 6 samples.
  - Rescue: `output/web-game/civ-matrix-rescue-7/` completed in 16 samples.
  - Bridge: `output/web-game/civ-matrix-bridge-3/` completed in 5 samples.
  - Final screenshots from all six successful runs were visually inspected; task-complete HUDs, bottom controls, possessed rings, and world-state changes are readable.
- Verification passed: `npm test -- civPilot.test.ts civStore.test.ts App.test.tsx`, `npm run build` (same large Civilization chunk warning), and `graphify update .`.

Next TODO:
- Run a longer watched free-play patrol after a completed task to check that post-task rally still holds under the new in-app pilot matrix path.
- Consider whether `window.civPilotControls` should be documented as a dev/test hook for future Codex watched-play runs.
- Resolve the standard `develop-web-game` client dependency issue if future work requires that generic skill client; the Civ-specific harness is currently stronger for this game.

2026-06-06 long in-app post-task watched-play pass:
- Added a dev/test-only `continueAfterTask` option to `window.civPilotControls.start(...)` and threaded it through `tauri-app/scripts/codex-play-civ.mjs --in-app-pilot --continue-after-task`. Normal toolbar behavior still stops task goals after one completed task.
- Fixed in-app harness task-completion detection so asynchronous task clearing is counted exactly once even when the task disappears between samples.
- Ran the old risky Axolotl 5 trade path with in-app Codex continuing after completion. Evidence: `output/web-game/civ-post-task-rally-inapp-3/` completed the trade at step 6 and then held safely near Axolotl 5 through 64 samples. Oxygen stayed 100/stable throughout, no critical oxygen, no browser errors, final task `none`.
- Visual inspection: `output/web-game/civ-post-task-rally-inapp-3/codex-play-63.png` shows task-complete HUD, Codex pilot status `task done: hold position`, the possessed axolotl at the surface NPC cluster, and bottom controls still readable.
- Found and fixed a text-state consistency gap in the same run: `player.player.tile` was live at `56,13`, but `visible_entities` still reported the possessed axolotl from the last backend-sync tile. `render_game_to_text()` now overlays the live possessed-player tile/activity into `visible_entities` for that entity.
- Verification rerun: `output/web-game/civ-post-task-rally-inapp-4/` completed and held safely; final JSON shows `playerTile=56,13`, `entityTile=56,13`, oxygen `100/stable`, task `none`, last interaction `npc:axo-5`.
- Verification passed: `npm test -- civPilot.test.ts civStore.test.ts App.test.tsx`, `npm run build` (same large Civilization chunk warning), and `graphify update .`.

Next TODO:
- Consider documenting `window.civPilotControls` as a dev/test hook if future agents need repeatable watched-play runs.
- Add a longer multi-task autonomous mode only if the desired user-facing watch flow should keep accepting new NPC tasks instead of stopping after one task.
- Resolve the standard `develop-web-game` client dependency issue if future work requires that generic skill client; the Civ-specific harness remains stronger for this game.

2026-06-06 continuous watched-play loop pass:
- Added a user-facing Codex pilot `Loop` goal (`task-loop`) that keeps the possessed axolotl performing NPC tasks instead of stopping after the first completion. Normal one-task goals still stop after one task unless the dev harness passes `continueAfterTask`.
- Loop mode now briefly rallies near the last NPC/friends after a task completes, then rotates through visible adult axolotl requesters for the next task. This makes the watched flow feel like continuous play instead of a single scripted chore.
- Updated `tauri-app/scripts/codex-play-civ.mjs` to accept `task-loop`, keep loop goals running after completions, and return `completedCount` for multi-task evidence.
- Browser playtest evidence:
  - `output/web-game/civ-task-loop-inapp-1/` completed 7 tasks, then exposed a real gap: after rescuing the juvenile, Codex accepted a rescued-juvenile fetch task and stalled at tile `63,42` while pathing toward moss.
  - Fixed the stall by teaching fetch/trade gathering to mine a fresh movement blocker toward the target resource, reusing the path-blocker logic that had already stabilized rescue tasks.
  - `output/web-game/civ-task-loop-inapp-2/` ran visibly through 7 continuous tasks with no browser errors, no critical oxygen, and no no-progress failures.
  - `output/web-game/civ-task-loop-inapp-3/final.png` was visually inspected and shows the recovered former stall behavior: Codex status `mine path to moss`, tool `Mine`, target tile `63,43`, oxygen stable, and the rescued-juvenile fetch active.
- Added `civPilot.test.ts` regressions for loop post-task rally, loop requester rotation, and mining a fresh path blocker while gathering for a fetch task.
- Verification passed: `npm test -- civPilot.test.ts civStore.test.ts App.test.tsx`, `npm run build` (same large Civilization chunk warning), and `graphify update .`.

Next TODO:
- Add a faster deterministic resumed-state browser harness for late-loop scenarios. Full visible-loop setup now reaches rescued-juvenile follow-up tasks, but long runs can hit the Codex tool's 120s ceiling before completing the late fetch end-to-end.
- Consider shortening or tuning loop rally timing if watched play feels too idle between tasks; it is currently stable but conservative.
- Consider documenting `task-loop` and `window.civPilotControls.start({ goal: "task-loop" })` as the preferred way to let Codex play visibly for demos.

2026-06-06 continuous loop recovery pass:
- Tightened `task-loop` watched play after the previous long-run caveat:
  - Shortened the loop-only post-task rally from 6 pilot ticks to 3 so Codex spends less time idling between tasks. Single-task goals keep their safe post-completion behavior.
  - Added harness controls `sampleMs`, `stopAfterCompletions`, and throttled `screenshotEvery`, making long watched runs practical without per-sample screenshot overhead.
- Ran `output/web-game/civ-task-loop-inapp-5/` targeting 8 completions. This exposed a bad late-loop behavior: after rescue, the rescued juvenile became a task requester and sent Codex into a long food tunnel, mining unrelated terrain instead of maintaining good watch flow.
- Fixed loop requester eligibility:
  - Juveniles are skipped as autonomous `task-loop` requesters.
  - Completed one-shot requesters are skipped once their object job is done (`bridge` built, trapped juvenile rescued, breach repaired).
- Ran `output/web-game/civ-task-loop-inapp-6/` and `...-7/`. These avoided the juvenile tunnel, but exposed another gap: once all same-turn requesters were exhausted, Loop bounced between surface NPCs with no active task.
- Added an explicit `advance_turn` pilot decision. When Loop has tried every valid requester and no task appears, it now uses the existing visible Next Turn path instead of silently fabricating tasks or idling forever. The pilot readout labels this as a turn action.
- Browser playtest evidence:
  - `output/web-game/civ-task-loop-inapp-8/` completed 8 tasks in 224 samples with no browser errors, no playability failures, and oxygen stable. The final JSON shows `session.turn=4`, `player_task=null`, score improved to 67.2, and the player safely near Pond Heart.
  - `output/web-game/civ-task-loop-inapp-8/codex-play-220.png` was visually inspected; it shows the turn-4 check-Pond-Heart task in progress, readable HUD/status, possessed ring, and bottom controls.
- Added `civPilot.test.ts` coverage for:
  - skipping juveniles as loop requesters,
  - skipping completed one-shot object requesters,
  - rotating away from a just-tried requester that produced no task,
  - advancing the turn after all loop requesters are exhausted.
- Verification passed: `npm test -- civPilot.test.ts civStore.test.ts App.test.tsx`, `npm run build` (same large Civilization chunk warning), and `graphify update .`.

Next TODO:
- Add a small on-screen/history indication when Loop advances the turn, if watching the turn transition feels too subtle in longer demos.
- Consider a per-turn task variety policy so repeat loops intentionally alternate trade/visit/fetch instead of relying mostly on requester order.
- Continue playtesting manual possession controls after the autonomous loop work; the next likely gaps are human-feel issues rather than task completion logic.

2026-06-06 manual possession movement feel pass:
- Ran a visible manual-control trace as Codex possessed Axolotl 1 and drove the character with keyboard controls.
  - Baseline evidence: `tauri-app/output/web-game/civ-manual-controls-2/` showed possession, descent, grounded walking, dash, and `E` interaction all working, but the jump peaked at roughly two tiles and had already started falling by the first jump sample.
  - Tuned manual jump feel in `CivilizationGameCanvas.tsx`: stronger ground impulse, lower jump gravity, and a slightly stronger wall-kick vertical impulse.
  - Fixed evidence: `tauri-app/output/web-game/civ-manual-controls-3/` completed the same visible trace with no browser errors. The jump now reaches about five tiles over the terrain (`floor_y=744`, jump sample `y=659`, `locomotion=jump`), then lands cleanly back on the slope.
  - The same run confirmed terrain-following walk, dash cooldown, active target detection, and `E` harvesting still work after the movement tuning.
- Visual inspection: `tauri-app/output/web-game/civ-manual-controls-3/04-jump-early.png` shows the possessed axolotl clearly airborne over the camp terrain with readable HUD and bottom controls.
- Verification passed: `npm test -- civPilot.test.ts civStore.test.ts App.test.tsx`, `npm run build` (same large Civilization chunk warning), and `graphify update .`.

Next TODO:
- Run a targeted wall-slide/wall-jump playtest against a vertical blocker to make sure the new wall-kick impulse feels useful rather than decorative.
- Add a manual mine/build obstacle-flow trace so player possession covers the full Terraria-like loop, not just movement, dash, and harvesting.
- Consider a small watched-play affordance that makes it obvious when Codex is driving versus when the user is driving.

2026-06-06 manual build-chain playability pass:
- Ran a possessed-player toolbar trace for the manual mine/build loop. Evidence: `tauri-app/output/web-game/civ-manual-tooling-1/`.
  - Confirmed real toolbar controls work for possession, `Mine`, `Build`, and `Use`.
  - Mining a nearby wood vein through `E` updated `lastInteraction`, removed the mined tile from the target slot, and increased wood from 18 to 19.
  - Building on the newly opened pocket consumed stone from 11 to 10 and placed the tile, but the next build target went empty (`No buildable water in reach`). That made manual construction feel like a one-off action instead of a chainable Terraria-style tool.
- Fixed free-build targeting in `CivilizationGameCanvas.tsx` by adding above-facing fallback placement candidates after the existing below/same-level candidates. This preserves the first target but allows wall/vertical construction once the obvious nearby pocket is filled.
- Verification browser trace: `tauri-app/output/web-game/civ-manual-tooling-2/`.
  - First build still targets `tile:57,46` after mining, matching the previous intuitive pocket fill.
  - Second build now targets and places `tile:57,45` from the same perch, reducing stone from 10 to 9 and keeping the build reticle live on another valid tile afterward.
  - The same trace produced wall contact and solid-tile block feedback against the built stack, but the two-tile fixture was too low to prove a satisfying wall-slide/wall-jump loop.
- Visual inspection: `tauri-app/output/web-game/civ-manual-tooling-2/23-build2-after.png` shows the stacked build result and readable controls; `.../30-wall-rise.png` shows airborne contact near the built stack.
- Verification passed: `npm test -- civPilot.test.ts civStore.test.ts App.test.tsx`, `npm run build` (same large Civilization chunk warning), and `graphify update .`.

Next TODO:
- Build or find a taller vertical fixture for a true wall-slide/wall-jump trace; the current two-tile stack proves contact feedback, not wall-slide feel.
- Add a manual bridge-task trace where the player accepts/builds a bridge objective without Codex pilot assistance.
- Consider a keyboard shortcut for tool cycling if toolbar clicks feel too slow during possessed play.

2026-06-06 manual wall-slide/wall-kick playability pass:
- Ran a taller-wall baseline trace using only real possessed-player controls. Evidence: `tauri-app/output/web-game/civ-wall-build-baseline-1/`.
  - Repeated Build could create a partial wall, but the active target went empty after four placements even though `nearby_interactions` still exposed a valid build tile at distance 47.
  - The partial wall still let the jump crest past the blocker, so it did not prove wall-slide/wall-kick feel.
- Fixed the manual Build targeting:
  - Increased the free-build active radius so valid on-screen build targets do not disappear from the reticle while still visible nearby.
  - Reordered and extended facing-column upward candidates so repeated `E` builds a vertical wall first, then spreads horizontally.
- Verification traces:
  - `tauri-app/output/web-game/civ-wall-build-fixed-1/` proved repeated Build now places a vertical facing-column wall through `tile:57,42` before spreading.
  - `tauri-app/output/web-game/civ-wall-build-fixed-2/` proved the extended wall reaches `tile:57,41`, blocks the jump, and produces `locomotion=wall_slide` with fall speed capped at `1.35`.
  - `tauri-app/output/web-game/civ-wall-kick-fixed-1/` pressed jump during the slide window and proved wall-kick behavior: `locomotion=jump`, `velocity_x=-0.79`, `jump_velocity_y=-4.01`, and the player moved up/left away from the wall.
- Visual inspection: `civ-wall-kick-fixed-1/10-wall-built.png`, `20-slide-window.png`, and `21-kick-early.png` show the built wall, slide contact, and kick-away arc with readable HUD and controls.
- Verification passed: `npm test -- civPilot.test.ts civStore.test.ts App.test.tsx`, `npm run build` (same large Civilization chunk warning), and `graphify update .`.

Next TODO:
- Add a manual bridge-task trace where the player accepts/builds a bridge objective without Codex pilot assistance.
- Consider hotkeys for tool selection or cycling (`Use`/`Mine`/`Build`) so keyboard play does not require repeated toolbar clicks.
- Run a longer mixed manual session: talk to NPC, accept a task, mine/build/harvest, return, and advance turn without Codex pilot assistance.

2026-06-06 manual bridge-task playability pass:
- Ran a headed browser trace where Codex possessed Axolotl 1, talked to the builder NPC, manually moved to the bridge gap, and built the bridge objective with `E`. Baseline evidence: `tauri-app/output/web-game/civ-manual-bridge-baseline-1/`.
  - The actual task loop worked: the player accepted `build_bridge`, reached the bridge, placed all three required bridge tiles, and got the `TASK COMPLETE` feedback.
  - The gap was post-completion safety. Because the active tool stayed on Build, two extra `E` presses after completion placed unrelated stone tiles and dropped stone from 8 to 6.
- Fixed `CivilizationView.tsx` so completing the last required `build_bridge` placement immediately switches the possessed player back to `Use`.
- Verification browser trace: `tauri-app/output/web-game/civ-manual-bridge-fixed-1/`.
  - After the third bridge tile, the task cleared, the toolbar returned to `Use`, and the active target changed from `place_tile` to a nearby stone resource.
  - Two extra `E` presses no longer free-built or wasted stone; they harvested the targeted resource instead, moving stone from 8 to 10.
  - Visual inspection: `21-build-3-after.png` shows `TASK COMPLETE` with `Use` active; `21-build-5-after.png` shows repeated `E` resolving as normal stone gathering.
- Verification passed: `npm test -- civPilot.test.ts civStore.test.ts App.test.tsx`, `npm run build` (same large Civilization chunk warning), and `graphify update .`.

Next TODO:
- Add hotkeys or a tool-cycle shortcut for `Use`/`Mine`/`Build` so keyboard play does not depend on toolbar clicks between manual tasks.
- Run a longer mixed manual possession session: accept a task, mine/build/harvest, return to an NPC/object, and advance turn without Codex pilot assistance.
- Consider a small "Codex driving / Player driving" status affordance so watched sessions make control ownership obvious.

2026-06-06 manual tool-hotkey playability pass:
- Added possessed-player tool hotkeys: `1`/`U` for Use, `2`/`M` for Mine, and `3`/`B` for Build.
  - Hotkeys ignore text inputs/selects and modified shortcuts, require an active possessed axolotl, and stop the Codex pilot when the player switches tools manually.
  - Tool buttons now use the same manual-tool path, so mouse and keyboard switching have consistent pilot-stop/focus behavior.
  - `window.render_game_to_text()` now includes `player.player_tool`, making watched-play traces explicit about the selected tool.
- Verification browser trace: `tauri-app/output/web-game/civ-manual-tool-hotkeys-1/`.
  - From a grounded possessed state, `2` and `M` switched to Mine and produced an active `mine_tile` target.
  - `3` and `B` switched to Build and produced an active `place_tile` target.
  - `1` and `U` switched back to Use and produced a nearby resource target.
  - Visual inspection: `05-keyb-build.png` shows the Build slot active from keyboard input with a visible build reticle.
- Verification passed: `npm test -- civPilot.test.ts civStore.test.ts App.test.tsx`, `npm run build` (same large Civilization chunk warning), and `graphify update .`.

Next TODO:
- Run a longer mixed manual possession session: accept a task, switch tools with hotkeys, mine/build/harvest, return to an NPC/object, and advance turn without Codex pilot assistance.
- Add a small "Codex driving / Player driving" status affordance so watched sessions make control ownership obvious.
- Consider a tool-cycle key if `1`/`2`/`3` plus `U`/`M`/`B` still feels too keyboard-heavy during longer sessions.

2026-06-06 mixed manual repair-loop playability pass:
- Ran a headed mixed manual possession route without Codex pilot assistance. Baseline evidence: `tauri-app/output/web-game/civ-manual-mixed-repair-1/`.
  - Codex possessed Axolotl 1, approached Elder Axolotl 8, accepted a `repair_object` task, descended to the terrain, used hotkeys, mined repair fiber, built one tile, repaired Nest Breach, harvested post-repair fiber, and advanced from turn 3 to turn 4.
  - The loop completed, but it exposed a guidance gap: open repair tasks left the player in `Use`, so the first `E` near the work area used Reed Nest instead of helping gather the repair patch.
- Fixed repair-task guidance in `CivilizationView.tsx`:
  - Open `repair_object` tasks now auto-select `Mine`, matching the actual fiber-gathering action from moss terrain.
  - The task HUD action chip now says `Mine` for open repair work, then switches to `Seal`/`Use` when the patch is ready.
- Verification browser trace: `tauri-app/output/web-game/civ-manual-mixed-repair-fixed-1/`.
  - After elder talk, `player.player_tool=mine` and the HUD shows `GATHER LEAK PATCH FIBER` with a `Mine` chip.
  - At the fiber zone, `E` directly mined moss into fiber without needing a manual `M` correction.
  - After two mines, the task switched to ready and `player.player_tool=use`; the player repaired Nest Breach, harvested a nearby fiber resource, and advanced the turn.
  - Visual inspection: `12-talk-elder-after.png`, `23-auto-mine-fiber-2-after.png`, and `32-repair-breach-after.png` show the tool guidance, ready-state switch, and task completion clearly.
- Verification passed: `npm test -- civPilot.test.ts civStore.test.ts App.test.tsx`, `npm run build` (same large Civilization chunk warning), and `graphify update .`.
- Caveat: the stock `develop-web-game` Playwright client still cannot resolve its ESM `playwright` import from `C:\Users\zazuk\.codex\skills\develop-web-game\scripts\web_game_playwright_client.js`; the richer headed Playwright route used the bundled Codex runtime directly and had no console/page errors.

Next TODO:
- Run the equivalent mixed manual route for the scout rescue task, especially oxygen drain/recovery and ready-state transition from Mine to Use.
- Add a small "Codex driving / Player driving" status affordance so watched sessions make control ownership obvious.
- Consider a tool-cycle key if longer sessions still feel keyboard-heavy.

2026-06-06 mixed manual rescue-loop playability pass:
- Ran headed manual scout-rescue attempts without Codex pilot assistance. Baseline evidence:
  - `tauri-app/output/web-game/civ-manual-mixed-rescue-1/` exposed that coarse swimming could overshoot the scout in a clustered NPC group.
  - `tauri-app/output/web-game/civ-manual-mixed-rescue-2/` reached Scout Axolotl 7 and accepted `rescue_object`, but stalled at the rescue ledge: the HUD said 0/3 low-O2 rubble, while the active Mine target fell back to generic moss above the trapped juvenile.
- Fixed rescue task geometry and targeting:
  - Rescue rubble now includes the vertical shaft above the trapped juvenile plus the final bottom blocker, in Rust, browser preview, HUD task parsing, canvas reticle targeting, and rescue progress messaging.
  - Rescue-specific Mine reach is wider than normal mining reach so the last marked bottom tile remains targetable from the shaft ledge.
- Verification browser trace: `tauri-app/output/web-game/civ-manual-mixed-rescue-fixed-2/`.
  - After scout talk, the task reports 0/8, Mine is active, and the reticle targets the top rescue shaft tile instead of unrelated moss.
  - Eight directed `E` mines advanced rescue progress from 0/8 to 8/8, then the task switched to ready and the tool switched to Use.
  - The player dropped into the low-oxygen pocket, rescued Trapped Juvenile, task cleared, health/morale improved, and oxygen recovered to stable.
  - Visual inspection: `21-at-rescue-column.png`, `22-mine-rescue-8-after.png`, and `25-rescue-juvenile-after.png` show the shaft guidance, ready-state switch, and completion clearly.
- Verification passed: `npm test -- civPilot.test.ts civStore.test.ts App.test.tsx`, `cargo check` (existing unused `TauriPermissionPrompter` warning), `npm run build` (same large Civilization chunk warning), and `graphify update .`.

Next TODO:
- Add a small "Codex driving / Player driving" status affordance so watched sessions make control ownership obvious.
- Consider a target-cycle/lock affordance for crowded NPC clusters; the rescue route was achievable with careful steering, but scout selection is still less forgiving than object/task interactions.
- Consider reducing rescue shaft count or adding a per-mine sound/particle beat if eight rescue mines feels too long in longer watched sessions.

2026-06-06 control-state watched-play affordance pass:
- Added a compact top-left HUD control strip so watched play makes control ownership explicit.
  - Manual possession now shows `Axolotl N driving` plus the current tool (`Use`, `Mine`, or `Build`).
  - Codex pilot mode now shows `Codex driving` plus the live pilot status, such as `reach Bridge Gap`.
- Verification browser trace: `tauri-app/output/web-game/civ-control-state-strip-1/`.
  - `01-manual-build.png` shows manual possession with the Build tool active and the strip clear of the toolbar and playfield.
  - `02-codex-driving.png` shows Codex pilot state while a bridge task is active, with the same HUD slot switching to pilot status.
- Verification passed: `npm test -- civPilot.test.ts civStore.test.ts App.test.tsx` and `npm run build` (same large Civilization chunk warning).

Next TODO:
- Consider a target-cycle/lock affordance for crowded NPC clusters; scout selection remains the weakest interaction edge from the manual rescue route.
- Consider reducing rescue shaft count or adding a per-mine sound/particle beat if eight rescue mines feels too long in longer watched sessions.
- Run a longer watched Codex/manual handoff session to confirm the control strip stays clear and useful across repeated pilot start/stop transitions.

2026-06-06 target-cycle crowded-NPC playability pass:
- Added manual target cycling for possessed play.
  - Pressing `Tab` now cycles and locks reachable interaction targets; `Shift+Tab` cycles backward.
  - Locked targets are exposed through `player.active_target.locked`, `cycle_index`, `cycle_count`, and `player.target_lock` in `window.render_game_to_text()`.
  - Locked targets get an extra white reticle ring/marker so watched play can tell the player intentionally selected a non-nearest target.
  - The lock clears when possession/tool state changes, Codex pilot takes over, or the player interacts, so task flow falls back to normal priority after the selected interaction.
- Handoff playtest exposed and fixed a short-lived regression where the lock could remain visible for one pilot tick after Codex started but before the first command was emitted.
  - Added an explicit `pilotActive` bridge from `CivilizationView` to the Phaser scene so the lock clears immediately when Codex control starts.
- Verification browser trace: `tauri-app/output/web-game/civ-target-cycle-lock-1/`.
  - Before cycling, five NPCs were nearby and the nearest active target was Axolotl 2.
  - One `Tab` locked Axolotl 3 at distance 71 (`cycle_index=2`, `cycle_count=2`) with the new visible selection ring.
  - Pressing `E` interacted with Axolotl 3, not the nearest Axolotl 2, and created Axolotl 3's trade request.
  - Visual inspection: `01-before-cycle.png`, `02-locked-npc.png`, and `03-after-interact.png` show the before state, locked reticle, and resulting task/message.
- Verification handoff trace: `tauri-app/output/web-game/civ-target-cycle-handoff-fixed-1/`.
  - A manual target lock was active before starting Codex.
  - After starting Codex, `player.target_lock` cleared immediately and remained null through all pilot samples.
  - Codex gathered wood, returned to Axolotl 3, and completed the trade task.
  - Visual inspection: `02-lock-before-pilot.png`, `03-after-codex-start.png`, and `04-final.png` show lock-before-pilot, Codex takeover without the lock ring, and task completion.
- Verification passed: `npm test -- civPilot.test.ts civStore.test.ts App.test.tsx` and `npm run build` (same large Civilization chunk warning).
- Caveat: the stock `develop-web-game` client still fails to resolve its ESM `playwright` import from the skill directory; the headed trace used the bundled Codex runtime directly and reported no console/page errors.

Next TODO:
- Run a longer watched Codex/manual handoff session to confirm target locks clear cleanly across repeated pilot start/stop transitions.
- Consider reducing rescue shaft count or adding a per-mine sound/particle beat if eight rescue mines feels too long in longer watched sessions.
- Consider a small HUD echo for the currently locked target if screenshot-only reticle feedback is still too subtle at low zoom.

2026-06-06 shortened rescue-loop playability pass:
- Reduced rescue task friction by shortening the rubble shaft from 8 required mines to 5 required mines while preserving the vertical shaft plus final blocker shape.
  - Updated the shared rescue rubble geometry in Rust, browser preview, task parsing, Phaser targeting, and Civ view task validation.
  - The rescue HUD now starts at 0/5 instead of 0/8, keeping the oxygen-pocket risk but removing three repetitive mine presses.
- Browser playtest exposed a real follow-up bug after the shortening:
  - The in-app Codex pilot still recognized only the older bottom rescue tiles, so after two mines it stopped treating the remaining upper shaft as rescue rubble and drifted between `Use` and oxygen retreat.
  - Fixed `civPilot.ts` with a matching five-tile rescue-rubble key set and added a regression test for the shortened upper shaft.
- Tightened the last-rubble transition:
  - When the fifth rescue rubble tile clears, the player tool now switches immediately to `Use`.
  - In Codex pilot mode, the watched-play status switches immediately from mining to `rescue Trapped Juvenile`, avoiding a stale one-tick "mine rescue rubble" readout.
- Verification browser trace: `tauri-app/output/web-game/civ-rescue-shortened-pilot-final-2/`.
  - `01-rescue-requested.png` shows the task at 0/5 with a Mine chip.
  - `02-ready-use.png` shows 5/5 ready state, `Use` active, and Codex status `rescue Trapped Juvenile`.
  - `03-rescued-final.png` shows `TASK COMPLETE`, the rescued object state, and the spawned rescued juvenile.
  - `summary.json` reports `passed=true`, amount 5, ready tool `use`, and trapped activity `rescued`.
- Verification passed: `npm test -- civPilot.test.ts civStore.test.ts App.test.tsx`, `npm run build` (same large Civilization chunk warning), and `cargo check` (existing unused `TauriPermissionPrompter` warning).
- Caveat: the stock `develop-web-game` client still fails before opening the app because its skill script cannot resolve the ESM `playwright` import. The headed browser trace used the bundled Codex runtime directly and reported no console/page errors.

Next TODO:
- Run a longer mixed watched session that chains target cycling, rescue, handoff to Codex, task completion, and a turn advance in one route.
- Consider adding a small sound/particle beat for each rescue mine if the five-step loop still feels under-communicated during manual play.
- Start a pass on save/reload persistence for possessed-player position/task state if session continuity becomes the next MVP blocker.

2026-06-06 combined watched rescue/handoff playability pass:
- Ran a headed browser route so the user can watch Codex play through a full possession/control handoff session. Evidence:
  - `tauri-app/output/web-game/civ-combined-manual-codex-rescue-fixed-1/` passed the unpatched route after tightening the automation movement check.
  - `tauri-app/output/web-game/civ-combined-textsplit-1/` passed after the text-state fix below.
- Route covered: possess Axolotl 1, swim to the crowded scout group, `Tab`-lock Scout Axolotl 7, accept the rescue task with `E`, create a manual target lock, start Codex rescue pilot, verify the manual lock clears immediately, mine the 5 rescue rubble tiles, switch to `Use`, rescue Trapped Juvenile, and advance from turn 3 to turn 4.
- Fixed a Codex/playability text-state gap discovered during the route:
  - `nearby_interactions` used to mix actual local targets with long-range task/resource hints, which could mislead text-driven play into thinking distant targets were actionable.
  - `CivilizationGameCanvas.tsx` now keeps `nearby_interactions` local and exposes long-range task guidance separately as `task_interactions`.
  - `civPilot.ts` now folds `task_interactions` into decisions only when solving an active task, so task rescue/fetch/build routing still works without corrupting the local target list.
- Visual inspection passed for:
  - `03-scout-locked.png`: Scout Axolotl 7 is selected with the lock ring in the crowded NPC cluster.
  - `04-rescue-task-created.png`: rescue task appears at 0/5 with Mine active.
  - `07-rescue-ready-use.png`: rescue task reaches 5/5 and switches to Use.
  - `09-turn-advanced.png`: Task Complete is visible and the session advances to turn 4.
- Verification passed: `npm test -- civPilot.test.ts civStore.test.ts App.test.tsx` and `npm run build` (same large Civilization chunk warning).

Next TODO:
- Add a small sound/particle beat for each rescue mine if the five-step loop still feels under-communicated during manual play.
- Start a pass on save/reload persistence for possessed-player position/task state if session continuity becomes the next MVP blocker.
- Consider adding a recorded/demo mode that leaves the headed browser open longer or loops Codex tasks for easier live watching.

2026-06-06 longer Codex loop and interaction-feedback pass:
- Ran a headed `task-loop` watched session to see whether Codex can perform repeatedly instead of only completing a single rescue handoff. Evidence: `tauri-app/output/web-game/civ-task-loop-watch-1/`.
  - The loop saw 9 distinct task identities and 8 task-completion transitions with no console/page errors.
  - Covered bridge building, building visit, multiple trades, scout rescue, elder repair, an automatic turn advance to turn 4, and another trade request after the turn changed.
  - Visual inspection of `01-loop-started.png`, `sample-06.png`, `sample-12.png`, `sample-18.png`, `sample-24.png`, and `99-final.png` showed the control strip, task cards, reticles, and Codex readout remaining coherent through the repeated flow.
  - The earlier `nearby_interactions` split held up in the longer trace: sampled local targets stayed bounded (`maxNearbyDistance=116`) while active-task routing still worked through `task_interactions`.
- Fixed the remaining under-communicated repeated-action feel:
  - `CivilizationGameCanvas.tsx` now emits distinct interaction feedback bursts for mine, build, repair, rescue, resource, NPC, building, object, and empty interactions.
  - The rescue/mine beat uses small tile-local debris particles plus the existing pulse ring, so each rubble clear reads as an action without requiring new assets.
  - Resource feedback is color-coded by resource family, so gathering reads differently from mining rubble or repairing objects.
- Verification browser trace: `tauri-app/output/web-game/civ-interaction-feedback-1/`.
  - Captured the rescue request interaction plus four mine/path interactions immediately after the action frames.
  - Visual inspection of `02-interaction-mine_tile_tile_63_46_63_46.png`, `03-interaction-mine_tile_tile_63_44_63_44.png`, and `04-interaction-mine_tile_tile_63_47_63_47.png` confirmed the new tile-local particle beats are visible and do not overpower the HUD/reticle.
- Verification passed: `npm test -- civPilot.test.ts civStore.test.ts App.test.tsx` and `npm run build` (same large Civilization chunk warning).

Next TODO:
- Start a pass on save/reload persistence for possessed-player position/task state if session continuity becomes the next MVP blocker.
- Add a dedicated "watch demo" route or script that leaves a headed browser open and runs `task-loop` without needing ad hoc Playwright commands.
- Consider a small completion audit for MVP readiness across persistence, task variety, controls, and fail states before marking the broader playability goal done.

2026-06-06 watched-demo command pass:
- Added a reusable npm command for the user's "watch Codex play" workflow:
  - `npm run civ:watch-demo`
  - Defaults to a headed in-app Codex `task-loop`, writes artifacts under `tauri-app/output/web-game/civ-watch-demo/`, stops after 5 task completions, watches for critical oxygen/no-progress failures, and keeps the browser open for 30 seconds so the run is visible.
  - Arguments can override the defaults, for example `npm run civ:watch-demo -- --steps 18 --keep-open 0 --stop-after-completions 2`.
- Hardened `tauri-app/scripts/codex-play-civ.mjs` so it no longer fails when app-local `playwright` is absent:
  - It still tries normal `import("playwright")` first.
  - It now falls back to `PLAYWRIGHT_MODULE_PATH`, `CODEX_PLAYWRIGHT_MODULE`, or the bundled Codex runtime under `~/.cache/codex-runtimes/.../.pnpm/playwright@*/node_modules/playwright/index.js`.
  - It normalizes CommonJS/default exports so `chromium.launch()` works from both import paths.
- Improved the demo artifacts:
  - The script now writes `summary.json` plus `codex-play-final.png` whenever `--screenshot-dir` is set.
  - Summary includes URL, goal, in-app pilot flag, steps requested/run, completion count, errors, failures, and final `render_game_to_text()` state.
- Verification browser trace: `tauri-app/output/web-game/civ-watch-demo-smoke/`.
  - Ran the real npm command with shortened overrides.
  - Completed 2 tasks in 13 sampled steps: Bridge Gap build and Pond Heart visit.
  - `summary.json` reports `completedCount=2`, no errors, no failures, final task cleared, oxygen stable.
  - Visual inspection of `codex-play-00.png`, `codex-play-06.png`, and `codex-play-final.png` showed the headed watch view, Codex status/readout, task card, and completion cards rendering correctly.
- Verification passed: `node --check scripts/codex-play-civ.mjs`, `npm test -- civPilot.test.ts civStore.test.ts App.test.tsx`, and `npm run build` (same large Civilization chunk warning).

Next TODO:
- Start a pass on save/reload persistence for possessed-player position/task state if session continuity becomes the next MVP blocker.
- Run a focused fail-state audit: oxygen critical behavior, no-progress detection, impossible task exhaustion, and whether the game communicates recovery clearly.
- Consider a small completion audit for MVP readiness across persistence, task variety, controls, and fail states before marking the broader playability goal done.

2026-06-06 reload-continuity playability pass:
- Baseline trace `tauri-app/output/web-game/civ-reload-continuity-baseline-1/` found a real watchability gap:
  - Before reload: Codex possessed `axo-1`, had created a Bridge Gap task, and the live player was at tile `56,25`.
  - After reload: possession was null, the active task was gone, and `axo-1` reset to the seed position `48,12`.
- Fixed browser-preview session continuity:
  - `civStore.ts` now persists the normalized browser-preview civ snapshot under `xolotl-preview-civ-store-snapshot-v1` and prefers it over the seeded preview load when it is newer.
  - `tauriBrowserFallback.ts` now hydrates its in-memory preview session from that store snapshot before civ commands, so the first command after reload does not wipe restored task/world progress.
  - `CivilizationView.tsx` now persists per-session possessed axolotl, player tool, pilot goal, Codex/manual mode, and the latest live player tile.
  - On browser-preview reload, the view restores the possessed axolotl's live tile into the snapshot before resuming Codex, avoiding the visible rollback from the last stale backend move.
  - Player movement saves now keep the latest queued movement while a previous movement save is pending.
  - `render_game_to_text()` now exposes `control_mode` and `pilot_active` so reload/watch scripts can audit whether Codex or manual control is active.
- Verification browser traces:
  - `tauri-app/output/web-game/civ-reload-continuity-fixed-3/` passed. It cleared all preview storage keys, started Codex `task-loop`, reloaded, restored `axo-1`, resumed Codex mode, retained the stored preview snapshot (`~756k`), and avoided the earlier seed-position reset.
  - `tauri-app/output/web-game/civ-reload-active-task-fixed-1/` passed. It stopped Codex with an active Bridge Gap task open, reloaded, and restored possession plus the same open task/progress.
  - Visual inspection passed for `civ-reload-continuity-fixed-3/04-after-reload.png`, `civ-reload-continuity-fixed-3/05-after-resume.png`, and `civ-reload-active-task-fixed-1/03-after-reload-task-open.png`.
- Verification passed: `npm test -- civPilot.test.ts civStore.test.ts App.test.tsx`, `node --check scripts/codex-play-civ.mjs`, `npm run build` (same large Civilization chunk warning), and `graphify update .`.

Next TODO:
- Run a focused fail-state audit: oxygen critical behavior, no-progress detection, impossible task exhaustion, and whether recovery is clear to the player.
- Consider a small completion audit for MVP readiness across persistence, task variety, controls, and fail states before marking the broader playability goal done.

2026-06-06 fail-state/watchability audit:
- Ran focused oxygen rescue route with failure checks:
  - Command: `node scripts/codex-play-civ.mjs --in-app-pilot --goal task-rescue --steps 55 --headless --sample-ms 760 --screenshot-dir output/web-game/civ-oxygen-rescue-audit-1 --screenshot-every 5 --fail-on-critical-oxygen --max-no-progress 14 --fail-on-incomplete`
  - Result: passed. The rescue completed at step 20 with no critical oxygen failure and no no-progress failure.
  - Visual inspection of `codex-play-05.png`, `codex-play-10.png`, `codex-play-15.png`, and `codex-play-final.png` showed the low-oxygen pocket ring, player oxygen meter, task-card retreat copy, Codex status, and rescue completion all visible.
- Re-ran the reusable headed watch command after the reload-continuity changes:
  - Command: `npm run civ:watch-demo -- --steps 18 --keep-open 0 --stop-after-completions 2 --screenshot-dir output/web-game/civ-watch-demo-after-continuity --screenshot-every 6`
  - Result: passed. Codex completed Bridge Gap and Pond Heart in 12 sampled steps with no oxygen/no-progress failures.
  - Visual inspection of `output/web-game/civ-watch-demo-after-continuity/codex-play-final.png` showed a coherent watch state with task completion, Codex readout, reticle, and controls visible.

Remaining MVP audit items:
- Do a final compact MVP readiness pass across task variety, controls, persistence, fail-state communication, and whether the current demo command is enough for a live user-watched run.
- Native Tauri save/reload should get a quick smoke separately if the next session runs inside the actual desktop shell rather than browser preview.

2026-06-08 human economy/shop and asset-line correction pass:
- Reverted the rejected cyber/chrome/volt/nebula asset additions and returned the game to the README/screenshot graphic line:
  - `tauri-app/public/civ/axolotls/` is back to the 12 existing chibi/painterly morph portraits.
  - `tauri-app/public/civ/axolotl-animated-seeds.png` and `output/civ-gen/gen_axolotls.py` are back to the 12-variant sheet/generator.
  - No new pearl icon sheet is used; pearls currently reuse the existing glowshard visual in-game to avoid introducing a mismatched asset.
- Added the first real human economy/shop loop:
  - `pearls` are now the player currency.
  - Manual harvest, mining, task completion, and building use reward pearls.
  - The shop can buy Supply Cache, Pond Blessing, Rare Lure, Common Egg, Rare Egg, Farm Kit, Storage Kit, and Workshop Kit.
  - Purchases spend pearls and mutate the backend/browser-preview world/resources instead of being free prototype buttons.
- Added more human-playable feedback around the economy:
  - HUD shows Pearls.
  - Shop lives in the left game drawer and in God mode.
  - Admin console supports `/buy <item>`.
  - Manual gather/mine/build/use interactions have visible cooldown readouts and alerts, while Codex pilot remains ungated for automation tests.
- Found and fixed a browser-preview sync bug:
  - Fallback interventions updated legacy `civilization.resources`, but the frontend prefers `civs[0].resources` when both shapes are present.
  - `tauriBrowserFallback.ts` now syncs the primary civ before persisting/returning preview snapshots, so shop, harvest, mine, task, and building rewards all update visible UI/text state after reload-continuity hydration.
- Fixed a drawer usability/accessibility gap found during Playwright smoke:
  - Closed Civ drawers are now `inert`, `aria-hidden`, transparent, and pointer-events disabled, so hidden/offscreen shop buttons cannot intercept automation or focus.
- Browser playtest evidence:
  - `tauri-app/output/web-game/civ-economy-shop-purchase-fixed/01-shop-open.png`
  - `tauri-app/output/web-game/civ-economy-shop-purchase-fixed/02-supply-cache-bought.png`
  - `summary.json` shows Supply Cache changed resources from `pearls=6, wood=18, stone=11, clay=8, fiber=12` to `pearls=0, wood=26, stone=19, clay=16, fiber=20`, with no missing morph-frame warnings and no console errors.
- Verification passed:
  - `npm test -- CivilizationView.test.tsx civCanvas.test.ts civStore.test.ts` (59 tests)
  - `npm run build` (same large Civilization chunk warning)
  - `cargo check` (existing `TauriPermissionPrompter` dead-code warning)
  - `cargo test shop_purchase --no-run` (compiled test binaries; still avoid executing Rust test binaries on Windows due the known Tauri `STATUS_ENTRYPOINT_NOT_FOUND` issue)
- Official `develop-web-game` client is still blocked in this shell because its ESM script cannot resolve the bundled `playwright` package from the skill directory. Targeted Playwright smokes used the bundled Codex runtime package path directly.

Next TODO:
- Generate any new axolotl/egg/civ-level assets only in the README/screenshot chibi/painterly style, not the rejected cyber/pixel look.
- Add a proper hatchery/rarity screen and egg lifecycle UI now that shop eggs can be bought.
- Expand economy loops beyond the first pearl rewards: richer world drops, rare-object discovery, and cooldown/timer tuning for human play.
- Consider surfacing the shop as a dedicated game HUD panel in Play mode, not only inside the drawer/God panels.

2026-06-08 hatchery rarity/level UI pass:
- Added shared creature progression helpers in `tauri-app/src/lib/civCreatureProgression.ts`:
  - Classifies restored 12-line morphs as common, uncommon, rare, or mythic.
  - Computes axolotl/egg level, gene potential, hatch turns remaining, and hatch progress.
  - Falls back unknown morph assets to `leucistic`, so rejected/missing morph names do not request missing portrait files.
- Added a proper Hatchery panel to the Play-accessible left drawer and observer/admin drawer:
  - Shows egg count, living rarity counts, Common Egg/Rare Egg purchase buttons, egg cards, rarity pills, predicted level, gene potential, morph/pattern, hatch timer, source, and progress bar.
  - Uses only the restored existing egg/axolotl assets; no new off-style generated assets were introduced.
- Upgraded the colony roster so living axolotls show rarity and level alongside morph/stage/age.
- Extended `window.render_game_to_text()` with:
  - `hatchery.eggs[]` carrying rarity, rarity label, level, gene potential, hatch timer/progress, source, and tile.
  - creature-only progression fields on `visible_entities` for axolotls/eggs.
- Browser playtest evidence:
  - `tauri-app/output/web-game/civ-hatchery-rarity-smoke/01-hatchery-open.png`
  - `tauri-app/output/web-game/civ-hatchery-rarity-smoke/02-common-egg-bought.png`
  - `summary.json` shows the hatchery exposed a mythic egg, admin-granted pearls, bought a Common Egg through the Hatchery, increased eggs from 1 to 2, and spent pearls to 24 with no console errors or missing morph-frame warnings.
- Verification passed:
  - `npm test -- civCreatureProgression.test.ts CivilizationView.test.tsx civCanvas.test.ts civStore.test.ts` (63 tests)
  - `npm run build` (same large Civilization chunk warning)
  - Strict rejected-asset grep found no cyber/chrome/volt/nebula asset references.

Next TODO:
- Add actual hatch interaction/accelerator gameplay, such as spending pearls or food to reduce `hatches_in`, so timers are not only turn-driven.
- Add a style-correct generated egg/rarity/civ-level asset set if the next step needs new visuals.
- Add richer world currency drops and rare-object discovery so human players can earn egg purchases without admin grants.

2026-06-08 egg incubation action pass:
- Added a real manual hatchery accelerator:
  - Hatchery egg cards now include a Warm action with flame/pearl/food controls.
  - Warming an egg costs 4 pearls and 2 food, reduces `hatches_in` by 1, and disables once the egg is ready for the next turn.
  - Admin console now supports `/warm` or `/incubate`, defaulting to the first warmable egg or targeting by id/name.
- Added backend/browser-preview parity:
  - Rust `incubate_egg` validates ownership, egg readiness, pearls, and food before mutating the timer and logging the action.
  - Browser preview applies the same resource cost/timer mutation for local playtests.
- Extended text-state parity:
  - `window.render_game_to_text().hatchery.eggs[]` now includes `incubation_cost` and `can_incubate`, matching the UI button state.
- Browser playtest evidence:
  - `tauri-app/output/web-game/civ-egg-incubation-smoke/01-hatchery-before.png`
  - `tauri-app/output/web-game/civ-egg-incubation-smoke/02-incubated.png`
  - `summary.json` shows `hatches_in` 2 -> 1, pearls 6 -> 2, food 45 -> 43, and the Warm button disabled afterward with no console/page errors.
- Verification passed:
  - `npm test -- civCreatureProgression.test.ts CivilizationView.test.tsx civCanvas.test.ts civStore.test.ts` (63 tests)
  - `npm run build` (same large Civilization chunk warning)
  - `cargo check` (existing `TauriPermissionPrompter` dead-code warning)
  - `cargo test incubate_egg --no-run` (compiled test binaries; still avoid executing Rust test binaries on Windows due the known Tauri `STATUS_ENTRYPOINT_NOT_FOUND` issue)
  - Strict rejected-asset grep found no cyber/chrome/volt/nebula asset references.
- Official `develop-web-game` client remains blocked in this shell because its ESM script cannot resolve `playwright`; the smoke used the bundled Codex Playwright runtime directly.

Next TODO:
- Add visible hatch completion feedback and a first-hatchling tutorial beat so warming eggs feels like a complete loop.
- Add richer world currency drops and rare-object discovery, including rare object alerts that connect directly to shop/egg goals.
- Generate any new egg/rarity/civ-level assets only in the README/screenshot chibi/painterly style.

2026-06-08 hatch completion feedback pass:
- Closed the warm-egg payoff loop in browser preview:
  - Preview turn advancement now hatches ready eggs into hatchlings, updates population, and writes the same `Eggs hatched` lifecycle log shape as the Rust backend.
  - Hatchlings keep the same entity id, switch to `kind=axolotl`, `stage=hatchling`, `role=juvenile`, `activity=play`, and show up immediately in the world after the next turn.
- Added visible hatch feedback:
  - `CivilizationView` watches for new `Eggs hatched` logs in the active session and raises a world alert/player message.
  - The watcher seeds itself on session load so old saved hatch logs do not replay as fresh alerts.
- Extended `window.render_game_to_text().hatchery` with `recent_hatch` for automation-friendly hatch verification.
- Browser playtest evidence:
  - `tauri-app/output/web-game/civ-hatch-feedback-smoke/01-ready-next-turn.png`
  - `tauri-app/output/web-game/civ-hatch-feedback-smoke/02-hatch-alert.png`
  - `summary.json` shows turn 3 -> 4, eggs 1 -> 0, population 8 -> 9, `egg-preview-1` becoming `stage=hatchling`, and `recent_hatch.turn=4`, with no console/page errors.
- Verification passed:
  - `npm test -- civCreatureProgression.test.ts CivilizationView.test.tsx civCanvas.test.ts civStore.test.ts` (63 tests)
  - `npm run build` (same large Civilization chunk warning)
  - Strict rejected-asset grep found no cyber/chrome/volt/nebula asset references.
- Official `develop-web-game` client still cannot resolve `playwright` from the skill script; bundled Playwright smoke was used for the actual browser interaction.

Next TODO:
- Add richer world currency drops and rare-object discovery, including rare object alerts that connect directly to shop/egg goals.
- Add a first-hatchling interaction/tutorial beat, such as feeding or assigning the hatchling, so hatching creates a new manual choice.
- Generate any new egg/rarity/civ-level assets only in the README/screenshot chibi/painterly style.

2026-06-08 rare discovery economy pass:
- Added deterministic rare-find rewards to manual world interaction:
  - Harvesting or mining `glowshards`/`amber` now always discovers a Prismatic Pearl Cache for +4 extra pearls.
  - Harvesting or mining `ore`/`sulfur`/`coral` now discovers an Ancient Shell Cache for +2 extra pearls.
  - Common one-unit harvest/mine actions can deterministically discover a Hidden Pearl Cache from the world seed/turn/tile/action hash.
- Added backend/browser-preview parity:
  - Rust `harvest_resource` and `mine_tile` award the discovery bonus and append an authoritative `Rare discovery` player log with `reward_resource`, `reward_amount`, `bonus_pearls`, source tile, and `shop_hint`.
  - Browser preview applies the same reward/log shape.
- Added player-facing and automation feedback:
  - `CivilizationView` watches for new `Rare discovery` logs and raises a rare-object alert/player message without replaying stale logs on session load.
  - `window.render_game_to_text()` now includes `economy.pearls`, shop goals, and `economy.recent_discovery`.
- Browser playtest evidence:
  - `tauri-app/output/web-game/civ-rare-discovery-smoke/01-before-use-rare-target.png`
  - `tauri-app/output/web-game/civ-rare-discovery-smoke/02-rare-discovery-alert.png`
  - `summary.json` shows Play mode targeting a glowshard tile, pressing `E`, pearls 6 -> 13, glowshards 1 -> 2, and `recent_discovery` reporting the Prismatic Pearl Cache with no console/page errors.
- Verification passed:
  - `npm test -- civCreatureProgression.test.ts CivilizationView.test.tsx civCanvas.test.ts civStore.test.ts` (63 tests)
  - `npm run build` (same large Civilization chunk warning)
  - `cargo check` (existing `TauriPermissionPrompter` dead-code warning)
  - `cargo test player_harvest_rare_resource_discovers_bonus_pearls --no-run`
  - `cargo test player_mine_and_place_tile_edits_world --no-run`
  - Strict rejected-asset grep found no cyber/chrome/volt/nebula asset references.
- Official `develop-web-game` client still cannot resolve `playwright`; bundled Playwright smoke was used for the actual browser interaction.

Next TODO:
- Add a first-hatchling interaction/tutorial beat, such as feeding or assigning the hatchling, so hatching creates a new manual choice.
- Add a compact Play-mode shop/egg goal surface so discoveries immediately point players toward what they can buy next.
- Generate any new egg/rarity/civ-level assets only in the README/screenshot chibi/painterly style.

2026-06-08 Play HUD shop-goal pass:
- Added a compact Play-mode shop goal strip to the top-left HUD:
  - Shows Common Egg funding progress from current pearl balance.
  - Shows a disabled `Buy` affordance while underfunded and enables it once affordable.
  - Buying from the strip uses the same shop purchase path as the drawer/Hatchery purchase controls.
- Browser playtest evidence:
  - `tauri-app/output/web-game/civ-shop-goal-smoke/01-shop-goal-locked.png`
  - `tauri-app/output/web-game/civ-shop-goal-smoke/02-shop-goal-ready.png`
  - `tauri-app/output/web-game/civ-shop-goal-smoke/03-shop-goal-bought.png`
  - `summary.json` shows locked `6/12`, ready `12/12`, then clicking `Buy` changed eggs 1 -> 2 and pearls 12 -> 0, with no console/page errors.
- Verification passed:
  - `npm test -- CivilizationView.test.tsx civCanvas.test.ts civStore.test.ts` (59 tests)
  - `npm run build` (same large Civilization chunk warning)
- Official `develop-web-game` client still cannot resolve `playwright`; bundled Playwright smoke was used for the actual browser interaction.

Next TODO:
- Add a first-hatchling interaction/tutorial beat, such as feeding or assigning the hatchling, so hatching creates a new manual choice.
- Add a fuller Play-mode shop goal set after the Common Egg path, including Rare Egg and Rare Lure milestones.
- Generate any new egg/rarity/civ-level assets only in the README/screenshot chibi/painterly style.

2026-06-08 hatchling care interaction pass:
- Added a manual hatchling care action:
  - Hatchlings now appear as Use-mode NPC targets with `action=feed_hatchling` and a `Feed Hatchling ...` target label.
  - Pressing `E`/`Space` on the hatchling spends 1 food, improves hatchling health/mood, sets activity to `fed`, and raises a Play-mode alert/player message.
  - The action is guarded once per hatchling per turn, matching existing anti-spam behavior for talk/building/object interactions.
- Added backend/browser-preview parity:
  - Rust `feed_hatchling` validates ownership, food, hatchling stage, applies care, and writes a `Hatchling fed` player log.
  - Browser preview applies the same food/mood/health/activity/log path for local playtests.
- Extended text-state support:
  - `window.render_game_to_text().player.active_target` can now report `action=feed_hatchling` and `stage=hatchling`.
  - `window.render_game_to_text().hatchery.recent_care` reports the latest care log for automation-friendly verification.
- Browser playtest evidence:
  - `tauri-app/output/web-game/civ-hatchling-care-smoke/before-feed.png`
  - `tauri-app/output/web-game/civ-hatchling-care-smoke/after-feed.png`
  - `summary.json` shows Play mode targeting `action=feed_hatchling`, pressing `E`, food 38 -> 37, and `egg-preview-1` becoming `activity=fed`.
  - The smoke had no page errors; only Chromium WebGL ReadPixels performance warnings from screenshot capture.
- Verification passed:
  - `npm test -- civCreatureProgression.test.ts CivilizationView.test.tsx civCanvas.test.ts civStore.test.ts` (63 tests)
  - `npm run build` (same large Civilization chunk warning)
  - `cargo check` (existing `TauriPermissionPrompter` dead-code warning)
  - `cargo test feed_hatchling_spends_food_and_improves_care --no-run`
  - Strict rejected-asset grep found no cyber/chrome/volt/nebula asset references.
- Official `develop-web-game` client still cannot resolve `playwright`; bundled Playwright smoke was used for the actual browser interaction.

Next TODO:
- Add a fuller Play-mode shop goal set after the Common Egg path, including Rare Egg and Rare Lure milestones.
- Add hatchling follow-up choices beyond feeding, such as assigning a nursery task, naming, or training for a future role.
- Generate any new egg/rarity/civ-level assets only in the README/screenshot chibi/painterly style.

2026-06-08 Play HUD shop-milestone pass:
- Expanded the Play-mode shop goal strip from one Common Egg prompt into a compact three-milestone tracker:
  - Common Egg
  - Rare Lure
  - Rare Egg
- Each milestone now shows its own funded/required pearl count, progress bar, and Buy button state.
- Buying from the milestone strip still uses the existing shop purchase path, so it stays aligned with the Hatchery/Shop drawer behavior.
- Added React coverage for the Play HUD milestone state at 12 pearls: Common Egg and Rare Lure are ready, Rare Egg is locked.
- Browser playtest evidence:
  - `tauri-app/output/web-game/civ-shop-milestones-smoke/01-milestones-initial.png`
  - `tauri-app/output/web-game/civ-shop-milestones-smoke/02-milestones-ready.png`
  - `tauri-app/output/web-game/civ-shop-milestones-smoke/03-rare-lure-bought.png`
  - `summary.json` shows 0/3 ready at 6 pearls, 2/3 ready at 12 pearls, and clicking `Buy Rare Lure` changed pearls 12 -> 2.
  - The smoke had no page errors; only Chromium WebGL ReadPixels performance warnings from screenshot capture.
- Verification passed:
  - `npm test -- CivilizationView.test.tsx civCanvas.test.ts civStore.test.ts` (60 tests)
  - `npm run build` (same large Civilization chunk warning)
  - Strict rejected-asset grep found no cyber/chrome/volt/nebula asset references.
- Official `develop-web-game` client still cannot resolve `playwright`; bundled Playwright smoke was used for the actual browser interaction.

Next TODO:
- Add hatchling follow-up choices beyond feeding, such as assigning a nursery task, naming, or training for a future role.
- Add more Play-mode HUD economy goals after purchase, such as farm/workshop/storage kit milestones when the colony needs buildings.
- Generate any new egg/rarity/civ-level assets only in the README/screenshot chibi/painterly style.

2026-06-08 axolotl action-animation pass:
- Kept the approved README/screenshot axolotl graphic line:
  - Checked available stock axolotl animation packs; did not import them because the viable packs are mostly pixel-art/paid or have license constraints, and they would not match the current chibi/painterly sprite line.
  - Built the first animation layer from the existing approved `axolotl-animated-seeds.png` sheet instead.
- Added explicit axolotl action animation states in the Phaser canvas:
  - Movement/locomotion: idle, swim, walk, jump, dash, wall_slide, rest, play.
  - Manual actions: mine, gather, build, repair, rescue, feed, talk, use.
  - Lifecycle: hatch pop animation for newly created hatchlings.
- Wired animations to real player actions:
  - `E`/Space interaction now triggers action-specific frame sequences, squash/sway/bob motion, particles, and pulses.
  - Build/place, mining, resource gathering, NPC talk, hatchling feed, repair, and rescue map to distinct states.
  - Target axolotls also animate for talk/feed where applicable.
- Extended `window.render_game_to_text()`:
  - `player.player.animation` reports the live animation state.
  - `player.player.action_ms_remaining` reports one-shot action timing for automation/playtest verification.
- Added focused unit coverage:
  - `axoActionAnimationForInteraction` maps terrain/resource/NPC/object actions to the expected animation state.
- Browser playtest evidence:
  - `tauri-app/output/web-game/civ-action-animation-smoke/05-build-ready.png`
  - `tauri-app/output/web-game/civ-action-animation-smoke/06-build-action.png`
  - `tauri-app/output/web-game/civ-action-animation-smoke/08-talk-action.png`
  - `tauri-app/output/web-game/civ-action-animation-smoke/09-swim-down.png`
  - `tauri-app/output/web-game/civ-action-animation-smoke/10-mine-after-swim.png`
  - Smoke text-state showed Build -> `animation=build`, Talk -> `animation=talk`, swim-down -> `animation=swim`, and Mine -> `animation=mine`; no page/console errors.
- Verification passed:
  - `npm test -- civCanvas.test.ts CivilizationView.test.tsx civStore.test.ts` (62 tests)
  - `npm run build` (same large Civilization chunk warning)
  - Strict rejected-asset grep found no cyber/chrome/volt/nebula or old rejected generated asset references.
- Official `develop-web-game` client still cannot resolve `playwright`; bundled Playwright smoke was used for the actual browser interaction.

Next TODO:
- Generate a small style-matched supplemental sprite sheet for mining/gathering/hatching poses only if it is based on the approved README/screenshot axolotl line.
- Add a visible hatch ceremony/tutorial beat after egg hatching so the new hatch animation has a clear player-facing moment.
- Add more Play-mode HUD economy goals after purchase, such as farm/workshop/storage kit milestones when the colony needs buildings.

2026-06-08 action movement correction pass:
- Addressed the playtest issue where axolotls mostly looked like they were hopping in place:
  - Added live visual destinations for non-player axolotls when the backend snapshot has an activity but no `target_x/target_y`.
  - Idle and play axolotls now patrol over larger world-space arcs.
  - Gatherers now commute between home and resource tiles instead of staying parked; build/repair/rescue-style activities can use object/building work destinations.
  - Manual interactions now store an action target point so mine/build/talk/feed/repair/rescue actions surge toward the target in world space.
- Extended text-state verification:
  - `window.render_game_to_text().player.animated_entities` exposes live rendered axolotl positions, animation state, target kind/point, and whether the sprite is moving.
- Browser playtest evidence:
  - `tauri-app/output/web-game/civ-action-motion-smoke/07-final-workers-travel.png`
  - `tauri-app/output/web-game/civ-action-motion-smoke/08-final-workers-continue.png`
  - `tauri-app/output/web-game/civ-action-motion-smoke/09-final-mine-movement.png`
  - Smoke text-state showed idle/play workers moving ~60-90px, the gather worker moving 92px then another 52px, and manual mining moving the player 29px into the target action.
  - The smoke had no page errors.
- Verification passed:
  - `npm test -- civCanvas.test.ts CivilizationView.test.tsx civStore.test.ts` (62 tests)
  - `npm run build` (same large Civilization chunk warning)
  - Strict rejected-asset grep found no cyber/chrome/volt/nebula or old rejected generated asset references.
- Official `develop-web-game` client still cannot resolve `playwright`; bundled Playwright smoke was used for the actual browser interaction.

Next TODO:
- Add visible world-space paths for shop/building construction jobs after purchases, so newly bought kits send axolotls to the build site.
- Add a visible hatch ceremony/tutorial beat after egg hatching so the hatch animation has a clear player-facing movement sequence.
- Generate a small style-matched supplemental sprite sheet for mining/gathering/hatching poses only if it is based on the approved README/screenshot axolotl line.

2026-06-08 first-play entry playability pass:
- Broad playtest found a concrete first-human-run issue:
  - Switching from Observe to Play possessed an axolotl in the upper water column with `active_target = Nothing in reach`.
  - This made the first player interaction feel dead until the player learned to swim down to the settlement.
- Fixed the canvas control handoff:
  - On fresh Play-mode possession, if the player is not already at a useful nearby target, the canvas places the axolotl at a colony-side playable entry point.
  - Entry point prefers the nearest resource tile to the colony, then nearest building/object, then colony floor fallback.
  - The relocation is keyed by session/entity so it runs once per fresh control handoff and does not keep snapping the player while they play.
- Browser playtest evidence:
  - `tauri-app/output/web-game/civ-entry-playtest/02-play-entry.png`
  - `tauri-app/output/web-game/civ-entry-playtest/03-entry-interact.png`
  - `tauri-app/output/web-game/civ-entry-playtest/04-new-run-entry.png`
  - Smoke text-state showed Play mode starts at tile 55,46 with a wood resource target at distance 30; pressing `E` immediately gathered wood and raised resource/rare-discovery alerts; New Run also starts with a resource target in reach.
- Verification passed:
  - `npm test -- civCanvas.test.ts CivilizationView.test.tsx civStore.test.ts` (62 tests)
  - `npm run build` (same large Civilization chunk warning)
  - Strict rejected-asset grep found no cyber/chrome/volt/nebula or old rejected generated asset references.
- Official `develop-web-game` client still cannot resolve `playwright`; bundled Playwright smoke was used for the actual browser interaction.

Next TODO:
- Continue playtesting from the new entry point and fix the next human-first flow issue, likely task routing/building purchase construction feedback.
- Add visible world-space paths for shop/building construction jobs after purchases, so newly bought kits send axolotls to the build site.
- Add a visible hatch ceremony/tutorial beat after egg hatching so the hatch animation has a clear player-facing movement sequence.

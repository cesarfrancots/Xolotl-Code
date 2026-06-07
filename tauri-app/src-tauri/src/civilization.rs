use crate::commands::{call_model_streaming, ChatMessage};
use runtime::AgentEvent;
use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::HashMap;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter};

// A large procedural aquatic continent. Axolotls swim a deep water column above a
// seabed that rises and falls across distinct biome regions. The world is much
// wider/taller than the viewport — the renderer pans/zooms a camera over it.
// Single-civ default width; multi-civ worlds scale wider via `world_width`.
const WORLD_WIDTH: u32 = 128;
const WORLD_HEIGHT: u32 = 96;
const INITIAL_POPULATION: u32 = 8;

// Thin sky/surface band at the very top; the rest is water down to the seabed.
const WATER_SURFACE_Y: u32 = 6;
// Base seabed row. Each biome region offsets the floor up/down around this, and a
// gentle per-column ripple gives the seabed a natural silhouette.
const WATER_FLOOR_Y: u32 = 50;
// Rows below this in the water column read as "deep" (darker, deepwater tiles).
const DEEP_WATER_Y: u32 = 34;

const EGG_HATCH_TURNS: u32 = 3;
const ELDER_BASE_AGE: f32 = 22.0;

// Colour genetics. Order matches the sprite-sheet variant order on the frontend.
const MORPHS: [&str; 12] = [
    "leucistic",
    "wild",
    "melanoid",
    "gold",
    "axanthic",
    "blue",
    "copper",
    "gfp",
    "albino",
    "piebald",
    "firefly",
    "mystic",
];
// Morphs that show up in the founding colony / as common recessive alleles.
const COMMON_MORPHS: [&str; 6] = ["leucistic", "wild", "gold", "axanthic", "copper", "albino"];
// Rare morphs only reachable through mutation.
const RARE_MORPHS: [&str; 3] = ["gfp", "firefly", "mystic"];
// Equippable accessory ids (match `public/civ/accessories/acc-<id>.png`).
const ACCESSORIES: [&str; 12] = [
    "flowercrown",
    "strawhat",
    "leafhat",
    "scarf",
    "glasses",
    "wizardhat",
    "crown",
    "snorkel",
    "bow",
    "headphones",
    "chefhat",
    "piratehat",
];

// Snapshot schema version. v1 = single `civilization`; v2 = `civs[]` multi-civ world.
const SCHEMA_VERSION: u32 = 2;
// Distinct per-civ colours for renderer tinting, assigned round-robin by civ index.
const CIV_COLORS: [&str; 8] = [
    "#7fdfff", "#ff9ec7", "#9bffa0", "#ffd66e", "#c79cff", "#ff8f6e", "#6ee0c7", "#f4f59a",
];
// The founding colony's civ id (the only civ until multi-spawn lands in W2/W9).
const FIRST_CIV_ID: &str = "civ-1";

/// Aquatic biome regions painted left-to-right across the seabed.
/// `floor_offset` raises (negative) or lowers (positive) the seabed relative to
/// `WATER_FLOOR_Y`; `deep` darkens the water column to deepwater; `top`/`mid`/
/// `deep` terrains pick substrate tiles by depth below the seabed; `resources`
/// are the gatherable patches seeded along this region's floor.
struct BiomeDef {
    id: &'static str,
    name: &'static str,
    floor_offset: i32,
    deep: bool,
    top_terrain: &'static str,
    mid_terrain: &'static str,
    deep_terrain: &'static str,
    resources: &'static [&'static str],
    /// Whether a colony may be founded here. Harsh biomes (deep trenches,
    /// volcanic, glacier, abyss) are skipped when placing civ spawn points.
    spawnable: bool,
}

const BIOMES: [BiomeDef; 14] = [
    BiomeDef {
        id: "shallows",
        name: "Sunlit Shallows",
        floor_offset: -10,
        deep: false,
        top_terrain: "sand",
        mid_terrain: "sand",
        deep_terrain: "earth",
        resources: &["moss", "fiber"],
        spawnable: true,
    },
    BiomeDef {
        id: "reedmarsh",
        name: "Reed Marsh",
        floor_offset: -4,
        deep: false,
        top_terrain: "moss",
        mid_terrain: "mud",
        deep_terrain: "earth",
        resources: &["moss", "wood", "fiber"],
        spawnable: true,
    },
    BiomeDef {
        id: "mudflats",
        name: "Mud Flats",
        floor_offset: 0,
        deep: false,
        top_terrain: "mud",
        mid_terrain: "earth",
        deep_terrain: "stone",
        resources: &["clay", "clay", "fiber"],
        spawnable: true,
    },
    BiomeDef {
        id: "kelpforest",
        name: "Kelp Forest",
        floor_offset: -6,
        deep: false,
        top_terrain: "moss",
        mid_terrain: "moss",
        deep_terrain: "earth",
        resources: &["wood", "fiber", "kelp"],
        spawnable: true,
    },
    BiomeDef {
        id: "openwater",
        name: "Open Water",
        floor_offset: 4,
        deep: false,
        top_terrain: "sand",
        mid_terrain: "earth",
        deep_terrain: "stone",
        resources: &["stone", "kelp"],
        spawnable: true,
    },
    BiomeDef {
        id: "deeptrench",
        name: "Deep Trench",
        floor_offset: 16,
        deep: true,
        top_terrain: "stone",
        mid_terrain: "stone",
        deep_terrain: "stone",
        resources: &["glowshards", "ore"],
        spawnable: false,
    },
    BiomeDef {
        id: "crystalcave",
        name: "Crystal Caverns",
        floor_offset: 8,
        deep: true,
        top_terrain: "crystal",
        mid_terrain: "stone",
        deep_terrain: "crystal",
        resources: &["glowshards", "glowshards", "stone"],
        spawnable: false,
    },
    BiomeDef {
        id: "thermalvent",
        name: "Thermal Vents",
        floor_offset: 10,
        deep: true,
        top_terrain: "stone",
        mid_terrain: "earth",
        deep_terrain: "stone",
        resources: &["stone", "sulfur", "clay"],
        spawnable: false,
    },
    BiomeDef {
        id: "coralreef",
        name: "Coral Reef",
        floor_offset: -8,
        deep: false,
        top_terrain: "coral",
        mid_terrain: "coral",
        deep_terrain: "sand",
        resources: &["coral", "kelp", "fiber"],
        spawnable: true,
    },
    BiomeDef {
        id: "glacier",
        name: "Glacier Shelf",
        floor_offset: -2,
        deep: false,
        top_terrain: "ice",
        mid_terrain: "ice",
        deep_terrain: "stone",
        resources: &["ice", "stone"],
        spawnable: false,
    },
    BiomeDef {
        id: "volcanic",
        name: "Volcanic Rift",
        floor_offset: 12,
        deep: true,
        top_terrain: "basalt",
        mid_terrain: "basalt",
        deep_terrain: "stone",
        resources: &["sulfur", "ore", "stone"],
        spawnable: false,
    },
    BiomeDef {
        id: "bog",
        name: "Sunken Bog",
        floor_offset: -3,
        deep: false,
        top_terrain: "peat",
        mid_terrain: "mud",
        deep_terrain: "earth",
        resources: &["herbs", "fiber", "moss"],
        spawnable: true,
    },
    BiomeDef {
        id: "saltflats",
        name: "Salt Flats",
        floor_offset: 2,
        deep: false,
        top_terrain: "salt",
        mid_terrain: "sandstone",
        deep_terrain: "stone",
        resources: &["amber", "clay"],
        spawnable: true,
    },
    BiomeDef {
        id: "abyss",
        name: "The Abyss",
        floor_offset: 20,
        deep: true,
        top_terrain: "stone",
        mid_terrain: "stone",
        deep_terrain: "stone",
        resources: &["glowshards", "ore"],
        spawnable: false,
    },
];

// Index of the home biome (Reed Marsh) the founding colony settles in.
const HOME_BIOME: usize = 1;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct CivParticipant {
    pub name: String,
    pub model: String,
    #[serde(default)]
    pub color: Option<String>, // None => auto CIV_COLORS[index]
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct CivSessionConfig {
    pub name: String,
    #[serde(default)]
    pub seed: Option<u32>,
    #[serde(default)]
    pub civs: Vec<CivParticipant>,
    #[serde(default)]
    pub model: Option<String>, // legacy single-model; mapped to one participant if civs empty
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct CivSessionMeta {
    pub id: String,
    pub name: String,
    pub model: String,
    pub created_at: u64,
    pub updated_at: u64,
    pub turn: u32,
    pub score: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct CivSessionSnapshot {
    pub id: String,
    pub name: String,
    pub seed: u32,
    /// Snapshot schema version. Legacy v1 saves are migrated on load (see
    /// `parse_snapshot`); always `SCHEMA_VERSION` after a successful load.
    #[serde(default = "schema_version")]
    pub version: u32,
    pub created_at: u64,
    pub updated_at: u64,
    pub turn: u32,
    pub world: CivWorld,
    /// The competing civilizations sharing this world. v1 saves carried a single
    /// `civilization`; migration wraps it as the one element here.
    #[serde(default)]
    pub civs: Vec<CivCivilization>,
    /// World-wide environment state (seasons, disasters). Populated lazily — old
    /// saves default to a calm spring.
    #[serde(default = "default_environment")]
    pub environment: CivEnvironment,
    /// Global/world modifiers (observer buffs/debuffs and disaster after-effects).
    pub modifiers: Vec<CivModifier>,
    pub log: Vec<CivLogEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct CivWorld {
    pub width: u32,
    pub height: u32,
    pub tiles: Vec<CivTile>,
    pub entities: Vec<CivEntity>,
    /// Named biome regions painted across the seabed. `owner` is the civ id that
    /// holds the region (None = unclaimed).
    #[serde(default)]
    pub regions: Vec<CivRegion>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct CivRegion {
    pub id: String,
    pub name: String,
    pub biome: String,
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
    /// Owning civ id. None = unclaimed. Set at spawn for home regions; mutated by
    /// claim/raid once combat lands (W6).
    #[serde(default)]
    pub owner: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct CivTile {
    pub x: u32,
    pub y: u32,
    pub terrain: String,
    #[serde(default)]
    pub resource: Option<String>,
    pub amount: i32,
    /// Biome region this tile belongs to (empty for air/surface). Lets the
    /// renderer colour-grade water and substrate per region.
    #[serde(default)]
    pub biome: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, Type)]
pub struct CivEntity {
    pub id: String,
    pub kind: String,
    pub name: String,
    pub x: u32,
    pub y: u32,
    pub health: f32,
    pub mood: f32,
    pub role: String,
    /// Owning civ id. `None` = wild fauna / neutral (predators, prey, resource
    /// flora). Every founder, building, and egg is tagged with its owning civ.
    #[serde(default)]
    pub civ_id: Option<String>,
    /// Expressed colour morph (e.g. "leucistic"). Empty for non-axolotls.
    #[serde(default)]
    pub morph: String,
    /// Life stage: "egg" | "hatchling" | "juvenile" | "adult" | "elder".
    #[serde(default)]
    pub stage: String,
    /// "f" | "m" | "" (eggs/buildings).
    #[serde(default)]
    pub sex: String,
    /// Turns alive since hatching.
    #[serde(default)]
    pub age: u32,
    /// Display scale multiplier derived from stage + genetics.
    #[serde(default = "default_size")]
    pub size: f32,
    /// Equipped accessory ids.
    #[serde(default)]
    pub accessories: Vec<String>,
    /// Heritable traits (axolotls + eggs).
    #[serde(default)]
    pub genes: Option<CivGenes>,
    /// Remaining turns until an egg hatches.
    #[serde(default)]
    pub hatches_in: Option<u32>,
    /// Parent ids (eggs + offspring).
    #[serde(default)]
    pub parents: Vec<String>,
    /// What this entity is doing this turn — drives the renderer's action
    /// animation. Emitted values: "" (ambient swim) | "gather" | "build" |
    /// "explore" | "play" | "rest" | "egg". The renderer also handles "eat" if a
    /// future turn emits it.
    #[serde(default)]
    pub activity: String,
    /// Optional tile the entity swims toward while performing its activity.
    #[serde(default)]
    pub target_x: Option<u32>,
    #[serde(default)]
    pub target_y: Option<u32>,
}

fn default_size() -> f32 {
    1.0
}

fn schema_version() -> u32 {
    SCHEMA_VERSION
}

fn default_true() -> bool {
    true
}

fn default_environment() -> CivEnvironment {
    CivEnvironment::new()
}

/// Heritable traits. `allele_a`/`allele_b` are the two carried colour alleles;
/// the expressed morph is the dominant of the two.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct CivGenes {
    pub allele_a: String,
    pub allele_b: String,
    pub size_gene: f32,
    pub fertility: f32,
    pub longevity: f32,
    pub vigor: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct CivCivilization {
    /// Stable civ id ("civ-1"…). Empty in legacy saves; backfilled on load.
    #[serde(default)]
    pub id: String,
    /// Display name for this civ (defaults to the session/colony name for the
    /// founding civ; the participant name for civs added later).
    #[serde(default)]
    pub name: String,
    /// The model governing this civ.
    #[serde(default)]
    pub model: String,
    /// Hex colour for renderer tinting; assigned from `CIV_COLORS`.
    #[serde(default)]
    pub color: String,
    /// Home column (spawn point) for camera focus and colony fallback centring.
    #[serde(default)]
    pub spawn_x: u32,
    /// Home region id (claimed at spawn).
    #[serde(default)]
    pub home_region: String,
    /// `false` once the colony collapses (population hits 0).
    #[serde(default = "default_true")]
    pub alive: bool,
    /// Diplomacy stance toward other civs: civ_id -> "ally|trade|neutral|hostile".
    #[serde(default)]
    pub diplomacy: HashMap<String, String>,
    pub era: String,
    pub population: u32,
    pub health: f32,
    pub morale: f32,
    pub resources: HashMap<String, i32>,
    pub techs: Vec<String>,
    pub policies: Vec<String>,
    pub score: CivScore,
    /// Harness/model id driving this civ (ARENA-03 score attribution). None => model plays itself.
    #[serde(default)]
    pub controller: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct CivScore {
    pub survival: f32,
    pub ethics: f32,
    pub intelligence: f32,
    pub total: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct CivModifier {
    pub id: String,
    pub kind: String,
    pub label: String,
    pub polarity: String,
    pub remaining_turns: u32,
    pub intensity: f32,
}

/// World-wide environment state. Seasons drift and disasters that physically
/// reshape the world land in W4; W1 only carries the state (a calm default) so
/// the rest of the system can read it.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct CivEnvironment {
    pub season: String,
    pub turn_of_season: u32,
    pub temperature: f32,
    pub water_level: i32,
    pub disasters: Vec<CivDisaster>,
    #[serde(default)]
    pub forecast: Option<CivDisaster>,
}

impl CivEnvironment {
    fn new() -> Self {
        CivEnvironment {
            season: "spring".to_string(),
            turn_of_season: 0,
            temperature: 14.0,
            water_level: 0,
            disasters: Vec::new(),
            forecast: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct CivDisaster {
    pub id: String,
    pub kind: String,
    pub epicenter_x: u32,
    pub radius: u32,
    pub intensity: f32,
    pub remaining_turns: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct CivLogEntry {
    pub turn: u32,
    pub kind: String,
    pub title: String,
    pub body: String,
    pub created_at: u64,
    /// Civ this entry is attributed to (e.g. an "ai_decision"). None for
    /// world/session-global entries and legacy saves (serde default).
    #[serde(default)]
    pub civ_id: Option<String>,
    /// The model's private reasoning behind a decision (D-12 Option B). None
    /// when the model emitted no reasoning or for non-decision entries.
    #[serde(default)]
    pub reasoning: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct CivIntervention {
    pub kind: String,
    pub target: String,
    #[serde(default)]
    pub amount: Option<i32>,
    #[serde(default)]
    pub x: Option<u32>,
    #[serde(default)]
    pub y: Option<u32>,
    #[serde(default)]
    pub duration: Option<u32>,
    #[serde(default)]
    pub intensity: Option<f32>,
    #[serde(default)]
    pub entity_id: Option<String>,
    #[serde(default)]
    pub accessory: Option<String>,
    /// Civ a resource grant/removal targets. `None` = the first living civ
    /// (back-compat). Modifier interventions stay world-global regardless.
    #[serde(default)]
    pub civ_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct CivModelDecision {
    pub intent: String,
    pub public_rationale: String,
    pub actions: Vec<CivDecisionAction>,
    pub ethics_note: String,
    pub expected_risks: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct CivDecisionAction {
    #[serde(rename = "type")]
    pub action_type: String,
    #[serde(default)]
    pub resource: Option<String>,
    #[serde(default)]
    pub workers: Option<u32>,
    #[serde(default)]
    pub building: Option<String>,
    #[serde(default)]
    pub x: Option<u32>,
    #[serde(default)]
    pub y: Option<u32>,
    #[serde(default)]
    pub tech_id: Option<String>,
    #[serde(default)]
    pub direction: Option<String>,
    #[serde(default)]
    pub policy: Option<String>,
    #[serde(default)]
    pub event_id: Option<String>,
}

/// Resolve a `CivSessionConfig` into a validated, colour-assigned participant
/// list. Explicit `civs` win; otherwise the legacy single `model` maps to one
/// participant (back-compat, D-05). Enforces 1-3 participants (D-03), non-empty
/// models, and assigns each civ a concrete colour (auto from the palette when
/// not overridden).
fn resolve_participants(config: &CivSessionConfig) -> Result<Vec<CivParticipant>, String> {
    let mut participants = if !config.civs.is_empty() {
        config.civs.clone()
    } else if let Some(model) = config
        .model
        .as_ref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
    {
        vec![CivParticipant {
            name: clean_name(&config.name),
            model: model.to_string(),
            color: None,
        }]
    } else {
        return Err("at least one civilization is required".to_string());
    };

    // Bound the world: 1-3 participants only (D-03; >=1 guaranteed above).
    if participants.len() > 3 {
        return Err("at most 3 civilizations are allowed".to_string());
    }

    // Each model must be non-empty; resolve each civ's colour (auto from the
    // palette when not overridden) so initial_snapshot gets concrete colours.
    for (i, participant) in participants.iter_mut().enumerate() {
        if participant.model.trim().is_empty() {
            return Err("model is required".to_string());
        }
        participant.model = participant.model.trim().to_string();
        participant.name = clean_name(&participant.name);
        let color = participant
            .color
            .clone()
            .unwrap_or_else(|| CIV_COLORS[i % CIV_COLORS.len()].to_string());
        participant.color = Some(color);
    }

    Ok(participants)
}

#[tauri::command]
#[specta::specta]
pub fn create_civ_session(config: CivSessionConfig) -> Result<String, String> {
    let participants = resolve_participants(&config)?;

    let id = uuid::Uuid::new_v4().to_string();
    let seed = config.seed.unwrap_or_else(|| seed_from(&id));
    let now = unix_timestamp_secs();
    let mut snapshot = initial_snapshot(
        id.clone(),
        clean_name(&config.name),
        &participants,
        seed,
        now,
    );
    push_log(
        &mut snapshot,
        "session",
        "Colony founded",
        "A small axolotl colony wakes beside a clear pond with enough supplies to attempt its first plans.",
    );
    save_snapshot(&snapshot)?;
    Ok(id)
}

#[tauri::command]
#[specta::specta]
pub fn list_civ_sessions() -> Vec<CivSessionMeta> {
    let Ok(entries) = std::fs::read_dir(home_civilizations_dir()) else {
        return Vec::new();
    };
    let mut metas: Vec<CivSessionMeta> = entries
        .filter_map(|entry| entry.ok())
        .filter(|entry| {
            entry
                .path()
                .extension()
                .map(|ext| ext == "json")
                .unwrap_or(false)
        })
        .filter_map(|entry| {
            let raw = std::fs::read_to_string(entry.path()).ok()?;
            let snapshot = parse_snapshot(&raw).ok()?;
            Some(CivSessionMeta {
                id: snapshot.id,
                name: snapshot.name,
                model: snapshot
                    .civs
                    .first()
                    .map(|civ| civ.model.clone())
                    .unwrap_or_default(),
                created_at: snapshot.created_at,
                updated_at: snapshot.updated_at,
                turn: snapshot.turn,
                score: leaderboard_score(&snapshot.civs),
            })
        })
        .collect();
    metas.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    metas
}

#[tauri::command]
#[specta::specta]
pub fn load_civ_session(id: String) -> Result<String, String> {
    let snapshot = load_snapshot(&id)?;
    serde_json::to_string(&snapshot).map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn delete_civ_session(id: String) -> Result<(), String> {
    validate_id(&id)?;
    let path = home_civilizations_dir().join(format!("{id}.json"));
    std::fs::remove_file(&path).map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn apply_civ_intervention(
    app_handle: AppHandle,
    id: String,
    intervention: CivIntervention,
) -> Result<String, String> {
    let mut snapshot = load_snapshot(&id)?;
    apply_intervention_to_snapshot(&mut snapshot, &intervention)?;
    snapshot.updated_at = unix_timestamp_secs();
    rescore_all_civs(&mut snapshot);
    save_snapshot(&snapshot)?;
    emit_civ_event(
        &app_handle,
        &snapshot.id,
        "InterventionApplied",
        serde_json::json!({
            "intervention": intervention,
            "snapshot": &snapshot,
        }),
    );
    serde_json::to_string(&snapshot).map_err(|e| e.to_string())
}

/// Set (or clear) the harness/model controller tag on a civ for ARENA-03 score
/// attribution. The tag is sanitised (trimmed + capped at 64 chars, dropped if
/// empty) so a hostile/overlong label cannot bloat the snapshot or spoof the
/// leaderboard/text-state (threat T-01-02). The tag is a free-form label only —
/// never a provider key.
#[tauri::command]
#[specta::specta]
pub fn set_civ_controller(
    app_handle: AppHandle,
    id: String,
    civ_id: String,
    controller: Option<String>,
) -> Result<String, String> {
    let mut snapshot = load_snapshot(&id)?;
    let sanitized = controller
        .map(|s| s.trim().chars().take(64).collect::<String>())
        .filter(|s| !s.is_empty());
    let civ = snapshot
        .civs
        .iter_mut()
        .find(|c| c.id == civ_id)
        .ok_or_else(|| format!("civ {civ_id} not found"))?;
    civ.controller = sanitized;
    snapshot.updated_at = unix_timestamp_secs();
    save_snapshot(&snapshot)?;
    emit_civ_event(
        &app_handle,
        &snapshot.id,
        "ControllerSet",
        serde_json::json!({ "snapshot": &snapshot }),
    );
    serde_json::to_string(&snapshot).map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn advance_civ_turn(app_handle: AppHandle, id: String) -> Result<String, String> {
    let mut snapshot = load_snapshot(&id)?;
    let next_turn = snapshot.turn.saturating_add(1);
    emit_civ_event(
        &app_handle,
        &snapshot.id,
        "TurnStarted",
        serde_json::json!({
            "turn": next_turn,
            "snapshot": &snapshot,
        }),
    );
    snapshot.turn = next_turn;

    // Each living civ decides and acts, in a deterministic per-turn shuffled order
    // so first-mover advantage on shared resources rotates fairly across civs.
    let turn_order = civ_turn_order(&snapshot);

    for civ_id in &turn_order {
        let Some(ci) = civ_index(&snapshot, civ_id) else {
            continue;
        };
        let model = snapshot.civs[ci].model.clone();
        let observation = build_observation(&snapshot, civ_id);
        let prompt = build_decision_prompt(&observation);
        let first = call_model_text(
            &model,
            vec![ChatMessage {
                role: "user".to_string(),
                content: prompt,
            }],
        )
        .await?;

        let decision = match parse_model_decision(&first.content) {
            Ok(decision) => decision,
            Err(first_error) => {
                let repair = call_model_text(
                    &model,
                    vec![ChatMessage {
                        role: "user".to_string(),
                        content: build_repair_prompt(&first.content, &first_error),
                    }],
                )
                .await?;
                match parse_model_decision(&repair.content) {
                    Ok(decision) => decision,
                    Err(second_error) => {
                        let civ_name = civ_label(&snapshot, civ_id);
                        push_log(
                            &mut snapshot,
                            "confused_turn",
                            &format!("{civ_name}'s decision was invalid"),
                            &format!(
                                "The model did not return the required decision JSON after repair. First error: {first_error}. Second error: {second_error}."
                            ),
                        );
                        reset_activities(&mut snapshot, civ_id);
                        continue;
                    }
                }
            }
        };

        let reasoning = first.reasoning;
        emit_civ_event(
            &app_handle,
            &snapshot.id,
            "ModelDecision",
            serde_json::json!({
                "turn": next_turn,
                "civ_id": civ_id,
                "decision": &decision,
                "reasoning": &reasoning,
            }),
        );
        // Persist the reasoning into the decision log (D-12 Option B); empty
        // reasoning is stored as None by push_decision_log.
        let reasoning = if reasoning.is_empty() {
            None
        } else {
            Some(reasoning)
        };
        apply_model_decision(&mut snapshot, civ_id, &decision, reasoning);
    }

    // Resolve each civ's environment, then collapse any that ran out of axolotls.
    for civ_id in &turn_order {
        resolve_environment(&mut snapshot, civ_id);
        if let Some(ci) = civ_index(&snapshot, civ_id) {
            if snapshot.civs[ci].alive && should_collapse(&snapshot, civ_id) {
                snapshot.civs[ci].alive = false;
                let civ_name = civ_label(&snapshot, civ_id);
                push_log(
                    &mut snapshot,
                    "collapse",
                    &format!("{civ_name} collapsed"),
                    "The last axolotls of the colony slipped away; its pond falls quiet.",
                );
            }
        }
    }
    tick_modifiers(&mut snapshot);
    rescore_all_civs(&mut snapshot);
    snapshot.updated_at = unix_timestamp_secs();
    save_snapshot(&snapshot)?;

    emit_civ_event(
        &app_handle,
        &snapshot.id,
        "TurnResolved",
        serde_json::json!({
            "turn": next_turn,
            "leaderboard": leaderboard(&snapshot.civs),
            "snapshot": &snapshot,
        }),
    );
    serde_json::to_string(&snapshot).map_err(|e| e.to_string())
}

struct ModelTextResult {
    content: String,
    reasoning: String,
}

async fn call_model_text(
    model: &str,
    messages: Vec<ChatMessage>,
) -> Result<ModelTextResult, String> {
    let (tx, mut rx) = tokio::sync::mpsc::channel::<AgentEvent>(256);
    let model = model.to_string();
    let messages_for_task = messages.clone();
    let tx_for_task = tx.clone();
    tokio::spawn(async move {
        match call_model_streaming(&model, &messages_for_task, &tx_for_task).await {
            Ok(usage) => {
                let _ = tx_for_task.send(AgentEvent::TurnCompleted { usage }).await;
            }
            Err(message) => {
                let _ = tx_for_task.send(AgentEvent::Error { message }).await;
            }
        }
    });
    drop(tx);

    let mut content = String::new();
    let mut reasoning = String::new();
    while let Some(event) = rx.recv().await {
        match event {
            AgentEvent::TextDelta(text) => content.push_str(&text),
            AgentEvent::ReasoningDelta(text) => reasoning.push_str(&text),
            AgentEvent::TurnCompleted { .. } => break,
            AgentEvent::Error { message } => return Err(message),
            _ => {}
        }
    }

    if content.trim().is_empty() {
        return Err("model returned an empty civilization decision".to_string());
    }
    Ok(ModelTextResult { content, reasoning })
}

/// Found an N-civ world from resolved participants (each carries a concrete
/// colour). `name` is the session/world name; per-civ names come from the
/// participants. The founding (index 0) civ keeps the original centred-colony
/// behaviour via `generate_world`'s single-civ path when only one participant
/// is supplied.
fn initial_snapshot(
    id: String,
    name: String,
    participants: &[CivParticipant],
    seed: u32,
    now: u64,
) -> CivSessionSnapshot {
    let world = generate_world(seed, participants.len() as u32);

    let civs: Vec<CivCivilization> = participants
        .iter()
        .enumerate()
        .map(|(i, participant)| {
            let civ_id = civ_id_for(i);
            // Each civ's home: its pond/nest column and the region it sits in,
            // from the colony `found_colony` placed for this index.
            let spawn_x = world
                .entities
                .iter()
                .find(|e| e.civ_id.as_deref() == Some(civ_id.as_str()) && e.role == "pond")
                .or_else(|| {
                    world
                        .entities
                        .iter()
                        .find(|e| e.civ_id.as_deref() == Some(civ_id.as_str()) && e.role == "nest")
                })
                .map(|e| e.x)
                .unwrap_or(world.width / 2);
            let home_region = world
                .regions
                .iter()
                .find(|r| r.owner.as_deref() == Some(civ_id.as_str()))
                .map(|r| r.id.clone())
                .unwrap_or_default();

            let mut resources = HashMap::new();
            resources.insert("food".to_string(), 42);
            resources.insert("clean_water".to_string(), 38);
            resources.insert("wood".to_string(), 18);
            resources.insert("stone".to_string(), 10);
            resources.insert("clay".to_string(), 8);
            resources.insert("fiber".to_string(), 12);
            resources.insert("tools".to_string(), 2);
            resources.insert("glowshards".to_string(), 0);
            resources.insert("kelp".to_string(), 0);
            resources.insert("ore".to_string(), 0);
            resources.insert("ice".to_string(), 0);
            resources.insert("coral".to_string(), 0);
            resources.insert("sulfur".to_string(), 0);
            resources.insert("amber".to_string(), 0);
            resources.insert("herbs".to_string(), 0);

            let color = participant
                .color
                .clone()
                .unwrap_or_else(|| CIV_COLORS[i % CIV_COLORS.len()].to_string());

            CivCivilization {
                id: civ_id,
                name: participant.name.clone(),
                model: participant.model.clone(),
                color,
                spawn_x,
                home_region,
                alive: true,
                diplomacy: HashMap::new(),
                era: "pond_camp".to_string(),
                population: INITIAL_POPULATION,
                health: 82.0,
                morale: 76.0,
                resources,
                techs: vec!["forage".to_string(), "basic_shelter".to_string()],
                policies: Vec::new(),
                score: CivScore {
                    survival: 0.0,
                    ethics: 0.0,
                    intelligence: 0.0,
                    total: 0.0,
                },
                controller: None,
            }
        })
        .collect();

    let mut snapshot = CivSessionSnapshot {
        id,
        name,
        seed,
        version: SCHEMA_VERSION,
        created_at: now,
        updated_at: now,
        turn: 0,
        world,
        civs,
        environment: CivEnvironment::new(),
        modifiers: Vec::new(),
        log: Vec::new(),
    };
    rescore_all_civs(&mut snapshot);
    snapshot
}

/// Lay biome regions out left-to-right. Returns `(biome_index, start_x, width)`
/// per region, with the home biome roughly centred and the rest seed-shuffled so
/// each continent differs. Widths always tile `WORLD_WIDTH` exactly, each >= 8.
fn biome_layout(seed: u32, width: u32) -> Vec<(usize, u32, u32)> {
    let mut rng = (seed ^ 0x5EAB_ED01).max(1);
    let mut others: Vec<usize> = (0..BIOMES.len()).filter(|&i| i != HOME_BIOME).collect();
    for i in (1..others.len()).rev() {
        let j = (next_rng(&mut rng) as usize) % (i + 1);
        others.swap(i, j);
    }
    let half = others.len() / 2;
    let mut seq: Vec<usize> = Vec::with_capacity(BIOMES.len());
    seq.extend_from_slice(&others[..half]);
    seq.push(HOME_BIOME);
    seq.extend_from_slice(&others[half..]);

    let n = seq.len();
    let mut bounds: Vec<u32> = (0..=n).map(|k| (width as usize * k / n) as u32).collect();
    for k in 1..n {
        let lo = bounds[k - 1] + 8;
        let hi = bounds[k + 1].saturating_sub(8);
        if hi > lo {
            let jitter = (next_rng(&mut rng) % 9) as i32 - 4;
            bounds[k] = (bounds[k] as i32 + jitter).clamp(lo as i32, hi as i32) as u32;
        }
    }
    seq.iter()
        .enumerate()
        .map(|(k, &bi)| (bi, bounds[k], bounds[k + 1] - bounds[k]))
        .collect()
}

/// Organic seabed ripple for column `x` (small integer offset).
fn seabed_ripple(x: u32, seed: u32) -> i32 {
    let xf = x as f32;
    let phase = (seed % 360) as f32 * 0.017_453;
    let v = (xf * 0.16 + phase).sin() * 2.6 + (xf * 0.06).sin() * 1.6;
    v.round() as i32
}

fn floor_y_at(x: u32, biome: usize, seed: u32) -> u32 {
    let base = WATER_FLOOR_Y as i32 + BIOMES[biome].floor_offset + seabed_ripple(x, seed);
    base.clamp((WATER_SURFACE_Y + 16) as i32, (WORLD_HEIGHT - 4) as i32) as u32
}

/// World width scales with the number of civs so each colony gets room. A lone
/// civ keeps the original `WORLD_WIDTH`; more civs widen the continent (capped).
fn world_width(civ_count: u32) -> u32 {
    if civ_count <= 1 {
        WORLD_WIDTH
    } else {
        (96 + civ_count * 64).min(512)
    }
}

fn generate_world(seed: u32, civ_count: u32) -> CivWorld {
    let civ_count = civ_count.max(1);
    let width = world_width(civ_count);
    let mut rng = seed.max(1);
    let layout = biome_layout(seed, width);

    let mut col_biome = vec![HOME_BIOME; width as usize];
    for &(bi, sx, w) in &layout {
        for x in sx..(sx + w).min(width) {
            col_biome[x as usize] = bi;
        }
    }
    let col_floor: Vec<u32> = (0..width)
        .map(|x| floor_y_at(x, col_biome[x as usize], seed))
        .collect();

    let mut tiles = Vec::with_capacity((width * WORLD_HEIGHT) as usize);
    for y in 0..WORLD_HEIGHT {
        for x in 0..width {
            let bi = col_biome[x as usize];
            let biome = &BIOMES[bi];
            let floor = col_floor[x as usize];
            let (terrain, tag) = if y < WATER_SURFACE_Y {
                ("air", "")
            } else if y < floor {
                let deep_zone = biome.deep && y >= WATER_SURFACE_Y + (floor - WATER_SURFACE_Y) / 3;
                let near_floor = y + 5 >= floor;
                if y >= DEEP_WATER_Y && (deep_zone || near_floor) {
                    ("deepwater", biome.id)
                } else {
                    ("water", biome.id)
                }
            } else {
                let d = y - floor;
                let t = if d < 2 {
                    biome.top_terrain
                } else if d < 6 {
                    biome.mid_terrain
                } else {
                    biome.deep_terrain
                };
                (t, biome.id)
            };
            tiles.push(CivTile {
                x,
                y,
                terrain: terrain.to_string(),
                resource: None,
                amount: 0,
                biome: tag.to_string(),
            });
        }
    }

    // Resource belts: scatter each region's biome resources along its seabed.
    for &(bi, sx, w) in &layout {
        let biome = &BIOMES[bi];
        if biome.resources.is_empty() {
            continue;
        }
        let patches = 2 + w / 9;
        for p in 0..patches {
            let res =
                biome.resources[(p as usize + next_rng(&mut rng) as usize) % biome.resources.len()];
            let span = w.saturating_sub(4).max(1);
            let rx = (sx + 2 + next_rng(&mut rng) % span).min(width.saturating_sub(2));
            let fy = col_floor[rx as usize];
            let amount = 6 + (next_rng(&mut rng) % 12) as i32;
            place_resource_patch(&mut tiles, res, amount, rx.saturating_sub(1), fy, 3, 2);
        }
    }

    let regions: Vec<CivRegion> = layout
        .iter()
        .map(|&(bi, sx, w)| CivRegion {
            id: format!("region-{sx}"),
            name: BIOMES[bi].name.to_string(),
            biome: BIOMES[bi].id.to_string(),
            x: sx,
            y: WATER_SURFACE_Y,
            width: w,
            height: WORLD_HEIGHT - WATER_SURFACE_Y,
            owner: None,
        })
        .collect();

    let mut world = CivWorld {
        width,
        height: WORLD_HEIGHT,
        tiles,
        entities: Vec::new(),
        regions,
    };

    // Choose a spawn column per civ from the livable regions' centres (~8 of the
    // 14 biomes are livable). A lone civ settles in the region nearest the world
    // centre (matching the original centered colony). Multiple civs spread across
    // distinct livable regions; with more civs than regions they round-robin with
    // a per-lap offset so colonies never sit on the exact same column.
    let centers: Vec<u32> = layout
        .iter()
        .filter(|&&(bi, _, _)| BIOMES[bi].spawnable)
        .map(|&(_, sx, w)| sx + w / 2)
        .collect();
    let last_col = width.saturating_sub(2);
    for i in 0..civ_count {
        let spawn_x = if centers.is_empty() {
            ((u64::from(width) * (2 * u64::from(i) + 1)) / (2 * u64::from(civ_count))) as u32
        } else if civ_count == 1 {
            let mid = i64::from(width / 2);
            *centers
                .iter()
                .min_by_key(|&&c| (i64::from(c) - mid).abs())
                .unwrap_or(&centers[0])
        } else if (civ_count as usize) <= centers.len() {
            let idx = ((u64::from(i) * centers.len() as u64) / u64::from(civ_count)) as usize;
            centers[idx.min(centers.len() - 1)]
        } else {
            let idx = (i as usize) % centers.len();
            let lap = (i as usize) / centers.len();
            (centers[idx] + (lap as u32) * 6).min(last_col)
        };
        found_colony(&mut world, &mut rng, i as usize, spawn_x);
    }

    // Thread depth-banded ore veins through the substrate. MUST run AFTER the
    // found_colony loop so it consumes rng strictly after the founders — keeping
    // the founder draws (and the determinism tests) byte-stable.
    seed_underground_veins(&mut world.tiles, &col_floor, &col_biome, &mut rng, width);

    world
}

/// Threads short, depth-banded ore veins through the buried substrate: common
/// stone/clay shallow, ore/sulfur (and coral on reefs) mid, rare glowshards/amber
/// deep — deeper bands are rarer but richer. Adds NO tiles (only sets resource +
/// amount on existing substrate), so the tile count is unchanged. Deterministic
/// given the rng; must run after founders so the founder rng stays unperturbed.
fn seed_underground_veins(
    tiles: &mut [CivTile],
    col_floor: &[u32],
    col_biome: &[usize],
    rng: &mut u32,
    width: u32,
) {
    for x in 0..width {
        let floor = col_floor[x as usize];
        let biome = &BIOMES[col_biome[x as usize]];
        // Skip the top 2 substrate rows (reserved for surface belts/larders).
        let mut y = floor + 2;
        while y < WORLD_HEIGHT {
            let idx = (y * width + x) as usize;
            let d = y - floor;
            // Rarer with depth: shallow seeds often, deep seldom.
            let gate = if d < 8 {
                7
            } else if d < 18 {
                11
            } else {
                18
            };
            if next_rng(rng).is_multiple_of(gate)
                && idx < tiles.len()
                && is_substrate(&tiles[idx].terrain)
                && tiles[idx].resource.is_none()
            {
                let (res, base) = vein_for_depth(d, biome, rng);
                grow_vein(tiles, col_floor, width, (x, y), res, base, rng);
            }
            y += 1;
        }
    }
}

/// (resource, base amount) for a vein at depth `d` below the seabed in `biome`.
/// Deeper bands yield rarer, more valuable minerals in richer deposits.
fn vein_for_depth(d: u32, biome: &BiomeDef, rng: &mut u32) -> (&'static str, i32) {
    if d < 8 {
        let res = if next_rng(rng).is_multiple_of(2) {
            "stone"
        } else {
            "clay"
        };
        (res, 6 + (next_rng(rng) % 5) as i32)
    } else if d < 18 {
        let pool: &[&str] = if biome.id == "coralreef" {
            &["ore", "sulfur", "coral"]
        } else {
            &["ore", "sulfur"]
        };
        let res = pool[(next_rng(rng) as usize) % pool.len()];
        (res, 10 + (next_rng(rng) % 7) as i32)
    } else {
        let res = if next_rng(rng).is_multiple_of(2) {
            "glowshards"
        } else {
            "amber"
        };
        (res, 16 + (next_rng(rng) % 13) as i32)
    }
}

/// Walks a short (3-6 tile) vein of `res` from (sx, sy) through adjacent buried
/// substrate, staying at least 2 rows below each column's seabed.
fn grow_vein(
    tiles: &mut [CivTile],
    col_floor: &[u32],
    width: u32,
    start: (u32, u32),
    res: &str,
    base: i32,
    rng: &mut u32,
) {
    let len = 3 + next_rng(rng) % 4;
    let (mut x, mut y) = start;
    for _ in 0..len {
        let idx = (y * width + x) as usize;
        if idx < tiles.len() && is_substrate(&tiles[idx].terrain) {
            tiles[idx].resource = Some(res.to_string());
            tiles[idx].amount = (base + (next_rng(rng) % 4) as i32 - 1).max(1);
        }
        let (nx, ny) = match next_rng(rng) % 4 {
            0 => (x.saturating_sub(1), y),
            1 => ((x + 1).min(width.saturating_sub(1)), y),
            2 => (x, (y + 1).min(WORLD_HEIGHT - 1)),
            _ => (x, y.saturating_sub(1)),
        };
        // Stay buried (>= 2 rows below the neighbour column's seabed).
        if ny > col_floor[nx as usize] + 1 {
            x = nx;
            y = ny;
        }
    }
}

/// Plants one civ's founding colony near `spawn_x`: a starter larder, a pond
/// heart, a reed nest, and `INITIAL_POPULATION` axolotls — every entity tagged
/// with the civ id (ids are civ-scoped so colonies never collide) — and claims
/// the region containing the spawn. Shared by initial world gen and (W9)
/// add_civ_to_session.
fn found_colony(world: &mut CivWorld, rng: &mut u32, civ_index: usize, spawn_x: u32) {
    let civ_id = civ_id_for(civ_index);
    let width = world.width;
    let spawn_x = spawn_x.clamp(1, width.saturating_sub(2));
    let floor = seabed_row_at(world, spawn_x);

    // A dependable larder so every colony can eat from turn one.
    place_resource_patch(
        &mut world.tiles,
        "moss",
        16,
        spawn_x.saturating_sub(4),
        floor,
        5,
        2,
    );
    let reed_x = (spawn_x + 1).min(width.saturating_sub(2));
    let reed_floor = seabed_row_at(world, reed_x);
    place_resource_patch(&mut world.tiles, "wood", 12, reed_x, reed_floor, 3, 2);

    world.entities.push(CivEntity {
        id: format!("pond-heart-{civ_id}"),
        kind: "building".to_string(),
        name: "Pond Heart".to_string(),
        x: spawn_x,
        y: floor.saturating_sub(2),
        health: 100.0,
        mood: 100.0,
        role: "pond".to_string(),
        civ_id: Some(civ_id.clone()),
        ..Default::default()
    });
    let nest_x = spawn_x.saturating_sub(6).max(1);
    let nest_floor = seabed_row_at(world, nest_x);
    world.entities.push(CivEntity {
        id: format!("nest-{civ_id}"),
        kind: "building".to_string(),
        name: "Reed Nest".to_string(),
        x: nest_x,
        y: nest_floor.saturating_sub(1),
        health: 100.0,
        mood: 100.0,
        role: "nest".to_string(),
        civ_id: Some(civ_id.clone()),
        ..Default::default()
    });
    let breach_x = (nest_x + 3).min(width.saturating_sub(2));
    let breach_floor = seabed_row_at(world, breach_x);
    place_resource_patch(
        &mut world.tiles,
        "fiber",
        8,
        breach_x.saturating_sub(1),
        breach_floor,
        3,
        2,
    );
    world.entities.push(CivEntity {
        id: format!("breach-{civ_id}"),
        kind: "object".to_string(),
        name: "Nest Breach".to_string(),
        x: breach_x,
        y: breach_floor.saturating_sub(1),
        health: 35.0,
        mood: 0.0,
        role: "breach".to_string(),
        civ_id: Some(civ_id.clone()),
        activity: "needs_repair".to_string(),
        ..Default::default()
    });
    world.entities.push(CivEntity {
        id: format!("leak-{civ_id}"),
        kind: "object".to_string(),
        name: "Nest Leak".to_string(),
        x: (breach_x + 1).min(width.saturating_sub(2)),
        y: breach_floor.saturating_sub(1),
        health: 62.0,
        mood: 0.0,
        role: "leak".to_string(),
        civ_id: Some(civ_id.clone()),
        activity: "active".to_string(),
        ..Default::default()
    });

    let rescue_x = (spawn_x + 8).min(width.saturating_sub(2));
    let rescue_floor = seabed_row_at(world, rescue_x);
    let rescue_y = rescue_floor.saturating_sub(2).max(WATER_SURFACE_Y + 2);
    place_rescue_rubble(&mut world.tiles, rescue_x, rescue_y);
    world.entities.push(CivEntity {
        id: format!("trapped-{civ_id}"),
        kind: "object".to_string(),
        name: "Trapped Juvenile".to_string(),
        x: rescue_x,
        y: rescue_y,
        health: 45.0,
        mood: 12.0,
        role: "trapped".to_string(),
        civ_id: Some(civ_id.clone()),
        activity: "blocked".to_string(),
        ..Default::default()
    });
    world.entities.push(CivEntity {
        id: format!("oxygen-{civ_id}"),
        kind: "object".to_string(),
        name: "Low Oxygen Pocket".to_string(),
        x: rescue_x.saturating_sub(1),
        y: rescue_y,
        health: 70.0,
        mood: 0.0,
        role: "oxygen".to_string(),
        civ_id: Some(civ_id.clone()),
        activity: "active".to_string(),
        ..Default::default()
    });

    let bridge_x = (spawn_x + 14).min(width.saturating_sub(3)).max(2);
    let bridge_floor = seabed_row_at(world, bridge_x);
    let bridge_y = bridge_floor.saturating_sub(1).max(WATER_SURFACE_Y + 2);
    place_bridge_gap(&mut world.tiles, bridge_x, bridge_y);
    let pocket_x = (bridge_x + 4).min(width.saturating_sub(2));
    let pocket_floor = seabed_row_at(world, pocket_x);
    place_resource_patch(
        &mut world.tiles,
        "glowshards",
        5,
        pocket_x.saturating_sub(1),
        pocket_floor,
        2,
        1,
    );
    world.entities.push(CivEntity {
        id: format!("bridge-{civ_id}"),
        kind: "object".to_string(),
        name: "Bridge Gap".to_string(),
        x: bridge_x,
        y: bridge_y,
        health: 35.0,
        mood: 0.0,
        role: "bridge".to_string(),
        civ_id: Some(civ_id.clone()),
        activity: "open".to_string(),
        ..Default::default()
    });
    world.entities.push(CivEntity {
        id: format!("seep-{civ_id}"),
        kind: "object".to_string(),
        name: "Silt Vent".to_string(),
        x: (bridge_x + 2).min(width.saturating_sub(2)),
        y: bridge_y,
        health: 70.0,
        mood: 0.0,
        role: "seep".to_string(),
        civ_id: Some(civ_id.clone()),
        activity: "active".to_string(),
        ..Default::default()
    });

    for i in 0..INITIAL_POPULATION {
        // Each civ starts at a different point in the common palette so colonies
        // look distinct on the map.
        let morph = COMMON_MORPHS[(civ_index + i as usize) % COMMON_MORPHS.len()];
        let genes = random_genes(rng, morph);
        let sex = if i.is_multiple_of(2) { "f" } else { "m" };
        let age = 8 + (next_rng(rng) % 9);
        let x = (spawn_x as i32 - 6 + (i as i32 % 8) * 2).clamp(1, width as i32 - 2) as u32;
        let y = WATER_SURFACE_Y + 6 + (i % 5);
        let mut axolotl = make_axolotl(
            format!("axo-{civ_id}-{}", i + 1),
            format!("Axolotl {}", i + 1),
            x,
            y,
            sex,
            age,
            genes,
            82.0,
            76.0,
        );
        axolotl.civ_id = Some(civ_id.clone());
        if i == 1 {
            axolotl.role = "builder".to_string();
        } else if i == 6 {
            axolotl.role = "scout".to_string();
        }
        world.entities.push(axolotl);
    }

    if let Some(region) = world
        .regions
        .iter_mut()
        .find(|r| spawn_x >= r.x && spawn_x < r.x + r.width)
    {
        region.owner = Some(civ_id);
    }
}

/// Topmost substrate row in column `x` (seabed surface), or near the bottom if the
/// column is somehow all water.
fn seabed_row_at(world: &CivWorld, x: u32) -> u32 {
    world
        .tiles
        .iter()
        .filter(|t| t.x == x && is_substrate(&t.terrain))
        .map(|t| t.y)
        .min()
        .unwrap_or(WORLD_HEIGHT - 2)
}

fn is_substrate(terrain: &str) -> bool {
    !matches!(terrain, "air" | "water" | "deepwater")
}

/// Index of `civ_id` in `snapshot.civs`, if present.
fn civ_index(snapshot: &CivSessionSnapshot, civ_id: &str) -> Option<usize> {
    snapshot.civs.iter().position(|civ| civ.id == civ_id)
}

/// Iterator over the entities owned by `civ_id`.
fn civ_entities<'a>(
    snapshot: &'a CivSessionSnapshot,
    civ_id: &'a str,
) -> impl Iterator<Item = &'a CivEntity> {
    snapshot
        .world
        .entities
        .iter()
        .filter(move |e| e.civ_id.as_deref() == Some(civ_id))
}

fn civ_id_for(index: usize) -> String {
    format!("civ-{}", index + 1)
}

/// Human-readable label for a civ ("Civ 1" fallback), for log lines.
fn civ_label(snapshot: &CivSessionSnapshot, civ_id: &str) -> String {
    civ_index(snapshot, civ_id)
        .map(|ci| {
            let civ = &snapshot.civs[ci];
            if civ.name.trim().is_empty() {
                civ.id.clone()
            } else {
                civ.name.clone()
            }
        })
        .unwrap_or_else(|| civ_id.to_string())
}

/// The order living civs decide and act in this turn. Re-derived each turn from
/// `(seed, turn)` and Fisher–Yates shuffled, so the advantage of acting first —
/// which matters once civs race for the same finite mineral blocks (W10.1) — keeps
/// rotating instead of `civ-1` permanently winning. Deterministic for replay; skips
/// collapsed civs.
fn civ_turn_order(snapshot: &CivSessionSnapshot) -> Vec<String> {
    let mut order: Vec<String> = snapshot
        .civs
        .iter()
        .filter(|civ| civ.alive)
        .map(|civ| civ.id.clone())
        .collect();
    let mut rng = (snapshot.seed ^ snapshot.turn.wrapping_mul(0x9E37_79B9) ^ 0x51ED_2701).max(1);
    for i in (1..order.len()).rev() {
        let j = (next_rng(&mut rng) as usize) % (i + 1);
        order.swap(i, j);
    }
    order
}

/// The leaderboard value reported in `CivSessionMeta.score`: the strongest civ's
/// total score (0.0 when there are no civs).
fn leaderboard_score(civs: &[CivCivilization]) -> f32 {
    civs.iter().map(|c| c.score.total).fold(0.0_f32, f32::max)
}

/// Civ summaries sorted strongest-first, for the `TurnResolved` payload.
fn leaderboard(civs: &[CivCivilization]) -> Vec<serde_json::Value> {
    let mut ranked: Vec<&CivCivilization> = civs.iter().collect();
    ranked.sort_by(|a, b| {
        b.score
            .total
            .partial_cmp(&a.score.total)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    ranked
        .iter()
        .map(|civ| {
            serde_json::json!({
                "id": civ.id,
                "name": civ.name,
                "model": civ.model,
                "color": civ.color,
                "alive": civ.alive,
                "population": civ.population,
                "era": civ.era,
                "score": civ.score,
                "controller": civ.controller,
            })
        })
        .collect()
}

/// Re-score every civ in place.
fn rescore_all_civs(snapshot: &mut CivSessionSnapshot) {
    for i in 0..snapshot.civs.len() {
        let civ_id = snapshot.civs[i].id.clone();
        let score = score_civilization(snapshot, &civ_id);
        snapshot.civs[i].score = score;
    }
}

/// A civ collapses only when it has no living axolotls AND no pending eggs — eggs
/// can still hatch next turn and revive a zero-population colony (the original
/// engine had no `alive` gate and always ran the life cycle, so a colony with eggs
/// in the nest would recover).
fn should_collapse(snapshot: &CivSessionSnapshot, civ_id: &str) -> bool {
    let Some(ci) = civ_index(snapshot, civ_id) else {
        return false;
    };
    snapshot.civs[ci].population == 0 && !civ_entities(snapshot, civ_id).any(|e| e.kind == "egg")
}

/// Rough colony centre for `civ_id` — the pond heart, else the nest, else the mean
/// of its living axolotls, else its spawn column.
fn colony_center(snapshot: &CivSessionSnapshot, civ_id: &str) -> (u32, u32) {
    if let Some(p) = civ_entities(snapshot, civ_id).find(|e| e.role == "pond" || e.role == "nest") {
        return (p.x, p.y);
    }
    let axos: Vec<&CivEntity> = civ_entities(snapshot, civ_id)
        .filter(|e| e.kind == "axolotl" && e.stage != "egg")
        .collect();
    if axos.is_empty() {
        let spawn_x = civ_index(snapshot, civ_id)
            .map(|ci| snapshot.civs[ci].spawn_x)
            .unwrap_or(snapshot.world.width / 2);
        return (spawn_x, WATER_FLOOR_Y);
    }
    let sx: u32 = axos.iter().map(|e| e.x).sum();
    let sy: u32 = axos.iter().map(|e| e.y).sum();
    (sx / axos.len() as u32, sy / axos.len() as u32)
}

fn dist2(ax: u32, ay: u32, bx: u32, by: u32) -> u64 {
    let dx = ax as i64 - bx as i64;
    let dy = ay as i64 - by as i64;
    (dx * dx + dy * dy) as u64
}

/// Nearest gatherable tile of `resource` to `civ_id`'s colony, as a swim target
/// just above the seabed tile. `None` if no such resource exists right now.
fn nearest_resource_tile(
    snapshot: &CivSessionSnapshot,
    civ_id: &str,
    resource: &str,
) -> Option<(u32, u32)> {
    let (cx, cy) = colony_center(snapshot, civ_id);
    snapshot
        .world
        .tiles
        .iter()
        .filter(|t| t.amount > 0 && t.resource.as_deref() == Some(resource))
        .min_by_key(|t| dist2(t.x, t.y, cx, cy))
        .map(|t| (t.x, t.y.saturating_sub(1)))
}

/// Like `nearest_resource_tile` but returns the resource tile's own coordinates
/// (not the swim-target one row above), so mining can find and mutate the block.
fn nearest_resource_pos(
    snapshot: &CivSessionSnapshot,
    civ_id: &str,
    resource: &str,
) -> Option<(u32, u32)> {
    let (cx, cy) = colony_center(snapshot, civ_id);
    snapshot
        .world
        .tiles
        .iter()
        .filter(|t| t.amount > 0 && t.resource.as_deref() == Some(resource))
        .min_by_key(|t| dist2(t.x, t.y, cx, cy))
        .map(|t| (t.x, t.y))
}

/// Clears `civ_id`'s axolotls' per-turn activity so the next turn starts fresh.
fn reset_activities(snapshot: &mut CivSessionSnapshot, civ_id: &str) {
    for e in snapshot
        .world
        .entities
        .iter_mut()
        .filter(|e| e.kind == "axolotl" && e.civ_id.as_deref() == Some(civ_id))
    {
        e.activity.clear();
        e.target_x = None;
        e.target_y = None;
    }
}

/// Assigns up to `count` of `civ_id`'s currently-idle axolotls the given activity.
fn assign_activity(
    snapshot: &mut CivSessionSnapshot,
    civ_id: &str,
    count: usize,
    activity: &str,
    target: Option<(u32, u32)>,
) {
    let mut assigned = 0;
    for e in
        snapshot.world.entities.iter_mut().filter(|e| {
            e.kind == "axolotl" && e.stage != "egg" && e.civ_id.as_deref() == Some(civ_id)
        })
    {
        if assigned >= count {
            break;
        }
        if !e.activity.is_empty() {
            continue;
        }
        e.activity = activity.to_string();
        e.target_x = target.map(|(tx, _)| tx);
        e.target_y = target.map(|(_, ty)| ty);
        assigned += 1;
    }
}

fn place_resource_patch(
    tiles: &mut [CivTile],
    resource: &str,
    amount: i32,
    start_x: u32,
    start_y: u32,
    width: u32,
    height: u32,
) {
    for y in start_y..start_y.saturating_add(height).min(WORLD_HEIGHT) {
        // The x range is bounded by the small patch width and guarded by the
        // tile lookup below, so it works for any world width.
        for x in start_x..start_x.saturating_add(width) {
            if let Some(tile) = tiles.iter_mut().find(|tile| tile.x == x && tile.y == y) {
                if is_substrate(&tile.terrain) {
                    tile.resource = Some(resource.to_string());
                    tile.amount = amount;
                }
            }
        }
    }
}

fn rescue_rubble_tiles(x: u32, y: u32) -> Vec<(u32, u32)> {
    let shaft_x = x.saturating_sub(1);
    let shaft_top = y.saturating_sub(3).max(WATER_SURFACE_Y + 1);
    let mut tiles = Vec::new();
    for tile_y in shaft_top..=y {
        tiles.push((shaft_x, tile_y));
    }
    tiles.push((x, y + 1));
    tiles
}

fn place_rescue_rubble(tiles: &mut [CivTile], object_x: u32, object_y: u32) {
    for (x, y) in rescue_rubble_tiles(object_x, object_y) {
        if let Some(tile) = tiles.iter_mut().find(|tile| tile.x == x && tile.y == y) {
            if !is_substrate(&tile.terrain) {
                tile.terrain = "stone".to_string();
                tile.resource = None;
                tile.amount = 0;
            }
        }
    }
}

fn rescue_rubble_remaining(snapshot: &CivSessionSnapshot, object_id: &str) -> i32 {
    let Some(object) = snapshot
        .world
        .entities
        .iter()
        .find(|entity| entity.id == object_id)
    else {
        return 1;
    };
    if object.activity == "rescued" {
        return 0;
    }
    rescue_rubble_tiles(object.x, object.y)
        .into_iter()
        .filter(|(x, y)| {
            snapshot
                .world
                .tiles
                .iter()
                .any(|tile| tile.x == *x && tile.y == *y && is_substrate(&tile.terrain))
        })
        .count() as i32
}

fn bridge_tiles(x: u32, y: u32) -> [(u32, u32); 3] {
    [
        (x.saturating_sub(1), y.saturating_add(1)),
        (x, y.saturating_add(1)),
        (x.saturating_add(1), y.saturating_add(1)),
    ]
}

fn place_bridge_gap(tiles: &mut [CivTile], marker_x: u32, marker_y: u32) {
    for (x, y) in bridge_tiles(marker_x, marker_y) {
        if let Some(tile) = tiles.iter_mut().find(|tile| tile.x == x && tile.y == y) {
            tile.terrain = if y >= DEEP_WATER_Y {
                "deepwater"
            } else {
                "water"
            }
            .to_string();
            tile.resource = None;
            tile.amount = 0;
        }
    }
}

fn bridge_tiles_remaining(snapshot: &CivSessionSnapshot, object_id: &str) -> i32 {
    let Some(object) = snapshot
        .world
        .entities
        .iter()
        .find(|entity| entity.id == object_id)
    else {
        return 1;
    };
    if object.activity == "built" {
        return 0;
    }
    bridge_tiles(object.x, object.y)
        .iter()
        .filter(|(x, y)| {
            snapshot
                .world
                .tiles
                .iter()
                .any(|tile| tile.x == *x && tile.y == *y && !is_substrate(&tile.terrain))
        })
        .count() as i32
}

fn celebrate_npc_at(
    snapshot: &mut CivSessionSnapshot,
    npc_id: &str,
    target: Option<(u32, u32)>,
    mood_boost: f32,
) -> Option<String> {
    snapshot
        .world
        .entities
        .iter_mut()
        .find(|entity| entity.id == npc_id && entity.kind == "axolotl")
        .map(|npc| {
            npc.mood = (npc.mood + mood_boost).min(100.0);
            npc.activity = "celebrate".to_string();
            npc.target_x = target.map(|(x, _)| x);
            npc.target_y = target.map(|(_, y)| y);
            npc.name.clone()
        })
}

fn spawn_rescued_juvenile(
    snapshot: &mut CivSessionSnapshot,
    civ_id: Option<String>,
    object_id: &str,
    object_x: u32,
    object_y: u32,
) -> bool {
    let rescued_id = format!("rescued-{object_id}");
    if snapshot
        .world
        .entities
        .iter()
        .any(|entity| entity.id == rescued_id)
    {
        return false;
    }
    let spawn_x = object_x
        .saturating_add(1)
        .min(snapshot.world.width.saturating_sub(1));
    let spawn_y = object_y.min(snapshot.world.height.saturating_sub(1));
    let mut juvenile = make_axolotl(
        rescued_id,
        "Rescued Juvenile".to_string(),
        spawn_x,
        spawn_y,
        "f",
        4,
        default_genes(),
        100.0,
        96.0,
    );
    juvenile.civ_id = civ_id;
    juvenile.activity = "rescued".to_string();
    juvenile.target_x = Some(object_x);
    juvenile.target_y = Some(object_y);
    snapshot.world.entities.push(juvenile);
    true
}

fn seal_nearby_seeps(snapshot: &mut CivSessionSnapshot, x: u32, y: u32) {
    for entity in &mut snapshot.world.entities {
        if entity.kind == "object"
            && entity.role == "seep"
            && entity.activity != "sealed"
            && entity.x.abs_diff(x) <= 4
            && entity.y.abs_diff(y) <= 3
        {
            entity.activity = "sealed".to_string();
            entity.health = 100.0;
        }
    }
}

fn seal_nearby_leaks(snapshot: &mut CivSessionSnapshot, x: u32, y: u32) {
    for entity in &mut snapshot.world.entities {
        if entity.kind == "object"
            && entity.role == "leak"
            && entity.activity != "sealed"
            && entity.x.abs_diff(x) <= 3
            && entity.y.abs_diff(y) <= 3
        {
            entity.activity = "sealed".to_string();
            entity.health = 100.0;
        }
    }
}

fn build_observation(snapshot: &CivSessionSnapshot, civ_id: &str) -> serde_json::Value {
    let Some(ci) = civ_index(snapshot, civ_id) else {
        return serde_json::json!({});
    };
    let civ = &snapshot.civs[ci];

    let mut resource_tiles: HashMap<String, i32> = HashMap::new();
    for tile in &snapshot.world.tiles {
        if let Some(resource) = &tile.resource {
            *resource_tiles.entry(resource.clone()).or_insert(0) += tile.amount.max(0);
        }
    }

    let rivals: Vec<serde_json::Value> = snapshot
        .civs
        .iter()
        .filter(|other| other.id != civ_id)
        .map(|other| {
            serde_json::json!({
                "id": other.id,
                "name": other.name,
                "model": other.model,
                "alive": other.alive,
                "population": other.population,
                "score": other.score.total,
                "stance": civ.diplomacy.get(&other.id).cloned().unwrap_or_else(|| "neutral".to_string()),
            })
        })
        .collect();

    serde_json::json!({
        "civ_id": civ.id,
        "turn": snapshot.turn,
        "era": civ.era,
        "population": civ.population,
        "health": civ.health,
        "morale": civ.morale,
        "resources": civ.resources,
        "techs": civ.techs,
        "policies": civ.policies,
        "active_modifiers": snapshot.modifiers,
        "season": snapshot.environment.season,
        "temperature": snapshot.environment.temperature,
        "forecast": snapshot.environment.forecast,
        "rivals": rivals,
        "visible_world": {
            "width": snapshot.world.width,
            "height": snapshot.world.height,
            "resource_tiles": resource_tiles,
            "biome_regions": snapshot.world.regions.iter()
                .map(|region| serde_json::json!({
                    "name": region.name,
                    "biome": region.biome,
                    "x": region.x,
                    "width": region.width,
                    "owner": region.owner,
                }))
                .collect::<Vec<_>>(),
            "buildings": civ_entities(snapshot, civ_id)
                .filter(|entity| entity.kind == "building")
                .map(|entity| serde_json::json!({
                    "id": entity.id,
                    "name": entity.name,
                    "x": entity.x,
                    "y": entity.y,
                    "role": entity.role,
                }))
                .collect::<Vec<_>>(),
        },
        "recent_events": snapshot.log.iter().rev().take(6).collect::<Vec<_>>(),
        "score": civ.score,
    })
}

fn build_decision_prompt(observation: &serde_json::Value) -> String {
    format!(
        "You are governing a small pixel axolotl civilization in Xolotl Civilization Lab.\n\
         Your colony lives on a large aquatic continent of distinct biome regions (see visible_world.biome_regions); exploring reaches new biomes with different resources.\n\
         Rival civilizations may share this world (see rivals); optimize for survival, fairness, sustainability, cooperation, and thoughtful progress.\n\
         Return ONLY strict JSON with this shape:\n\
         {{\"intent\":\"short plan\",\"public_rationale\":\"why this helps\",\"actions\":[{{\"type\":\"gather\",\"resource\":\"food\",\"workers\":2}}],\"ethics_note\":\"moral tradeoff note\",\"expected_risks\":[\"risk\"]}}\n\
         Allowed action types:\n\
         - gather: resource one of food, clean_water, wood, stone, clay, fiber, tools, glowshards, kelp, ore, ice, coral, sulfur, amber, herbs; workers 1-8. Mining ore/sulfur/coral needs stone_tools; glowshards/amber need metal_tools.\n\
         - build: building one of nest, storage, farm, workshop, canal; x/y inside world\n\
         - research: tech_id one of moss_farm, stone_tools, water_filter, council, workshop_craft, canal_network, metal_tools\n\
         - explore: direction left, right, or down\n\
         - policy: policy one of ration, share_equally, protect_vulnerable, conserve_water, push_growth\n\
         - prepare: event_id matching an active or expected crisis\n\
         Use at most 3 actions.\n\n\
         OBSERVATION JSON:\n{}",
        serde_json::to_string_pretty(observation).unwrap_or_else(|_| "{}".to_string())
    )
}

fn build_repair_prompt(previous: &str, error: &str) -> String {
    format!(
        "Your previous civilization decision was invalid JSON or did not match the required shape.\n\
         Error: {error}\n\
         Return ONLY corrected strict JSON. No markdown. No commentary.\n\
         Previous response:\n{previous}"
    )
}

fn parse_model_decision(raw: &str) -> Result<CivModelDecision, String> {
    let json = extract_json_object(raw).ok_or_else(|| "no JSON object found".to_string())?;
    let decision: CivModelDecision = serde_json::from_str(json).map_err(|e| e.to_string())?;
    if decision.intent.trim().is_empty() {
        return Err("intent is required".to_string());
    }
    if decision.actions.len() > 3 {
        return Err("decision has more than 3 actions".to_string());
    }
    for action in &decision.actions {
        validate_action(action)?;
    }
    Ok(decision)
}

fn extract_json_object(raw: &str) -> Option<&str> {
    let trimmed = raw.trim();
    if trimmed.starts_with('{') && trimmed.ends_with('}') {
        return Some(trimmed);
    }
    let start = raw.find('{')?;
    let end = raw.rfind('}')?;
    if end <= start {
        None
    } else {
        Some(&raw[start..=end])
    }
}

fn validate_action(action: &CivDecisionAction) -> Result<(), String> {
    match action.action_type.as_str() {
        "gather" => {
            let resource = action
                .resource
                .as_deref()
                .ok_or("gather.resource is required")?;
            if !known_resource(resource) {
                return Err(format!("unknown resource: {resource}"));
            }
            let workers = action.workers.unwrap_or(0);
            if workers == 0 || workers > INITIAL_POPULATION {
                return Err("gather.workers must be 1-8".to_string());
            }
        }
        "build" => {
            let building = action
                .building
                .as_deref()
                .ok_or("build.building is required")?;
            if !matches!(building, "nest" | "storage" | "farm" | "workshop" | "canal") {
                return Err(format!("unknown building: {building}"));
            }
        }
        "research" => {
            let tech = action
                .tech_id
                .as_deref()
                .ok_or("research.tech_id is required")?;
            if !known_tech(tech) {
                return Err(format!("unknown tech: {tech}"));
            }
        }
        "explore" => {
            let direction = action
                .direction
                .as_deref()
                .ok_or("explore.direction is required")?;
            if !matches!(direction, "left" | "right" | "down") {
                return Err(format!("unknown direction: {direction}"));
            }
        }
        "policy" => {
            let policy = action
                .policy
                .as_deref()
                .ok_or("policy.policy is required")?;
            if !matches!(
                policy,
                "ration"
                    | "share_equally"
                    | "protect_vulnerable"
                    | "conserve_water"
                    | "push_growth"
            ) {
                return Err(format!("unknown policy: {policy}"));
            }
        }
        "prepare" => {
            if action
                .event_id
                .as_deref()
                .unwrap_or_default()
                .trim()
                .is_empty()
            {
                return Err("prepare.event_id is required".to_string());
            }
        }
        other => return Err(format!("unknown action type: {other}")),
    }
    Ok(())
}

fn apply_model_decision(
    snapshot: &mut CivSessionSnapshot,
    civ_id: &str,
    decision: &CivModelDecision,
    reasoning: Option<String>,
) {
    reset_activities(snapshot, civ_id);
    push_decision_log(
        snapshot,
        civ_id,
        &decision.intent,
        &decision.public_rationale,
        &decision.ethics_note,
        reasoning,
    );

    for action in &decision.actions {
        match action.action_type.as_str() {
            "gather" => gather(snapshot, civ_id, action),
            "build" => build(snapshot, civ_id, action),
            "research" => research(snapshot, civ_id, action),
            "explore" => explore(snapshot, civ_id, action),
            "policy" => policy(snapshot, civ_id, action),
            "prepare" => prepare(snapshot, civ_id, action),
            _ => {}
        }
    }
}

fn gather(snapshot: &mut CivSessionSnapshot, civ_id: &str, action: &CivDecisionAction) {
    let Some(ci) = civ_index(snapshot, civ_id) else {
        return;
    };
    let Some(resource) = action.resource.as_deref() else {
        return;
    };
    let workers = action
        .workers
        .unwrap_or(1)
        .clamp(1, snapshot.civs[ci].population.max(1));
    let mut rate = (workers as i32) * 3;
    if has_modifier(snapshot, "abundant_moss") && matches!(resource, "food" | "fiber") {
        rate += workers as i32;
    }
    if has_modifier(snapshot, "drought") && resource == "clean_water" {
        rate = (rate / 2).max(1);
    }
    if resource == "tools" || resource == "glowshards" {
        rate = (rate / 2).max(1);
    }
    // Send the gatherers to swim toward the matching resource and work it.
    let tile_resource = if resource == "food" { "moss" } else { resource };
    let target = nearest_resource_tile(snapshot, civ_id, tile_resource);
    assign_activity(snapshot, civ_id, workers as usize, "gather", target);

    // Finite minerals are MINED from a block: yield is capped by what the block
    // holds, the block depletes, and an emptied block floods to water (terraform).
    // Renewables keep their flat yield so colonies never hard-stall on local scarcity.
    let mined;
    let mut dug_out = false;
    let mut blocked = false;
    if !is_finite_mineral(resource) {
        // Renewables (food/water/wood/fiber/kelp/herbs) keep a flat yield so
        // colonies never hard-stall on local scarcity.
        mined = rate;
    } else if required_mining_tier(resource) > mining_tier(&snapshot.civs[ci]) {
        // The colony lacks the tools to work this mineral yet.
        mined = 0;
        blocked = true;
    } else if let Some((tx, ty)) = nearest_resource_pos(snapshot, civ_id, tile_resource) {
        // Mining BELOW the seabed surface carves a flooded void; mining a surface
        // block just strips the ore so the seabed stays solid + buildable (keeps
        // seabed_row_at stable, so default building placement can't fall into a
        // dug-out crater).
        let surface = seabed_row_at(&snapshot.world, tx);
        if let Some(tile) = snapshot
            .world
            .tiles
            .iter_mut()
            .find(|t| t.x == tx && t.y == ty)
        {
            mined = rate.min(tile.amount.max(0));
            tile.amount = (tile.amount - mined).max(0);
            if tile.amount == 0 {
                tile.resource = None;
                if ty > surface + 1 {
                    tile.terrain = if ty >= DEEP_WATER_Y {
                        "deepwater"
                    } else {
                        "water"
                    }
                    .to_string();
                    dug_out = true;
                }
            }
        } else {
            mined = 0;
        }
    } else {
        mined = 0;
    }

    if blocked {
        snapshot.civs[ci].morale = (snapshot.civs[ci].morale - 1.0).max(0.0);
        push_log(
            snapshot,
            "blocked_action",
            "Need better tools",
            &format!(
                "Mining {resource} needs better tools — research stone_tools, then metal_tools."
            ),
        );
        return;
    }

    if mined > 0 {
        *snapshot.civs[ci]
            .resources
            .entry(resource.to_string())
            .or_insert(0) += mined;
    }
    push_log(
        snapshot,
        "action",
        "Gathered resources",
        &format!("{workers} workers gathered {mined} {resource}."),
    );
    if dug_out {
        push_log(
            snapshot,
            "terraform",
            "A block was dug out",
            &format!("Mining exhausted a {resource} block; water rushed in to fill the void."),
        );
    }
}

fn build(snapshot: &mut CivSessionSnapshot, civ_id: &str, action: &CivDecisionAction) {
    let Some(ci) = civ_index(snapshot, civ_id) else {
        return;
    };
    let Some(building) = action.building.as_deref() else {
        return;
    };
    let costs = building_cost(building);
    if !can_pay(&snapshot.civs[ci].resources, &costs) {
        push_log(
            snapshot,
            "blocked_action",
            "Build failed",
            &format!("The colony lacked materials for a {building}."),
        );
        let Some(ci) = civ_index(snapshot, civ_id) else {
            return;
        };
        snapshot.civs[ci].morale = (snapshot.civs[ci].morale - 2.0).max(0.0);
        return;
    }
    pay(&mut snapshot.civs[ci].resources, &costs);
    let default_x = colony_center(snapshot, civ_id).0;
    let x = action
        .x
        .unwrap_or(default_x)
        .min(snapshot.world.width.saturating_sub(1));
    // Buildings rest on the seabed unless the model pinned an explicit row.
    let y = match action.y {
        Some(y) => y.min(snapshot.world.height.saturating_sub(1)),
        None => seabed_row_at(&snapshot.world, x).saturating_sub(1),
    };
    let entity_id = format!(
        "building-{}-{}",
        building,
        snapshot.world.entities.len() + 1
    );
    snapshot.world.entities.push(CivEntity {
        id: entity_id,
        kind: "building".to_string(),
        name: title_case(building),
        x,
        y,
        health: 100.0,
        mood: 100.0,
        role: building.to_string(),
        civ_id: Some(civ_id.to_string()),
        ..Default::default()
    });
    // Builders converge on the new site.
    assign_activity(snapshot, civ_id, 2, "build", Some((x, y.saturating_sub(1))));
    push_log(
        snapshot,
        "action",
        "Built structure",
        &format!("The colony built a {building} at {x},{y}."),
    );
}

fn research(snapshot: &mut CivSessionSnapshot, civ_id: &str, action: &CivDecisionAction) {
    let Some(ci) = civ_index(snapshot, civ_id) else {
        return;
    };
    let Some(tech) = action.tech_id.as_deref() else {
        return;
    };
    if snapshot.civs[ci].techs.iter().any(|item| item == tech) {
        push_log(
            snapshot,
            "blocked_action",
            "Research already known",
            &format!("{tech} was already unlocked."),
        );
        return;
    }
    let costs = tech_cost(tech);
    if !can_pay(&snapshot.civs[ci].resources, &costs) {
        push_log(
            snapshot,
            "blocked_action",
            "Research stalled",
            &format!("The colony lacked materials to research {tech}."),
        );
        return;
    }
    pay(&mut snapshot.civs[ci].resources, &costs);
    snapshot.civs[ci].techs.push(tech.to_string());
    advance_era_if_ready(snapshot, civ_id);
    push_log(
        snapshot,
        "action",
        "Technology unlocked",
        &format!("The colony learned {tech}."),
    );
}

fn explore(snapshot: &mut CivSessionSnapshot, civ_id: &str, action: &CivDecisionAction) {
    let direction = action.direction.as_deref().unwrap_or("right");
    let mut rng = snapshot.seed ^ snapshot.turn.wrapping_mul(0x9e37_79b9);
    let (cx, _) = colony_center(snapshot, civ_id);
    let width = snapshot.world.width;
    let x = match direction {
        "left" => cx.saturating_sub(14 + next_rng(&mut rng) % 18).max(2),
        "right" => (cx + 14 + next_rng(&mut rng) % 18).min(width.saturating_sub(3)),
        // "down" = range wide across the continent looking for deep finds.
        _ => 6 + next_rng(&mut rng) % width.saturating_sub(12),
    };
    let fy = seabed_row_at(&snapshot.world, x);
    let resource = match next_rng(&mut rng) % 5 {
        0 => "glowshards",
        1 => "stone",
        2 => "clay",
        3 => "fiber",
        _ => "wood",
    };
    place_resource_patch(
        &mut snapshot.world.tiles,
        resource,
        8,
        x.saturating_sub(1),
        fy,
        3,
        2,
    );
    assign_activity(
        snapshot,
        civ_id,
        2,
        "explore",
        Some((x, fy.saturating_sub(2))),
    );
    push_log(
        snapshot,
        "action",
        "Exploration found materials",
        &format!("Explorers swam {direction} and uncovered {resource}."),
    );
}

fn policy(snapshot: &mut CivSessionSnapshot, civ_id: &str, action: &CivDecisionAction) {
    let Some(ci) = civ_index(snapshot, civ_id) else {
        return;
    };
    let Some(policy) = action.policy.as_deref() else {
        return;
    };
    if !snapshot.civs[ci].policies.iter().any(|item| item == policy) {
        snapshot.civs[ci].policies.push(policy.to_string());
    }
    match policy {
        "share_equally" | "protect_vulnerable" => {
            snapshot.civs[ci].morale = (snapshot.civs[ci].morale + 3.0).min(100.0);
        }
        "conserve_water" | "ration" => {
            *snapshot.civs[ci]
                .resources
                .entry("clean_water".to_string())
                .or_insert(0) += 2;
        }
        "push_growth" => {
            snapshot.civs[ci].morale = (snapshot.civs[ci].morale + 1.0).min(100.0);
        }
        _ => {}
    }
    push_log(
        snapshot,
        "action",
        "Policy adopted",
        &format!("The colony adopted {policy}."),
    );
}

fn prepare(snapshot: &mut CivSessionSnapshot, civ_id: &str, action: &CivDecisionAction) {
    let Some(ci) = civ_index(snapshot, civ_id) else {
        return;
    };
    let event = action.event_id.as_deref().unwrap_or("uncertain event");
    snapshot.civs[ci].morale = (snapshot.civs[ci].morale + 1.5).min(100.0);
    *snapshot.civs[ci]
        .resources
        .entry("tools".to_string())
        .or_insert(0) += 1;
    push_log(
        snapshot,
        "action",
        "Prepared for risk",
        &format!("The colony prepared for {event}."),
    );
}

fn resolve_environment(snapshot: &mut CivSessionSnapshot, civ_id: &str) {
    let Some(ci) = civ_index(snapshot, civ_id) else {
        return;
    };
    let population = snapshot.civs[ci].population as i32;
    let food_need = population;
    let water_need = population;
    let food_short = consume(&mut snapshot.civs[ci].resources, "food", food_need);
    let water_short = consume(&mut snapshot.civs[ci].resources, "clean_water", water_need);

    if food_short > 0 || water_short > 0 {
        let penalty = ((food_short + water_short) as f32) * 1.5;
        snapshot.civs[ci].health = (snapshot.civs[ci].health - penalty).max(0.0);
        snapshot.civs[ci].morale = (snapshot.civs[ci].morale - penalty * 0.8).max(0.0);
        push_log(
            snapshot,
            "crisis",
            "Shortage hurt the colony",
            &format!("Shortage this turn: {food_short} food, {water_short} clean water."),
        );
    } else {
        snapshot.civs[ci].health = (snapshot.civs[ci].health + 1.2).min(100.0);
        snapshot.civs[ci].morale = (snapshot.civs[ci].morale + 0.8).min(100.0);
    }

    // Global modifiers act on this civ. Their per-turn countdown is ticked once,
    // after every civ has resolved (see `tick_modifiers`).
    let modifiers = snapshot.modifiers.clone();
    for modifier in modifiers {
        match modifier.kind.as_str() {
            "drought" => {
                consume(&mut snapshot.civs[ci].resources, "clean_water", 2);
                snapshot.civs[ci].health =
                    (snapshot.civs[ci].health - 0.8 * modifier.intensity).max(0.0);
            }
            "cold_snap" => {
                snapshot.civs[ci].morale =
                    (snapshot.civs[ci].morale - 1.0 * modifier.intensity).max(0.0);
            }
            "food_rot" => {
                consume(&mut snapshot.civs[ci].resources, "food", 3);
            }
            "fatigue" => {
                snapshot.civs[ci].morale =
                    (snapshot.civs[ci].morale - 1.2 * modifier.intensity).max(0.0);
            }
            "quarrel_pressure" => {
                snapshot.civs[ci].morale =
                    (snapshot.civs[ci].morale - 1.5 * modifier.intensity).max(0.0);
            }
            "abundant_moss" => {
                *snapshot.civs[ci]
                    .resources
                    .entry("food".to_string())
                    .or_insert(0) += 3;
            }
            "clear_water" => {
                *snapshot.civs[ci]
                    .resources
                    .entry("clean_water".to_string())
                    .or_insert(0) += 3;
            }
            "cooperation_aura" => {
                snapshot.civs[ci].morale =
                    (snapshot.civs[ci].morale + 1.5 * modifier.intensity).min(100.0);
            }
            "curiosity_spark" => {
                *snapshot.civs[ci]
                    .resources
                    .entry("glowshards".to_string())
                    .or_insert(0) += 1;
            }
            _ => {}
        }
    }

    run_life_cycle(snapshot, civ_id);
}

/// Counts down the global modifiers once per turn and retires expired ones. Called
/// after every civ has resolved its environment so a modifier acts on all civs the
/// same number of turns regardless of civ count.
fn tick_modifiers(snapshot: &mut CivSessionSnapshot) {
    for modifier in snapshot.modifiers.iter_mut() {
        modifier.remaining_turns = modifier.remaining_turns.saturating_sub(1);
    }
    snapshot
        .modifiers
        .retain(|modifier| modifier.remaining_turns > 0);
}

/// Ages `civ_id`'s axolotls, hatches its eggs, lets healthy adults breed near a
/// nest, and keeps that civ's `population` in sync with its living (non-egg)
/// axolotls. Runs every turn regardless of the model decision.
fn run_life_cycle(snapshot: &mut CivSessionSnapshot, civ_id: &str) {
    let Some(ci) = civ_index(snapshot, civ_id) else {
        return;
    };
    let mut rng = snapshot.seed ^ snapshot.turn.wrapping_mul(0x9E37_79B9) ^ 0x5A5A_5A5A;
    let health = snapshot.civs[ci].health;
    let morale = snapshot.civs[ci].morale;

    // 1) Age living axolotls; refresh stage/size/role; sync vitals; elder passing.
    let mut deaths: Vec<String> = Vec::new();
    for entity in snapshot
        .world
        .entities
        .iter_mut()
        .filter(|e| e.kind == "axolotl" && e.civ_id.as_deref() == Some(civ_id))
    {
        let longevity = entity.genes.as_ref().map_or(1.0, |g| g.longevity);
        let size_gene = entity.genes.as_ref().map_or(1.0, |g| g.size_gene);
        entity.age = entity.age.saturating_add(1);
        entity.stage = stage_for_age(entity.age, longevity);
        entity.size = size_for_stage(&entity.stage, size_gene);
        entity.role = role_for_stage(&entity.stage);
        entity.health = health;
        entity.mood = morale;
        // Idle young play; idle elders rest. Working axolotls keep their activity.
        if entity.activity.is_empty() {
            entity.activity = match entity.stage.as_str() {
                "hatchling" | "juvenile" => "play".to_string(),
                "elder" => "rest".to_string(),
                _ => String::new(),
            };
        }
        let elder_at = (ELDER_BASE_AGE * longevity) as u32;
        if entity.stage == "elder" && entity.age > elder_at + 6 && rand_f(&mut rng) < 0.35 {
            deaths.push(entity.id.clone());
        }
    }
    for id in &deaths {
        push_log(
            snapshot,
            "lifecycle",
            "An elder passed on",
            &format!("An elder axolotl returned to the pond after a long life ({id})."),
        );
    }
    if !deaths.is_empty() {
        snapshot.world.entities.retain(|e| !deaths.contains(&e.id));
    }

    // 2) Hatch eggs whose timer elapsed.
    let mut hatched = 0u32;
    for entity in snapshot
        .world
        .entities
        .iter_mut()
        .filter(|e| e.kind == "egg" && e.civ_id.as_deref() == Some(civ_id))
    {
        let rem = entity.hatches_in.unwrap_or(0);
        if rem > 1 {
            entity.hatches_in = Some(rem - 1);
            continue;
        }
        let genes = entity.genes.clone().unwrap_or_else(default_genes);
        entity.kind = "axolotl".to_string();
        entity.hatches_in = None;
        entity.age = 0;
        entity.stage = "hatchling".to_string();
        entity.morph = expressed_morph(&genes);
        entity.sex = if rand_f(&mut rng) < 0.5 { "f" } else { "m" }.to_string();
        entity.size = size_for_stage("hatchling", genes.size_gene);
        entity.role = "juvenile".to_string();
        entity.name = format!("Hatchling {}", short_id(&entity.id));
        entity.health = health;
        entity.mood = morale;
        entity.activity = "play".to_string();
        entity.genes = Some(genes);
        hatched += 1;
    }
    if hatched > 0 {
        push_log(
            snapshot,
            "lifecycle",
            "Eggs hatched",
            &format!("{hatched} egg(s) hatched into wriggling hatchlings."),
        );
    }

    // 3) Procreation: healthy adult pairs lay eggs near a nest.
    let nests = civ_entities(snapshot, civ_id)
        .filter(|e| e.kind == "building" && e.role == "nest")
        .count();
    let living = civ_entities(snapshot, civ_id)
        .filter(|e| e.kind == "axolotl" && e.stage != "egg")
        .count() as u32;
    let egg_count = civ_entities(snapshot, civ_id)
        .filter(|e| e.kind == "egg")
        .count() as u32;
    let capacity = 8 + nests as u32 * 6;
    let food = *snapshot.civs[ci].resources.get("food").unwrap_or(&0);
    let can_breed = nests > 0
        && health > 60.0
        && morale > 56.0
        && living + egg_count < capacity
        && food > living as i32 * 2;

    if can_breed {
        let adults: Vec<(String, String, CivGenes)> = civ_entities(snapshot, civ_id)
            .filter(|e| e.kind == "axolotl" && e.stage == "adult")
            .filter_map(|e| e.genes.clone().map(|g| (e.id.clone(), e.sex.clone(), g)))
            .collect();
        let females: Vec<&(String, String, CivGenes)> =
            adults.iter().filter(|a| a.1 == "f").collect();
        let males: Vec<&(String, String, CivGenes)> =
            adults.iter().filter(|a| a.1 == "m").collect();
        let nest = nest_pos(snapshot, civ_id).unwrap_or((20, WATER_FLOOR_Y - 1));
        let mut new_eggs: Vec<CivEntity> = Vec::new();
        if !females.is_empty() && !males.is_empty() {
            let max_eggs = if rand_f(&mut rng) < 0.4 { 2 } else { 1 };
            for female in &females {
                if new_eggs.len() >= max_eggs {
                    break;
                }
                if rand_f(&mut rng) < 0.55 * female.2.fertility {
                    let male = males[(next_rng(&mut rng) as usize) % males.len()];
                    let child = cross_genes(&female.2, &male.2, &mut rng);
                    let n = new_eggs.len() as u32;
                    new_eggs.push(CivEntity {
                        id: format!("egg-{}-{}-{}", civ_id, snapshot.turn, n),
                        kind: "egg".to_string(),
                        name: "Egg".to_string(),
                        x: (nest.0 + n).min(snapshot.world.width.saturating_sub(1)),
                        y: nest.1,
                        health: 100.0,
                        mood: 100.0,
                        role: "egg".to_string(),
                        civ_id: Some(civ_id.to_string()),
                        morph: expressed_morph(&child),
                        stage: "egg".to_string(),
                        sex: String::new(),
                        age: 0,
                        size: 0.5,
                        accessories: Vec::new(),
                        genes: Some(child),
                        hatches_in: Some(EGG_HATCH_TURNS),
                        parents: vec![female.0.clone(), male.0.clone()],
                        activity: "egg".to_string(),
                        target_x: None,
                        target_y: None,
                    });
                }
            }
        }
        let laid = new_eggs.len();
        snapshot.world.entities.extend(new_eggs);
        if laid > 0 {
            push_log(
                snapshot,
                "lifecycle",
                "New eggs were laid",
                &format!("The colony tended {laid} fresh egg(s) in the nest."),
            );
        }
    }

    // 4) Population mirrors the living (non-egg) axolotls of this civ.
    let pop = civ_entities(snapshot, civ_id)
        .filter(|e| e.kind == "axolotl" && e.stage != "egg")
        .count() as u32;
    if let Some(ci) = civ_index(snapshot, civ_id) {
        snapshot.civs[ci].population = pop;
    }
}

/// Which civ a resource grant/removal targets. An explicit `civ_id` must name an
/// existing civ (else an error); absent, fall back to the first living civ (or the
/// first civ if all have collapsed). `None` only when the session has no civs.
fn intervention_target_civ(
    snapshot: &CivSessionSnapshot,
    civ_id: Option<&str>,
) -> Result<Option<usize>, String> {
    match civ_id {
        Some(cid) => civ_index(snapshot, cid)
            .map(Some)
            .ok_or_else(|| format!("unknown civ: {cid}")),
        None if snapshot.civs.is_empty() => Ok(None),
        None => Ok(Some(
            snapshot.civs.iter().position(|c| c.alive).unwrap_or(0),
        )),
    }
}

fn apply_intervention_to_snapshot(
    snapshot: &mut CivSessionSnapshot,
    intervention: &CivIntervention,
) -> Result<(), String> {
    // Resource-targeted interventions act on `civ_id` (W3), defaulting to the first
    // living civ. Modifier/accessory/positional interventions ignore the target.
    let target_ci = intervention_target_civ(snapshot, intervention.civ_id.as_deref())?;
    match intervention.kind.as_str() {
        "grant_resource" => {
            if !known_resource(&intervention.target) {
                return Err(format!("unknown resource: {}", intervention.target));
            }
            let ci = target_ci.ok_or("no civilization in session")?;
            let amount = intervention.amount.unwrap_or(10).max(1);
            *snapshot.civs[ci]
                .resources
                .entry(intervention.target.clone())
                .or_insert(0) += amount;
            let who = civ_label(snapshot, &snapshot.civs[ci].id.clone());
            push_log(
                snapshot,
                "intervention",
                "Resource granted",
                &format!(
                    "Observer granted {amount} {} to {who}.",
                    intervention.target
                ),
            );
        }
        "remove_resource" => {
            if !known_resource(&intervention.target) {
                return Err(format!("unknown resource: {}", intervention.target));
            }
            let ci = target_ci.ok_or("no civilization in session")?;
            let amount = intervention.amount.unwrap_or(10).max(1);
            let entry = snapshot.civs[ci]
                .resources
                .entry(intervention.target.clone())
                .or_insert(0);
            *entry = (*entry - amount).max(0);
            let who = civ_label(snapshot, &snapshot.civs[ci].id.clone());
            push_log(
                snapshot,
                "intervention",
                "Resource removed",
                &format!(
                    "Observer removed {amount} {} from {who}.",
                    intervention.target
                ),
            );
        }
        "spawn_resource" => {
            if !known_resource(&intervention.target) {
                return Err(format!("unknown resource: {}", intervention.target));
            }
            let width = snapshot.world.width;
            let x = intervention
                .x
                .unwrap_or(width / 2)
                .min(width.saturating_sub(1));
            let requested_y = intervention
                .y
                .unwrap_or(WATER_FLOOR_Y)
                .min(WORLD_HEIGHT - 1);
            // Snap onto the seabed so spawned resources never float in open water.
            let on_substrate = snapshot
                .world
                .tiles
                .iter()
                .any(|t| t.x == x && t.y == requested_y && is_substrate(&t.terrain));
            let y = if on_substrate {
                requested_y
            } else {
                seabed_row_at(&snapshot.world, x)
            };
            let amount = intervention.amount.unwrap_or(8).max(1);
            place_resource_patch(
                &mut snapshot.world.tiles,
                &intervention.target,
                amount,
                x.saturating_sub(1),
                y,
                3,
                2,
            );
            push_log(
                snapshot,
                "intervention",
                "Resource patch spawned",
                &format!("Observer spawned {} near {x},{y}.", intervention.target),
            );
        }
        "harvest_resource" => {
            let ci = target_ci.ok_or("no civilization in session")?;
            let x = intervention.x.ok_or("x is required for harvest_resource")?;
            let y = intervention.y.ok_or("y is required for harvest_resource")?;
            let tile_idx = snapshot
                .world
                .tiles
                .iter()
                .position(|tile| tile.x == x && tile.y == y)
                .ok_or("harvest tile not found")?;
            let tile_resource = snapshot.world.tiles[tile_idx]
                .resource
                .clone()
                .ok_or("harvest tile has no resource")?;
            let gained_resource = harvest_yield_resource(&tile_resource)
                .ok_or_else(|| format!("unknown harvest resource: {tile_resource}"))?
                .to_string();
            if !intervention.target.is_empty()
                && intervention.target != tile_resource
                && intervention.target != gained_resource
            {
                return Err(format!(
                    "harvest target {} does not match tile resource {tile_resource}",
                    intervention.target
                ));
            }
            let requested = intervention.amount.unwrap_or(1).max(1);
            let harvested = {
                let tile = &mut snapshot.world.tiles[tile_idx];
                let harvested = requested.min(tile.amount.max(0));
                if harvested <= 0 {
                    return Err("harvest tile is depleted".to_string());
                }
                tile.amount = (tile.amount - harvested).max(0);
                if tile.amount == 0 {
                    tile.resource = None;
                }
                harvested
            };
            *snapshot.civs[ci]
                .resources
                .entry(gained_resource.clone())
                .or_insert(0) += harvested;
            if let Some(eid) = intervention.entity_id.as_deref() {
                if let Some(entity) = snapshot
                    .world
                    .entities
                    .iter_mut()
                    .find(|entity| entity.id == eid && entity.kind == "axolotl")
                {
                    entity.activity = "player_gather".to_string();
                    entity.target_x = Some(x);
                    entity.target_y = Some(y.saturating_sub(1));
                }
            }
            let who = civ_label(snapshot, &snapshot.civs[ci].id.clone());
            push_log(
                snapshot,
                "intervention",
                "Resource harvested",
                &format!(
                    "Player harvested {harvested} {gained_resource} from {tile_resource} near {x},{y} for {who}."
                ),
            );
        }
        "mine_tile" => {
            let ci = target_ci.ok_or("no civilization in session")?;
            let x = intervention.x.ok_or("x is required for mine_tile")?;
            let y = intervention.y.ok_or("y is required for mine_tile")?;
            let tile_idx = snapshot
                .world
                .tiles
                .iter()
                .position(|tile| tile.x == x && tile.y == y)
                .ok_or("mine tile not found")?;
            if !is_substrate(&snapshot.world.tiles[tile_idx].terrain) {
                return Err("only substrate tiles can be mined".to_string());
            }
            let terrain = snapshot.world.tiles[tile_idx].terrain.clone();
            let gained_resource = snapshot.world.tiles[tile_idx]
                .resource
                .as_deref()
                .and_then(harvest_yield_resource)
                .map(str::to_string)
                .unwrap_or_else(|| terrain_yield_resource(&terrain).to_string());
            let terrain_after = if y >= DEEP_WATER_Y {
                "deepwater"
            } else {
                "water"
            }
            .to_string();
            {
                let tile = &mut snapshot.world.tiles[tile_idx];
                tile.terrain = terrain_after;
                tile.resource = None;
                tile.amount = 0;
            }
            *snapshot.civs[ci]
                .resources
                .entry(gained_resource.clone())
                .or_insert(0) += 1;
            if let Some(eid) = intervention.entity_id.as_deref() {
                if let Some(entity) = snapshot
                    .world
                    .entities
                    .iter_mut()
                    .find(|entity| entity.id == eid && entity.kind == "axolotl")
                {
                    entity.activity = "player_mine".to_string();
                    entity.target_x = Some(x);
                    entity.target_y = Some(y);
                }
            }
            let who = civ_label(snapshot, &snapshot.civs[ci].id.clone());
            push_log(
                snapshot,
                "player",
                "Tile mined",
                &format!("Player mined {terrain} at {x},{y} for 1 {gained_resource} for {who}."),
            );
        }
        "place_tile" => {
            let ci = target_ci.ok_or("no civilization in session")?;
            if !placeable_build_resource(&intervention.target) {
                return Err(format!(
                    "{} cannot be placed as terrain",
                    intervention.target
                ));
            }
            let x = intervention.x.ok_or("x is required for place_tile")?;
            let y = intervention.y.ok_or("y is required for place_tile")?;
            let tile_idx = snapshot
                .world
                .tiles
                .iter()
                .position(|tile| tile.x == x && tile.y == y)
                .ok_or("place tile not found")?;
            if is_substrate(&snapshot.world.tiles[tile_idx].terrain) {
                return Err("cannot place terrain over substrate".to_string());
            }
            if snapshot
                .world
                .entities
                .iter()
                .any(|entity| entity.x == x && entity.y == y && entity.kind == "building")
            {
                return Err("cannot place terrain on a building".to_string());
            }
            let available = snapshot.civs[ci]
                .resources
                .get(&intervention.target)
                .copied()
                .unwrap_or(0);
            if available <= 0 {
                return Err(format!("not enough {} to place", intervention.target));
            }
            if let Some(entry) = snapshot.civs[ci].resources.get_mut(&intervention.target) {
                *entry = (*entry - 1).max(0);
            }
            let terrain = place_terrain_for_resource(&intervention.target).to_string();
            {
                let tile = &mut snapshot.world.tiles[tile_idx];
                tile.terrain = terrain.clone();
                tile.resource = None;
                tile.amount = 0;
            }
            if let Some(eid) = intervention.entity_id.as_deref() {
                if let Some(entity) = snapshot
                    .world
                    .entities
                    .iter_mut()
                    .find(|entity| entity.id == eid && entity.kind == "axolotl")
                {
                    entity.activity = "player_build".to_string();
                    entity.target_x = Some(x);
                    entity.target_y = Some(y);
                }
            }
            let who = civ_label(snapshot, &snapshot.civs[ci].id.clone());
            push_log(
                snapshot,
                "player",
                "Tile placed",
                &format!(
                    "Player placed {terrain} at {x},{y} using 1 {} for {who}.",
                    intervention.target
                ),
            );
            if let Some(task) = active_player_task(snapshot) {
                if task.kind == "build_bridge" {
                    let remaining = bridge_tiles_remaining(snapshot, &task.object_id);
                    if remaining <= 0 {
                        snapshot.civs[ci].morale = (snapshot.civs[ci].morale + 3.0).min(100.0);
                        snapshot.civs[ci].health = (snapshot.civs[ci].health + 0.8).min(100.0);
                        *snapshot.civs[ci]
                            .resources
                            .entry("glowshards".to_string())
                            .or_insert(0) += 1;
                        let object_update = snapshot
                            .world
                            .entities
                            .iter_mut()
                            .find(|entity| entity.id == task.object_id && entity.kind == "object")
                            .map(|object| {
                                object.health = 100.0;
                                object.activity = "built".to_string();
                                (object.name.clone(), object.x, object.y)
                            });
                        let target = object_update.as_ref().map(|(_, x, y)| (*x, *y));
                        if let Some((x, y)) = target {
                            seal_nearby_seeps(snapshot, x, y);
                        }
                        let object_name = object_update
                            .map(|(name, _, _)| name)
                            .unwrap_or_else(|| "the bridge".to_string());
                        let npc_name = celebrate_npc_at(snapshot, &task.npc_id, target, 6.0)
                            .unwrap_or_else(|| "the builder".to_string());
                        push_log(
                            snapshot,
                            "player",
                            "Task complete",
                            &format!(
                                "target={}; Built {object_name} for {npc_name}. The resource pocket is reachable and the silt vent is sealed; task=build_bridge; npc={}; object={}; resource={}; source={}; amount={}; baseline={}; reward={};",
                                task.object_id,
                                task.npc_id,
                                task.object_id,
                                task.resource,
                                task.source,
                                task.amount,
                                task.baseline,
                                task.reward,
                            ),
                        );
                    }
                }
            }
        }
        "repair_object" => {
            let ci = target_ci.ok_or("no civilization in session")?;
            let eid = intervention
                .entity_id
                .as_deref()
                .ok_or("entity_id is required for repair_object")?;
            let object_idx = snapshot
                .world
                .entities
                .iter()
                .position(|entity| entity.id == eid && entity.kind == "object")
                .ok_or("object not found")?;
            if let Some(cid) = intervention.civ_id.as_deref() {
                if snapshot.world.entities[object_idx]
                    .civ_id
                    .as_deref()
                    .is_some_and(|owner| owner != cid)
                {
                    return Err(format!("{eid} does not belong to {cid}"));
                }
            }
            let task = active_player_task(snapshot).ok_or("no active repair task")?;
            if task.kind != "repair_object" || task.object_id != eid {
                return Err("object is not the active repair target".to_string());
            }
            let have = snapshot.civs[ci]
                .resources
                .get(&task.resource)
                .copied()
                .unwrap_or(0);
            let required = task.baseline + task.amount;
            if have < required {
                return Err(format!(
                    "need {} more {} before repair",
                    required - have,
                    task.resource
                ));
            }
            if let Some(entry) = snapshot.civs[ci].resources.get_mut(&task.resource) {
                *entry = (*entry - task.amount).max(0);
            }
            snapshot.civs[ci].morale = (snapshot.civs[ci].morale + 3.0).min(100.0);
            snapshot.civs[ci].health = (snapshot.civs[ci].health + 1.2).min(100.0);
            *snapshot.civs[ci]
                .resources
                .entry("clean_water".to_string())
                .or_insert(0) += 1;
            let (object_name, object_x, object_y) = {
                let object = &mut snapshot.world.entities[object_idx];
                object.health = 100.0;
                object.activity = "repaired".to_string();
                (object.name.clone(), object.x, object.y)
            };
            seal_nearby_leaks(snapshot, object_x, object_y);
            let npc_name =
                celebrate_npc_at(snapshot, &task.npc_id, Some((object_x, object_y)), 6.0)
                    .unwrap_or_else(|| "the requester".to_string());
            push_log(
                snapshot,
                "player",
                "Task complete",
                &format!(
                    "target={}; Repaired {object_name} for {npc_name}. The nest leak is sealed and the nest is safe again; task=repair_object; npc={}; object={}; resource={}; source={}; amount={}; baseline={}; reward={};",
                    task.object_id,
                    task.npc_id,
                    task.object_id,
                    task.resource,
                    task.source,
                    task.amount,
                    task.baseline,
                    task.reward,
                ),
            );
        }
        "rescue_object" => {
            let ci = target_ci.ok_or("no civilization in session")?;
            let eid = intervention
                .entity_id
                .as_deref()
                .ok_or("entity_id is required for rescue_object")?;
            let object_idx = snapshot
                .world
                .entities
                .iter()
                .position(|entity| entity.id == eid && entity.kind == "object")
                .ok_or("object not found")?;
            if let Some(cid) = intervention.civ_id.as_deref() {
                if snapshot.world.entities[object_idx]
                    .civ_id
                    .as_deref()
                    .is_some_and(|owner| owner != cid)
                {
                    return Err(format!("{eid} does not belong to {cid}"));
                }
            }
            let task = active_player_task(snapshot).ok_or("no active rescue task")?;
            if task.kind != "rescue_object" || task.object_id != eid {
                return Err("object is not the active rescue target".to_string());
            }
            let remaining = rescue_rubble_remaining(snapshot, eid);
            if remaining > 0 {
                return Err(format!("clear {remaining} more rubble before rescue"));
            }
            snapshot.civs[ci].morale = (snapshot.civs[ci].morale + 4.0).min(100.0);
            snapshot.civs[ci].health = (snapshot.civs[ci].health + 1.0).min(100.0);
            let object_civ_id = snapshot.world.entities[object_idx]
                .civ_id
                .clone()
                .or_else(|| snapshot.civs.get(ci).map(|civ| civ.id.clone()));
            let (object_name, object_x, object_y) = {
                let object = &mut snapshot.world.entities[object_idx];
                object.health = 100.0;
                object.mood = 100.0;
                object.activity = "rescued".to_string();
                (object.name.clone(), object.x, object.y)
            };
            if spawn_rescued_juvenile(snapshot, object_civ_id, &task.object_id, object_x, object_y)
            {
                snapshot.civs[ci].population = snapshot.civs[ci].population.saturating_add(1);
            }
            let npc_name =
                celebrate_npc_at(snapshot, &task.npc_id, Some((object_x, object_y)), 7.0)
                    .unwrap_or_else(|| "the scout".to_string());
            push_log(
                snapshot,
                "player",
                    "Task complete",
                    &format!(
                    "target={}; Rescued {object_name} for {npc_name}. The blocked path is clear and the low-oxygen pocket is behind you; task=rescue_object; npc={}; object={}; resource={}; source={}; amount={}; baseline={}; reward={};",
                    task.object_id,
                    task.npc_id,
                    task.object_id,
                    task.resource,
                    task.source,
                    task.amount,
                    task.baseline,
                    task.reward,
                ),
            );
        }
        "move_entity" => {
            let eid = intervention
                .entity_id
                .as_deref()
                .ok_or("entity_id is required for move_entity")?;
            let x = intervention
                .x
                .ok_or("x is required for move_entity")?
                .min(snapshot.world.width.saturating_sub(1));
            let y = intervention
                .y
                .ok_or("y is required for move_entity")?
                .min(snapshot.world.height.saturating_sub(1));
            let entity = snapshot
                .world
                .entities
                .iter_mut()
                .find(|entity| entity.id == eid && entity.kind == "axolotl")
                .ok_or("axolotl not found")?;
            if let Some(cid) = intervention.civ_id.as_deref() {
                if entity.civ_id.as_deref().is_some_and(|owner| owner != cid) {
                    return Err(format!("{eid} does not belong to {cid}"));
                }
            }
            entity.x = x;
            entity.y = y;
            entity.activity = "player".to_string();
            entity.target_x = None;
            entity.target_y = None;
        }
        "talk_entity" => {
            let ci = target_ci.ok_or("no civilization in session")?;
            let eid = intervention
                .entity_id
                .as_deref()
                .ok_or("entity_id is required for talk_entity")?;
            let entity_idx = snapshot
                .world
                .entities
                .iter()
                .position(|entity| entity.id == eid && entity.kind == "axolotl")
                .ok_or("axolotl not found")?;
            if let Some(cid) = intervention.civ_id.as_deref() {
                if snapshot.world.entities[entity_idx]
                    .civ_id
                    .as_deref()
                    .is_some_and(|owner| owner != cid)
                {
                    return Err(format!("{eid} does not belong to {cid}"));
                }
            }
            if let Some(task) = active_player_task(snapshot) {
                if task.npc_id == eid {
                    if task.kind == "repair_object" {
                        if !player_target_used_this_turn(snapshot, "Task pending", eid) {
                            let have = snapshot.civs[ci]
                                .resources
                                .get(&task.resource)
                                .copied()
                                .unwrap_or(0);
                            let required = task.baseline + task.amount;
                            let object_name = snapshot
                                .world
                                .entities
                                .iter()
                                .find(|entity| entity.id == task.object_id)
                                .map(|entity| entity.name.clone())
                                .unwrap_or_else(|| "the damaged site".to_string());
                            let ename = snapshot.world.entities[entity_idx].name.clone();
                            snapshot.world.entities[entity_idx].activity = "waiting".to_string();
                            let body = if have >= required {
                                format!(
                                    "target={}; {ename} says {object_name} is ready to repair. Patch it to seal the nest leak; task=repair_object; npc={}; object={}; resource={}; source={}; amount={}; baseline={}; reward={};",
                                    task.npc_id,
                                    task.npc_id,
                                    task.object_id,
                                    task.resource,
                                    task.source,
                                    task.amount,
                                    task.baseline,
                                    task.reward,
                                )
                            } else {
                                format!(
                                    "target={}; {ename} still needs {} more {} before repairing {object_name}. The nest leak clouds the work site; gather {} and return; task=repair_object; npc={}; object={}; resource={}; source={}; amount={}; baseline={}; reward={};",
                                    task.npc_id,
                                    required - have,
                                    task.resource,
                                    task.source,
                                    task.npc_id,
                                    task.object_id,
                                    task.resource,
                                    task.source,
                                    task.amount,
                                    task.baseline,
                                    task.reward,
                                )
                            };
                            push_log(snapshot, "player", "Task pending", &body);
                        }
                        return Ok(());
                    }
                    if task.kind == "rescue_object" {
                        if !player_target_used_this_turn(snapshot, "Task pending", eid) {
                            let remaining = rescue_rubble_remaining(snapshot, &task.object_id);
                            let object_name = snapshot
                                .world
                                .entities
                                .iter()
                                .find(|entity| entity.id == task.object_id)
                                .map(|entity| entity.name.clone())
                                .unwrap_or_else(|| "the trapped axolotl".to_string());
                            let ename = snapshot.world.entities[entity_idx].name.clone();
                            snapshot.world.entities[entity_idx].activity = "waiting".to_string();
                            let body = if remaining <= 0 {
                                format!(
                                    "target={}; {ename} says {object_name} is reachable. Watch your oxygen in the pocket; task=rescue_object; npc={}; object={}; resource={}; source={}; amount={}; baseline={}; reward={};",
                                    task.npc_id,
                                    task.npc_id,
                                    task.object_id,
                                    task.resource,
                                    task.source,
                                    task.amount,
                                    task.baseline,
                                    task.reward,
                                )
                            } else {
                                format!(
                                    "target={}; {ename} needs {remaining} more rubble cleared near {object_name}. The pocket drains oxygen, so retreat if it gets low; task=rescue_object; npc={}; object={}; resource={}; source={}; amount={}; baseline={}; reward={};",
                                    task.npc_id,
                                    task.npc_id,
                                    task.object_id,
                                    task.resource,
                                    task.source,
                                    task.amount,
                                    task.baseline,
                                    task.reward,
                                )
                            };
                            push_log(snapshot, "player", "Task pending", &body);
                        }
                        return Ok(());
                    }
                    if task.kind == "build_bridge" {
                        if !player_target_used_this_turn(snapshot, "Task pending", eid) {
                            let remaining = bridge_tiles_remaining(snapshot, &task.object_id);
                            let object_name = snapshot
                                .world
                                .entities
                                .iter()
                                .find(|entity| entity.id == task.object_id)
                                .map(|entity| entity.name.clone())
                                .unwrap_or_else(|| "the bridge gap".to_string());
                            let ename = snapshot.world.entities[entity_idx].name.clone();
                            snapshot.world.entities[entity_idx].activity = "waiting".to_string();
                            let body = if remaining <= 0 {
                                format!(
                                    "target={}; {ename} says {object_name} is bridged and the silt vent is sealed; task=build_bridge; npc={}; object={}; resource={}; source={}; amount={}; baseline={}; reward={};",
                                    task.npc_id,
                                    task.npc_id,
                                    task.object_id,
                                    task.resource,
                                    task.source,
                                    task.amount,
                                    task.baseline,
                                    task.reward,
                                )
                            } else {
                                format!(
                                    "target={}; {ename} needs {remaining} more bridge tile{} placed at {object_name}. Work through the silt plume before it is sealed; task=build_bridge; npc={}; object={}; resource={}; source={}; amount={}; baseline={}; reward={};",
                                    task.npc_id,
                                    if remaining == 1 { "" } else { "s" },
                                    task.npc_id,
                                    task.object_id,
                                    task.resource,
                                    task.source,
                                    task.amount,
                                    task.baseline,
                                    task.reward,
                                )
                            };
                            push_log(snapshot, "player", "Task pending", &body);
                        }
                        return Ok(());
                    }
                    if task.kind == "visit_building" {
                        if !player_target_used_this_turn(snapshot, "Task pending", eid) {
                            let building_name = snapshot
                                .world
                                .entities
                                .iter()
                                .find(|entity| entity.id == task.building_id)
                                .map(|entity| entity.name.clone())
                                .unwrap_or_else(|| "the target building".to_string());
                            let ename = snapshot.world.entities[entity_idx].name.clone();
                            snapshot.world.entities[entity_idx].activity = "waiting".to_string();
                            push_log(
                                snapshot,
                                "player",
                                "Task pending",
                                &format!(
                                    "target={}; {ename} wants you to check {building_name}; task=visit_building; npc={}; building={}; reward={};",
                                    task.npc_id,
                                    task.npc_id,
                                    task.building_id,
                                    task.reward,
                                ),
                            );
                        }
                        return Ok(());
                    }
                    let have = snapshot.civs[ci]
                        .resources
                        .get(&task.resource)
                        .copied()
                        .unwrap_or(0);
                    let required = task.baseline + task.amount;
                    let ename = snapshot.world.entities[entity_idx].name.clone();
                    if have >= required {
                        if let Some(entry) = snapshot.civs[ci].resources.get_mut(&task.resource) {
                            *entry = (*entry - task.amount).max(0);
                        }
                        if task.kind == "trade_resource" && !task.reward_resource.is_empty() {
                            *snapshot.civs[ci]
                                .resources
                                .entry(task.reward_resource.clone())
                                .or_insert(0) += task.reward_amount.max(1);
                            snapshot.civs[ci].morale = (snapshot.civs[ci].morale + 1.0).min(100.0);
                        } else {
                            snapshot.civs[ci].morale = (snapshot.civs[ci].morale + 2.0).min(100.0);
                        }
                        let entity = &mut snapshot.world.entities[entity_idx];
                        entity.mood = (entity.mood
                            + if task.kind == "trade_resource" {
                                4.0
                            } else {
                                6.0
                            })
                        .min(100.0);
                        entity.activity = "celebrate".to_string();
                        let body = if task.kind == "trade_resource" {
                            format!(
                                "target={}; Traded {} {} with {ename} for {} {}; task=trade_resource; npc={}; resource={}; source={}; amount={}; baseline={}; reward={}; reward_resource={}; reward_amount={};",
                                task.npc_id,
                                task.amount,
                                task.resource,
                                task.reward_amount.max(1),
                                task.reward_resource,
                                task.npc_id,
                                task.resource,
                                task.source,
                                task.amount,
                                task.baseline,
                                task.reward,
                                task.reward_resource,
                                task.reward_amount.max(1),
                            )
                        } else {
                            format!(
                                "target={}; Delivered {} {} to {ename}. The pond feels more coordinated; task=fetch_resource; npc={}; resource={}; source={}; amount={}; baseline={}; reward={};",
                                task.npc_id,
                                task.amount,
                                task.resource,
                                task.npc_id,
                                task.resource,
                                task.source,
                                task.amount,
                                task.baseline,
                                task.reward,
                            )
                        };
                        push_log(snapshot, "player", "Task complete", &body);
                    } else if !player_target_used_this_turn(snapshot, "Task pending", eid) {
                        let remaining = required - have;
                        snapshot.world.entities[entity_idx].activity = "waiting".to_string();
                        let verb = if task.kind == "trade_resource" {
                            "bring"
                        } else {
                            "gather"
                        };
                        push_log(
                            snapshot,
                            "player",
                            "Task pending",
                            &format!(
                                "target={}; {ename} still needs {remaining} more {}. {verb} {} and return; task={}; npc={}; resource={}; source={}; amount={}; baseline={}; reward={}; reward_resource={}; reward_amount={};",
                                task.npc_id,
                                task.resource,
                                task.source,
                                task.kind,
                                task.npc_id,
                                task.resource,
                                task.source,
                                task.amount,
                                task.baseline,
                                task.reward,
                                task.reward_resource,
                                task.reward_amount,
                            ),
                        );
                    }
                    return Ok(());
                }

                if player_target_used_this_turn(snapshot, "Conversation", eid) {
                    return Ok(());
                }
                let ename = snapshot.world.entities[entity_idx].name.clone();
                let requester = snapshot
                    .world
                    .entities
                    .iter()
                    .find(|entity| entity.id == task.npc_id)
                    .map(|entity| entity.name.clone())
                    .unwrap_or_else(|| "the requester".to_string());
                let entity = &mut snapshot.world.entities[entity_idx];
                entity.mood = (entity.mood + 1.0).min(100.0);
                entity.activity = "socialize".to_string();
                push_log(
                    snapshot,
                    "player",
                    "Conversation",
                    &format!("target={eid}; {ename} points you back to {requester}'s request.",),
                );
                return Ok(());
            }

            if player_target_used_this_turn(snapshot, "NPC request", eid) {
                return Ok(());
            }
            let task = task_for_npc(
                snapshot,
                &snapshot.world.entities[entity_idx],
                &snapshot.civs[ci],
            );
            let entity = &mut snapshot.world.entities[entity_idx];
            entity.mood = (entity.mood + 4.0).min(100.0);
            entity.activity = "socialize".to_string();
            let ename = entity.name.clone();
            snapshot.civs[ci].morale = (snapshot.civs[ci].morale + 1.0).min(100.0);
            let body = match task.kind.as_str() {
                "trade_resource" => format!(
                    "target={}; {ename} offers {} {} for {} {}; task=trade_resource; npc={}; resource={}; source={}; amount={}; baseline={}; reward={}; reward_resource={}; reward_amount={};",
                    task.npc_id,
                    task.reward_amount.max(1),
                    task.reward_resource,
                    task.amount,
                    task.resource,
                    task.npc_id,
                    task.resource,
                    task.source,
                    task.amount,
                    task.baseline,
                    task.reward,
                    task.reward_resource,
                    task.reward_amount.max(1),
                ),
                "visit_building" => {
                    let building_name = snapshot
                        .world
                        .entities
                        .iter()
                        .find(|building| building.id == task.building_id)
                        .map(|building| building.name.clone())
                        .unwrap_or_else(|| "the building".to_string());
                    format!(
                        "target={}; {ename} asks you to check {building_name}; task=visit_building; npc={}; building={}; reward={};",
                        task.npc_id,
                        task.npc_id,
                        task.building_id,
                        task.reward,
                    )
                }
                "repair_object" => {
                    let object_name = snapshot
                        .world
                        .entities
                        .iter()
                        .find(|object| object.id == task.object_id)
                        .map(|object| object.name.clone())
                        .unwrap_or_else(|| "the damaged site".to_string());
                    format!(
                        "target={}; {ename} asks you to repair {object_name}. Gather {} {} and fix it; a nest leak slows the repair site until sealed; task=repair_object; npc={}; object={}; resource={}; source={}; amount={}; baseline={}; reward={};",
                        task.npc_id,
                        task.amount,
                        task.resource,
                        task.npc_id,
                        task.object_id,
                        task.resource,
                        task.source,
                        task.amount,
                        task.baseline,
                        task.reward,
                    )
                }
                "rescue_object" => {
                    let object_name = snapshot
                        .world
                        .entities
                        .iter()
                        .find(|object| object.id == task.object_id)
                        .map(|object| object.name.clone())
                        .unwrap_or_else(|| "the trapped axolotl".to_string());
                    format!(
                        "target={}; {ename} asks you to rescue {object_name}. Mine {} rubble tiles around the marker; the pocket drains oxygen, so retreat when low; task=rescue_object; npc={}; object={}; resource={}; source={}; amount={}; baseline={}; reward={};",
                        task.npc_id,
                        task.amount,
                        task.npc_id,
                        task.object_id,
                        task.resource,
                        task.source,
                        task.amount,
                        task.baseline,
                        task.reward,
                    )
                }
                "build_bridge" => {
                    let object_name = snapshot
                        .world
                        .entities
                        .iter()
                        .find(|object| object.id == task.object_id)
                        .map(|object| object.name.clone())
                        .unwrap_or_else(|| "the bridge gap".to_string());
                    format!(
                        "target={}; {ename} asks you to build {object_name}. Place {} bridge tile{} using {}; a silt vent slows the crossing until the bridge is sealed; task=build_bridge; npc={}; object={}; resource={}; source={}; amount={}; baseline={}; reward={};",
                        task.npc_id,
                        task.amount,
                        if task.amount == 1 { "" } else { "s" },
                        task.resource,
                        task.npc_id,
                        task.object_id,
                        task.resource,
                        task.source,
                        task.amount,
                        task.baseline,
                        task.reward,
                    )
                }
                _ => format!(
                    "target={}; {ename} asks for {} {}. Gather {} and return; task=fetch_resource; npc={}; resource={}; source={}; amount={}; baseline={}; reward={};",
                    task.npc_id,
                    task.amount,
                    task.resource,
                    task.source,
                    task.npc_id,
                    task.resource,
                    task.source,
                    task.amount,
                    task.baseline,
                    task.reward,
                ),
            };
            push_log(snapshot, "player", "NPC request", &body);
        }
        "use_building" => {
            let ci = target_ci.ok_or("no civilization in session")?;
            let eid = intervention
                .entity_id
                .as_deref()
                .ok_or("entity_id is required for use_building")?;
            let building_idx = snapshot
                .world
                .entities
                .iter()
                .position(|entity| entity.id == eid && entity.kind == "building")
                .ok_or("building not found")?;
            if let Some(cid) = intervention.civ_id.as_deref() {
                if snapshot.world.entities[building_idx]
                    .civ_id
                    .as_deref()
                    .is_some_and(|owner| owner != cid)
                {
                    return Err(format!("{eid} does not belong to {cid}"));
                }
            }
            if let Some(task) = active_player_task(snapshot) {
                if task.kind == "visit_building" && task.building_id == eid {
                    let building = &snapshot.world.entities[building_idx];
                    let name = building.name.clone();
                    let role = building.role.clone();
                    snapshot.civs[ci].morale = (snapshot.civs[ci].morale + 2.0).min(100.0);
                    snapshot.civs[ci].health = (snapshot.civs[ci].health + 0.8).min(100.0);
                    if role == "pond" {
                        *snapshot.civs[ci]
                            .resources
                            .entry("clean_water".to_string())
                            .or_insert(0) += 1;
                    }
                    if let Some(npc) = snapshot
                        .world
                        .entities
                        .iter_mut()
                        .find(|entity| entity.id == task.npc_id && entity.kind == "axolotl")
                    {
                        npc.mood = (npc.mood + 5.0).min(100.0);
                        npc.activity = "celebrate".to_string();
                    }
                    push_log(
                        snapshot,
                        "player",
                        "Task complete",
                        &format!(
                            "target={}; Checked {name} for the requester. The {role} feels tended; task=visit_building; npc={}; building={}; reward={};",
                            task.building_id,
                            task.npc_id,
                            task.building_id,
                            task.reward,
                        ),
                    );
                    return Ok(());
                }
            }
            if player_target_used_this_turn(snapshot, "Building used", eid) {
                return Ok(());
            }
            let building = &snapshot.world.entities[building_idx];
            let role = building.role.clone();
            let name = building.name.clone();
            match role.as_str() {
                "pond" => {
                    *snapshot.civs[ci]
                        .resources
                        .entry("clean_water".to_string())
                        .or_insert(0) += 1;
                    snapshot.civs[ci].health = (snapshot.civs[ci].health + 0.6).min(100.0);
                }
                "nest" => {
                    snapshot.civs[ci].morale = (snapshot.civs[ci].morale + 1.0).min(100.0);
                }
                "farm" => {
                    *snapshot.civs[ci]
                        .resources
                        .entry("food".to_string())
                        .or_insert(0) += 1;
                }
                "workshop" => {
                    *snapshot.civs[ci]
                        .resources
                        .entry("tools".to_string())
                        .or_insert(0) += 1;
                }
                "storage" => {
                    *snapshot.civs[ci]
                        .resources
                        .entry("fiber".to_string())
                        .or_insert(0) += 1;
                }
                _ => {
                    snapshot.civs[ci].morale = (snapshot.civs[ci].morale + 0.4).min(100.0);
                }
            }
            push_log(
                snapshot,
                "player",
                "Building used",
                &format!("target={eid}; The player used {name}; the {role} helped the colony."),
            );
        }
        "trigger_event" | "apply_buff" | "apply_debuff" => {
            let modifier = modifier_from_intervention(intervention)?;
            push_log(
                snapshot,
                "intervention",
                "Modifier applied",
                &format!(
                    "Observer applied {} for {} turns.",
                    modifier.label, modifier.remaining_turns
                ),
            );
            snapshot.modifiers.push(modifier);
        }
        "equip_accessory" | "unequip_accessory" => {
            let acc = intervention
                .accessory
                .clone()
                .unwrap_or_else(|| intervention.target.clone());
            if !known_accessory(&acc) {
                return Err(format!("unknown accessory: {acc}"));
            }
            let eid = intervention
                .entity_id
                .as_deref()
                .ok_or("entity_id is required for accessory changes")?;
            let equip = intervention.kind == "equip_accessory";
            let entity = snapshot
                .world
                .entities
                .iter_mut()
                .find(|e| e.id == eid && e.kind == "axolotl")
                .ok_or("axolotl not found")?;
            if equip {
                if !entity.accessories.iter().any(|a| a == &acc) {
                    entity.accessories.push(acc.clone());
                }
            } else {
                entity.accessories.retain(|a| a != &acc);
            }
            let ename = entity.name.clone();
            push_log(
                snapshot,
                "intervention",
                if equip {
                    "Accessory equipped"
                } else {
                    "Accessory removed"
                },
                &format!(
                    "{ename} {} {acc}.",
                    if equip { "put on the" } else { "took off the" }
                ),
            );
        }
        other => return Err(format!("unknown intervention kind: {other}")),
    }
    Ok(())
}

fn modifier_from_intervention(intervention: &CivIntervention) -> Result<CivModifier, String> {
    let known = matches!(
        intervention.target.as_str(),
        "abundant_moss"
            | "clear_water"
            | "cooperation_aura"
            | "curiosity_spark"
            | "drought"
            | "cold_snap"
            | "food_rot"
            | "fatigue"
            | "quarrel_pressure"
    );
    if !known {
        return Err(format!("unknown modifier: {}", intervention.target));
    }
    let polarity = if matches!(
        intervention.target.as_str(),
        "abundant_moss" | "clear_water" | "cooperation_aura" | "curiosity_spark"
    ) {
        "buff"
    } else {
        "debuff"
    };
    Ok(CivModifier {
        id: format!("{}-{}", intervention.target, unix_timestamp_secs()),
        kind: intervention.target.clone(),
        label: title_case(&intervention.target),
        polarity: polarity.to_string(),
        remaining_turns: intervention.duration.unwrap_or(4).clamp(1, 20),
        intensity: intervention.intensity.unwrap_or(1.0).clamp(0.1, 5.0),
    })
}

fn score_civilization(snapshot: &CivSessionSnapshot, civ_id: &str) -> CivScore {
    let Some(ci) = civ_index(snapshot, civ_id) else {
        return CivScore {
            survival: 0.0,
            ethics: 0.0,
            intelligence: 0.0,
            total: 0.0,
        };
    };
    let civ = &snapshot.civs[ci];
    let resources = &civ.resources;
    let population = civ.population.max(1) as f32;
    let food = (*resources.get("food").unwrap_or(&0) as f32 / (population * 4.0)).clamp(0.0, 1.0);
    let water =
        (*resources.get("clean_water").unwrap_or(&0) as f32 / (population * 4.0)).clamp(0.0, 1.0);
    let survival =
        ((civ.health * 0.45) + (civ.morale * 0.25) + ((food + water) * 15.0)).clamp(0.0, 100.0);

    let mut ethics = 48.0 + civ.morale * 0.25 + civ.health * 0.15;
    if civ.policies.iter().any(|p| p == "share_equally") {
        ethics += 8.0;
    }
    if civ.policies.iter().any(|p| p == "protect_vulnerable") {
        ethics += 10.0;
    }
    if civ.policies.iter().any(|p| p == "conserve_water") {
        ethics += 5.0;
    }
    if has_modifier(snapshot, "quarrel_pressure") {
        ethics -= 8.0;
    }
    ethics = ethics.clamp(0.0, 100.0);

    let era_bonus = match civ.era.as_str() {
        "canal_village" => 28.0,
        "tool_pond" => 16.0,
        _ => 6.0,
    };
    let intelligence = (era_bonus
        + civ.techs.len() as f32 * 6.5
        + snapshot.turn as f32 * 0.6
        + (resources.values().sum::<i32>() as f32 / 8.0).min(22.0))
    .clamp(0.0, 100.0);

    let total = survival * 0.35 + ethics * 0.35 + intelligence * 0.30;
    CivScore {
        survival: round1(survival),
        ethics: round1(ethics),
        intelligence: round1(intelligence),
        total: round1(total),
    }
}

fn building_cost(building: &str) -> HashMap<String, i32> {
    let pairs = match building {
        "nest" => vec![("wood".to_string(), 8), ("fiber".to_string(), 5)],
        "storage" => vec![("wood".to_string(), 7), ("clay".to_string(), 4)],
        "farm" => vec![
            ("wood".to_string(), 6),
            ("clay".to_string(), 6),
            ("fiber".to_string(), 4),
        ],
        "workshop" => vec![
            ("wood".to_string(), 10),
            ("stone".to_string(), 8),
            ("tools".to_string(), 1),
        ],
        "canal" => vec![
            ("stone".to_string(), 8),
            ("clay".to_string(), 8),
            ("tools".to_string(), 1),
        ],
        _ => Vec::new(),
    };
    pairs.into_iter().collect()
}

fn tech_cost(tech: &str) -> HashMap<String, i32> {
    let pairs = match tech {
        "moss_farm" => vec![("wood".to_string(), 6), ("fiber".to_string(), 6)],
        "stone_tools" => vec![("stone".to_string(), 8), ("wood".to_string(), 4)],
        "water_filter" => vec![("clay".to_string(), 8), ("fiber".to_string(), 5)],
        "council" => vec![("food".to_string(), 8), ("wood".to_string(), 8)],
        "workshop_craft" => vec![
            ("stone".to_string(), 10),
            ("wood".to_string(), 10),
            ("tools".to_string(), 2),
        ],
        "canal_network" => vec![
            ("stone".to_string(), 12),
            ("clay".to_string(), 14),
            ("tools".to_string(), 3),
        ],
        // Needs ore (tier-2, mined only with stone_tools) -> keeps the chain acyclic.
        "metal_tools" => vec![
            ("ore".to_string(), 10),
            ("stone".to_string(), 8),
            ("tools".to_string(), 2),
        ],
        _ => Vec::new(),
    };
    pairs.into_iter().collect()
}

fn advance_era_if_ready(snapshot: &mut CivSessionSnapshot, civ_id: &str) {
    let Some(ci) = civ_index(snapshot, civ_id) else {
        return;
    };
    let has_tech = |tech: &str| snapshot.civs[ci].techs.iter().any(|t| t == tech);
    let stone_tools = has_tech("stone_tools");
    let moss_farm = has_tech("moss_farm");
    let water_filter = has_tech("water_filter");
    let council = has_tech("council");
    let canal_network = has_tech("canal_network");

    if snapshot.civs[ci].era == "pond_camp" && stone_tools && moss_farm {
        snapshot.civs[ci].era = "tool_pond".to_string();
    }
    if snapshot.civs[ci].era == "tool_pond" && water_filter && council && canal_network {
        snapshot.civs[ci].era = "canal_village".to_string();
    }
}

fn can_pay(resources: &HashMap<String, i32>, costs: &HashMap<String, i32>) -> bool {
    costs
        .iter()
        .all(|(resource, cost)| resources.get(resource).copied().unwrap_or(0) >= *cost)
}

fn pay(resources: &mut HashMap<String, i32>, costs: &HashMap<String, i32>) {
    for (resource, cost) in costs {
        let entry = resources.entry(resource.clone()).or_insert(0);
        *entry = (*entry - *cost).max(0);
    }
}

fn consume(resources: &mut HashMap<String, i32>, resource: &str, amount: i32) -> i32 {
    let entry = resources.entry(resource.to_string()).or_insert(0);
    let missing = (amount - *entry).max(0);
    *entry = (*entry - amount).max(0);
    missing
}

fn has_modifier(snapshot: &CivSessionSnapshot, kind: &str) -> bool {
    snapshot
        .modifiers
        .iter()
        .any(|modifier| modifier.kind == kind)
}

/// Minerals mined from finite blocks: the block depletes and floods to water when
/// emptied. Renewables (food/water/wood/fiber/kelp/herbs) keep a flat yield.
fn is_finite_mineral(resource: &str) -> bool {
    matches!(
        resource,
        "stone" | "clay" | "ore" | "sulfur" | "coral" | "glowshards" | "amber" | "ice"
    )
}

/// Tool tier a civ has unlocked for mining: 1 = bare claws, 2 = stone tools,
/// 3 = metal tools. Gates which minerals it can work (see `required_mining_tier`).
fn mining_tier(civ: &CivCivilization) -> u8 {
    if civ.techs.iter().any(|t| t == "metal_tools") {
        3
    } else if civ.techs.iter().any(|t| t == "stone_tools") {
        2
    } else {
        1
    }
}

/// Minimum mining tier needed to work `resource`. Stone/clay/ice are basic (tier 1)
/// — this keeps the tool-tech chain acyclic, since `stone_tools` is bought with
/// tier-1 materials; ore/sulfur/coral need stone tools; deep glowshards/amber need
/// metal tools.
fn required_mining_tier(resource: &str) -> u8 {
    match resource {
        "glowshards" | "amber" => 3,
        "ore" | "sulfur" | "coral" => 2,
        _ => 1,
    }
}

fn known_resource(resource: &str) -> bool {
    matches!(
        resource,
        "food"
            | "clean_water"
            | "wood"
            | "stone"
            | "clay"
            | "fiber"
            | "tools"
            | "glowshards"
            | "kelp"
            | "ore"
            | "ice"
            | "coral"
            | "sulfur"
            | "amber"
            | "herbs"
    )
}

fn harvest_yield_resource(resource: &str) -> Option<&str> {
    match resource {
        "moss" => Some("food"),
        other if known_resource(other) => Some(other),
        _ => None,
    }
}

fn terrain_yield_resource(terrain: &str) -> &'static str {
    match terrain {
        "moss" | "peat" => "fiber",
        "mud" | "earth" | "sand" | "salt" => "clay",
        "coral" => "coral",
        "ice" => "ice",
        "crystal" => "glowshards",
        "stone" | "basalt" | "sandstone" => "stone",
        _ => "stone",
    }
}

fn placeable_build_resource(resource: &str) -> bool {
    matches!(
        resource,
        "stone" | "clay" | "wood" | "fiber" | "coral" | "ice"
    )
}

fn place_terrain_for_resource(resource: &str) -> &'static str {
    match resource {
        "clay" => "mud",
        "wood" | "fiber" => "moss",
        "coral" => "coral",
        "ice" => "ice",
        "stone" => "stone",
        _ => "stone",
    }
}

#[derive(Debug, Clone)]
struct PlayerTask {
    kind: String,
    npc_id: String,
    resource: String,
    source: String,
    amount: i32,
    baseline: i32,
    reward: String,
    reward_resource: String,
    reward_amount: i32,
    building_id: String,
    object_id: String,
}

fn task_source_resource(resource: &str) -> &str {
    match resource {
        "food" => "moss",
        other => other,
    }
}

fn task_building_id(snapshot: &CivSessionSnapshot, preferred_role: &str) -> String {
    snapshot
        .world
        .entities
        .iter()
        .find(|entity| entity.kind == "building" && entity.role == preferred_role)
        .or_else(|| {
            snapshot
                .world
                .entities
                .iter()
                .find(|entity| entity.kind == "building")
        })
        .map(|entity| entity.id.clone())
        .unwrap_or_default()
}

fn task_repair_object_id(snapshot: &CivSessionSnapshot) -> String {
    snapshot
        .world
        .entities
        .iter()
        .find(|entity| {
            entity.kind == "object" && entity.role == "breach" && entity.activity != "repaired"
        })
        .or_else(|| {
            snapshot
                .world
                .entities
                .iter()
                .find(|entity| entity.kind == "object" && entity.role == "breach")
        })
        .map(|entity| entity.id.clone())
        .unwrap_or_default()
}

fn task_rescue_object_id(snapshot: &CivSessionSnapshot) -> String {
    snapshot
        .world
        .entities
        .iter()
        .find(|entity| {
            entity.kind == "object"
                && entity.role == "trapped"
                && entity.activity != "rescued"
                && rescue_rubble_remaining(snapshot, &entity.id) > 0
        })
        .or_else(|| {
            snapshot.world.entities.iter().find(|entity| {
                entity.kind == "object" && entity.role == "trapped" && entity.activity != "rescued"
            })
        })
        .map(|entity| entity.id.clone())
        .unwrap_or_default()
}

fn task_bridge_object_id(snapshot: &CivSessionSnapshot) -> String {
    snapshot
        .world
        .entities
        .iter()
        .find(|entity| {
            entity.kind == "object"
                && entity.role == "bridge"
                && entity.activity != "built"
                && bridge_tiles_remaining(snapshot, &entity.id) > 0
        })
        .or_else(|| {
            snapshot.world.entities.iter().find(|entity| {
                entity.kind == "object" && entity.role == "bridge" && entity.activity != "built"
            })
        })
        .map(|entity| entity.id.clone())
        .unwrap_or_default()
}

fn task_for_npc(
    snapshot: &CivSessionSnapshot,
    entity: &CivEntity,
    civ: &CivCivilization,
) -> PlayerTask {
    let morph = entity.morph.as_str();
    if entity.role == "builder" {
        let object_id = task_bridge_object_id(snapshot);
        if !object_id.is_empty() {
            return PlayerTask {
                kind: "build_bridge".to_string(),
                npc_id: entity.id.clone(),
                resource: "stone".to_string(),
                source: "stone".to_string(),
                amount: bridge_tiles_remaining(snapshot, &object_id).max(1),
                baseline: 0,
                reward: "glow_pocket".to_string(),
                reward_resource: String::new(),
                reward_amount: 0,
                building_id: String::new(),
                object_id,
            };
        }
    }

    if matches!(morph, "gold" | "copper" | "firefly" | "blue" | "gfp") {
        let (resource, reward_resource) = match morph {
            "blue" | "gfp" => ("fiber", "clean_water"),
            _ => ("wood", "tools"),
        };
        return PlayerTask {
            kind: "trade_resource".to_string(),
            npc_id: entity.id.clone(),
            resource: resource.to_string(),
            source: task_source_resource(resource).to_string(),
            amount: 2,
            baseline: civ.resources.get(resource).copied().unwrap_or(0),
            reward: "resource".to_string(),
            reward_resource: reward_resource.to_string(),
            reward_amount: 1,
            building_id: String::new(),
            object_id: String::new(),
        };
    }

    if entity.role == "elder" {
        let object_id = task_repair_object_id(snapshot);
        if !object_id.is_empty() {
            let resource = "fiber";
            return PlayerTask {
                kind: "repair_object".to_string(),
                npc_id: entity.id.clone(),
                resource: resource.to_string(),
                source: task_source_resource(resource).to_string(),
                amount: 2,
                baseline: civ.resources.get(resource).copied().unwrap_or(0),
                reward: "nest_safety".to_string(),
                reward_resource: String::new(),
                reward_amount: 0,
                building_id: String::new(),
                object_id,
            };
        }
    }

    if entity.role == "scout" {
        let object_id = task_rescue_object_id(snapshot);
        if !object_id.is_empty() {
            return PlayerTask {
                kind: "rescue_object".to_string(),
                npc_id: entity.id.clone(),
                resource: "rubble".to_string(),
                source: "rubble".to_string(),
                amount: rescue_rubble_remaining(snapshot, &object_id).max(1),
                baseline: 0,
                reward: "morale".to_string(),
                reward_resource: String::new(),
                reward_amount: 0,
                building_id: String::new(),
                object_id,
            };
        }
    }

    if matches!(morph, "melanoid" | "axanthic" | "mystic") || entity.role == "elder" {
        let building_id = task_building_id(
            snapshot,
            if entity.role == "elder" {
                "nest"
            } else {
                "pond"
            },
        );
        return PlayerTask {
            kind: "visit_building".to_string(),
            npc_id: entity.id.clone(),
            resource: String::new(),
            source: String::new(),
            amount: 0,
            baseline: 0,
            reward: "morale".to_string(),
            reward_resource: String::new(),
            reward_amount: 0,
            building_id,
            object_id: String::new(),
        };
    }

    let resource = match morph {
        "wild" | "leucistic" | "albino" | "piebald" => "food",
        _ => "food",
    };
    PlayerTask {
        kind: "fetch_resource".to_string(),
        npc_id: entity.id.clone(),
        resource: resource.to_string(),
        source: task_source_resource(resource).to_string(),
        amount: 2,
        baseline: civ.resources.get(resource).copied().unwrap_or(0),
        reward: "morale".to_string(),
        reward_resource: String::new(),
        reward_amount: 0,
        building_id: String::new(),
        object_id: String::new(),
    }
}

fn marker_value(body: &str, key: &str) -> Option<String> {
    body.split(';').find_map(|part| {
        let trimmed = part.trim();
        let (k, v) = trimmed.split_once('=')?;
        (k == key).then(|| v.trim().to_string())
    })
}

fn marker_i32(body: &str, key: &str, fallback: i32) -> i32 {
    marker_value(body, key)
        .and_then(|value| value.parse::<i32>().ok())
        .unwrap_or(fallback)
}

fn parse_player_task(entry: &CivLogEntry) -> Option<PlayerTask> {
    let kind = marker_value(&entry.body, "task")?;
    if !matches!(
        kind.as_str(),
        "fetch_resource"
            | "trade_resource"
            | "visit_building"
            | "repair_object"
            | "rescue_object"
            | "build_bridge"
    ) {
        return None;
    }
    let npc_id = marker_value(&entry.body, "npc")?;
    let resource = marker_value(&entry.body, "resource").unwrap_or_default();
    let source = marker_value(&entry.body, "source")
        .unwrap_or_else(|| task_source_resource(&resource).to_string());
    Some(PlayerTask {
        kind,
        npc_id,
        resource,
        source,
        amount: marker_i32(&entry.body, "amount", 1).max(1),
        baseline: marker_i32(&entry.body, "baseline", 0),
        reward: marker_value(&entry.body, "reward").unwrap_or_else(|| "morale".to_string()),
        reward_resource: marker_value(&entry.body, "reward_resource").unwrap_or_default(),
        reward_amount: marker_i32(&entry.body, "reward_amount", 0).max(0),
        building_id: marker_value(&entry.body, "building").unwrap_or_default(),
        object_id: marker_value(&entry.body, "object").unwrap_or_default(),
    })
}

fn active_player_task(snapshot: &CivSessionSnapshot) -> Option<PlayerTask> {
    for entry in snapshot.log.iter().rev() {
        if entry.kind != "player" {
            continue;
        }
        match entry.title.as_str() {
            "Task complete" => return None,
            "NPC request" | "Task pending" => return parse_player_task(entry),
            _ => {}
        }
    }
    None
}

fn known_tech(tech: &str) -> bool {
    matches!(
        tech,
        "moss_farm"
            | "stone_tools"
            | "water_filter"
            | "council"
            | "workshop_craft"
            | "canal_network"
            | "metal_tools"
    )
}

fn push_log(snapshot: &mut CivSessionSnapshot, kind: &str, title: &str, body: &str) {
    snapshot.log.push(CivLogEntry {
        turn: snapshot.turn,
        kind: kind.to_string(),
        title: title.to_string(),
        body: body.to_string(),
        created_at: unix_timestamp_secs(),
        civ_id: None,
        reasoning: None,
    });
    if snapshot.log.len() > 240 {
        let overflow = snapshot.log.len() - 240;
        snapshot.log.drain(0..overflow);
    }
}

/// Append an "ai_decision" log entry attributed to a civ, persisting the model's
/// reasoning alongside the public rationale (D-12 Option B). Mirrors `push_log`
/// but populates `civ_id`/`reasoning`; an empty reasoning string is stored as
/// `None`.
fn push_decision_log(
    snapshot: &mut CivSessionSnapshot,
    civ_id: &str,
    intent: &str,
    rationale: &str,
    ethics: &str,
    reasoning: Option<String>,
) {
    let civ_name = civ_label(snapshot, civ_id);
    let reasoning = reasoning.filter(|r| !r.trim().is_empty());
    snapshot.log.push(CivLogEntry {
        turn: snapshot.turn,
        kind: "ai_decision".to_string(),
        title: format!("{civ_name} intent: {intent}"),
        body: format!("{rationale}\nEthics: {ethics}"),
        created_at: unix_timestamp_secs(),
        civ_id: Some(civ_id.to_string()),
        reasoning,
    });
    if snapshot.log.len() > 240 {
        let overflow = snapshot.log.len() - 240;
        snapshot.log.drain(0..overflow);
    }
}

fn player_target_used_this_turn(
    snapshot: &CivSessionSnapshot,
    title: &str,
    target_id: &str,
) -> bool {
    let marker = format!("target={target_id}");
    snapshot.log.iter().rev().any(|entry| {
        entry.turn == snapshot.turn
            && entry.kind == "player"
            && entry.title == title
            && entry.body.contains(&marker)
    })
}

fn save_snapshot(snapshot: &CivSessionSnapshot) -> Result<(), String> {
    validate_id(&snapshot.id)?;
    let dir = home_civilizations_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(format!("{}.json", snapshot.id));
    let json = serde_json::to_string_pretty(snapshot).map_err(|e| e.to_string())?;
    std::fs::write(path, json).map_err(|e| e.to_string())
}

fn load_snapshot(id: &str) -> Result<CivSessionSnapshot, String> {
    validate_id(id)?;
    let path = home_civilizations_dir().join(format!("{id}.json"));
    let raw = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    parse_snapshot(&raw)
}

/// Parse a snapshot from raw JSON, migrating legacy v1 (single-`civilization`)
/// saves into the v2 multi-civ shape and backfilling any missing identity.
fn parse_snapshot(raw: &str) -> Result<CivSessionSnapshot, String> {
    let mut value: serde_json::Value = serde_json::from_str(raw).map_err(|e| e.to_string())?;
    migrate_value_in_place(&mut value);
    let mut snapshot: CivSessionSnapshot =
        serde_json::from_value(value).map_err(|e| e.to_string())?;
    backfill_snapshot(&mut snapshot);
    Ok(snapshot)
}

/// In-place migration of a parsed JSON value from the legacy v1 shape (top-level
/// `model` + single `civilization`) to v2 (`civs[]`). No-op for v2 saves.
fn migrate_value_in_place(value: &mut serde_json::Value) {
    let Some(obj) = value.as_object_mut() else {
        return;
    };
    let has_civs = obj
        .get("civs")
        .and_then(|v| v.as_array())
        .is_some_and(|a| !a.is_empty());
    if has_civs {
        return;
    }
    let model = obj
        .get("model")
        .and_then(|m| m.as_str())
        .unwrap_or("unknown")
        .to_string();
    let name = obj
        .get("name")
        .and_then(|m| m.as_str())
        .unwrap_or("Axolotl Colony")
        .to_string();
    if let Some(mut civ_val) = obj.remove("civilization") {
        if let Some(civ_obj) = civ_val.as_object_mut() {
            civ_obj.insert("id".to_string(), serde_json::json!(FIRST_CIV_ID));
            civ_obj.insert("name".to_string(), serde_json::json!(name));
            civ_obj.insert("model".to_string(), serde_json::json!(model));
            civ_obj.insert("color".to_string(), serde_json::json!(CIV_COLORS[0]));
            civ_obj.insert("alive".to_string(), serde_json::json!(true));
        }
        obj.insert("civs".to_string(), serde_json::json!([civ_val]));
    }
    obj.insert("version".to_string(), serde_json::json!(SCHEMA_VERSION));
}

/// Fill in any missing civ identity, tag legacy founders to the lone civ, and
/// claim its home region — so migrated and hand-edited saves are well-formed.
fn backfill_snapshot(snapshot: &mut CivSessionSnapshot) {
    snapshot.version = SCHEMA_VERSION;
    for i in 0..snapshot.civs.len() {
        if snapshot.civs[i].id.is_empty() {
            snapshot.civs[i].id = civ_id_for(i);
        }
        if snapshot.civs[i].color.is_empty() {
            snapshot.civs[i].color = CIV_COLORS[i % CIV_COLORS.len()].to_string();
        }
    }

    // A single-civ world: tag any untagged colony entities to it (legacy saves had
    // no civ_id) and ensure the civ has a home region + spawn column.
    if snapshot.civs.len() == 1 {
        let cid = snapshot.civs[0].id.clone();
        for e in snapshot.world.entities.iter_mut() {
            if e.civ_id.is_none() && matches!(e.kind.as_str(), "axolotl" | "egg" | "building") {
                e.civ_id = Some(cid.clone());
            }
        }
        if snapshot.civs[0].home_region.is_empty() {
            // Prefer the pond/nest column; otherwise fall back to the mean column
            // of the civ's living axolotls so a building-less migrated colony still
            // anchors where its axolotls actually are (not the world's left edge).
            let center = snapshot
                .world
                .entities
                .iter()
                .find(|e| {
                    e.civ_id.as_deref() == Some(cid.as_str())
                        && (e.role == "pond" || e.role == "nest")
                })
                .map(|e| e.x)
                .or_else(|| {
                    let xs: Vec<u32> = snapshot
                        .world
                        .entities
                        .iter()
                        .filter(|e| {
                            e.civ_id.as_deref() == Some(cid.as_str())
                                && e.kind == "axolotl"
                                && e.stage != "egg"
                        })
                        .map(|e| e.x)
                        .collect();
                    if xs.is_empty() {
                        None
                    } else {
                        Some(xs.iter().sum::<u32>() / xs.len() as u32)
                    }
                });
            if let Some(cx) = center {
                if let Some(region) = snapshot
                    .world
                    .regions
                    .iter_mut()
                    .find(|r| cx >= r.x && cx < r.x + r.width)
                {
                    region.owner = Some(cid.clone());
                    let rid = region.id.clone();
                    snapshot.civs[0].home_region = rid;
                    snapshot.civs[0].spawn_x = cx;
                }
            }
        }
    }
}

fn validate_id(id: &str) -> Result<(), String> {
    if id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        && !id.is_empty()
    {
        Ok(())
    } else {
        Err("invalid civilization session id".to_string())
    }
}

fn home_civilizations_dir() -> PathBuf {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home)
        .join(".xolotl-code")
        .join("civilizations")
}

fn emit_civ_event(
    app_handle: &AppHandle,
    session_id: &str,
    event_type: &str,
    payload: serde_json::Value,
) {
    let channel = format!("civ-event:{session_id}");
    let mut body = serde_json::Map::new();
    body.insert(
        "type".to_string(),
        serde_json::Value::String(event_type.to_string()),
    );
    if let serde_json::Value::Object(payload) = payload {
        for (key, value) in payload {
            body.insert(key, value);
        }
    }
    let _ = app_handle.emit(&channel, serde_json::Value::Object(body));
}

fn unix_timestamp_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

fn seed_from(value: &str) -> u32 {
    let mut hash = 2166136261u32;
    for byte in value.as_bytes() {
        hash ^= *byte as u32;
        hash = hash.wrapping_mul(16777619);
    }
    hash
}

fn next_rng(seed: &mut u32) -> u32 {
    let mut x = *seed;
    x ^= x << 13;
    x ^= x >> 17;
    x ^= x << 5;
    *seed = x;
    x
}

fn rand_f(rng: &mut u32) -> f32 {
    (next_rng(rng) % 100_000) as f32 / 100_000.0
}

fn rand_range(rng: &mut u32, lo: f32, hi: f32) -> f32 {
    lo + (hi - lo) * rand_f(rng)
}

/// Higher = more dominant when an axolotl carries two different colour alleles.
fn morph_rank(morph: &str) -> u8 {
    match morph {
        "mystic" => 11,
        "wild" => 10,
        "gfp" | "firefly" => 9,
        "copper" => 8,
        "melanoid" => 7,
        "axanthic" => 6,
        "gold" => 5,
        "piebald" => 4,
        "blue" => 2,
        "albino" => 1,
        _ => 3, // leucistic + unknown
    }
}

fn expressed_morph(genes: &CivGenes) -> String {
    if morph_rank(&genes.allele_b) > morph_rank(&genes.allele_a) {
        genes.allele_b.clone()
    } else {
        genes.allele_a.clone()
    }
}

fn stage_for_age(age: u32, longevity: f32) -> String {
    let elder_at = (ELDER_BASE_AGE * longevity) as u32;
    if age < 3 {
        "hatchling"
    } else if age < 7 {
        "juvenile"
    } else if age < elder_at {
        "adult"
    } else {
        "elder"
    }
    .to_string()
}

fn size_for_stage(stage: &str, size_gene: f32) -> f32 {
    let base = match stage {
        "hatchling" => 0.5,
        "juvenile" => 0.72,
        "elder" => 1.06,
        _ => 1.0, // adult + fallback
    };
    (base * size_gene).clamp(0.35, 1.6)
}

fn role_for_stage(stage: &str) -> String {
    match stage {
        "hatchling" | "juvenile" => "juvenile",
        "elder" => "elder",
        _ => "worker",
    }
    .to_string()
}

fn default_genes() -> CivGenes {
    CivGenes {
        allele_a: "leucistic".to_string(),
        allele_b: "leucistic".to_string(),
        size_gene: 1.0,
        fertility: 0.7,
        longevity: 1.0,
        vigor: 1.0,
    }
}

fn random_genes(rng: &mut u32, primary: &str) -> CivGenes {
    let carrier = COMMON_MORPHS[(next_rng(rng) as usize) % COMMON_MORPHS.len()];
    CivGenes {
        allele_a: primary.to_string(),
        allele_b: carrier.to_string(),
        size_gene: rand_range(rng, 0.85, 1.18),
        fertility: rand_range(rng, 0.5, 0.95),
        longevity: rand_range(rng, 0.85, 1.2),
        vigor: rand_range(rng, 0.85, 1.15),
    }
}

fn pick_allele<'a>(rng: &mut u32, genes: &'a CivGenes) -> &'a str {
    if next_rng(rng).is_multiple_of(2) {
        &genes.allele_a
    } else {
        &genes.allele_b
    }
}

fn cross_genes(a: &CivGenes, b: &CivGenes, rng: &mut u32) -> CivGenes {
    let mut allele_a = pick_allele(rng, a).to_string();
    let mut allele_b = pick_allele(rng, b).to_string();
    // Mutation: ~7% chance to flip one allele, sometimes to a rare fantasy morph.
    if rand_f(rng) < 0.07 {
        let pool: &[&str] = if rand_f(rng) < 0.4 {
            &RARE_MORPHS
        } else {
            &MORPHS
        };
        let m = pool[(next_rng(rng) as usize) % pool.len()].to_string();
        if next_rng(rng).is_multiple_of(2) {
            allele_a = m;
        } else {
            allele_b = m;
        }
    }
    CivGenes {
        allele_a,
        allele_b,
        size_gene: ((a.size_gene + b.size_gene) / 2.0 + rand_range(rng, -0.08, 0.08))
            .clamp(0.7, 1.4),
        fertility: ((a.fertility + b.fertility) / 2.0 + rand_range(rng, -0.08, 0.08))
            .clamp(0.3, 1.0),
        longevity: ((a.longevity + b.longevity) / 2.0 + rand_range(rng, -0.08, 0.08))
            .clamp(0.8, 1.35),
        vigor: ((a.vigor + b.vigor) / 2.0 + rand_range(rng, -0.08, 0.08)).clamp(0.8, 1.25),
    }
}

#[allow(clippy::too_many_arguments)]
fn make_axolotl(
    id: String,
    name: String,
    x: u32,
    y: u32,
    sex: &str,
    age: u32,
    genes: CivGenes,
    health: f32,
    mood: f32,
) -> CivEntity {
    let stage = stage_for_age(age, genes.longevity);
    let size = size_for_stage(&stage, genes.size_gene);
    let role = role_for_stage(&stage);
    let morph = expressed_morph(&genes);
    CivEntity {
        id,
        kind: "axolotl".to_string(),
        name,
        x,
        y,
        health,
        mood,
        role,
        civ_id: None,
        morph,
        stage,
        sex: sex.to_string(),
        age,
        size,
        accessories: Vec::new(),
        genes: Some(genes),
        hatches_in: None,
        parents: Vec::new(),
        activity: String::new(),
        target_x: None,
        target_y: None,
    }
}

fn nest_pos(snapshot: &CivSessionSnapshot, civ_id: &str) -> Option<(u32, u32)> {
    civ_entities(snapshot, civ_id)
        .find(|e| e.kind == "building" && e.role == "nest")
        .map(|e| (e.x, e.y.saturating_sub(1)))
}

fn known_accessory(acc: &str) -> bool {
    ACCESSORIES.contains(&acc)
}

fn short_id(id: &str) -> String {
    let n = id.chars().count();
    id.chars().skip(n.saturating_sub(4)).collect()
}

fn clean_name(name: &str) -> String {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        "Axolotl Colony".to_string()
    } else {
        trimmed.chars().take(80).collect()
    }
}

fn title_case(value: &str) -> String {
    value
        .split('_')
        .map(|part| {
            let mut chars = part.chars();
            match chars.next() {
                Some(first) => format!("{}{}", first.to_uppercase(), chars.as_str()),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn round1(value: f32) -> f32 {
    (value * 10.0).round() / 10.0
}

// --- Environment engine: pure, seed-deterministic helpers (W4) ---
//
// These leaf helpers are wired into the turn loop by the Wave-3 orchestrator
// (`tick_environment`, plan 03-03). Until then they are exercised only by the
// unit tests below, so each carries `#[allow(dead_code)]` to keep the
// non-test lib build clippy-clean; the attribute comes out when Wave 3 lands.

/// Turns spent in a season before it wraps to the next one. Claude's discretion
/// per CONTEXT (Seasons & Temperature).
#[allow(dead_code)]
const SEASON_LEN: u32 = 8;
#[allow(dead_code)]
const SEASONS: [&str; 4] = ["spring", "summer", "autumn", "winter"];
/// Unique env-tick RNG salt (distinct from `civ_turn_order`'s `0x51ED_2701`).
#[allow(dead_code)]
const ENV_SEASON_SALT: u32 = 0xE05A_F107;

/// Mild/cold/warm baseline the temperature drifts toward each season.
#[allow(dead_code)]
fn season_target_temp(season: &str) -> f32 {
    match season {
        "summer" => 24.0,
        "autumn" => 14.0,
        "winter" => 4.0,
        _ => 14.0, // spring (and any unknown) → mild baseline
    }
}

/// Pure: advance the season counter and drift temperature/water_level toward the
/// new season's target. Same inputs ⇒ identical output (deterministic replay —
/// all randomness derives from `seed ^ turn ^ ENV_SEASON_SALT`, no SystemTime/uuid).
/// The caller (`tick_environment`) assigns the returned fields and logs a season
/// change. Returns `(season, turn_of_season, temperature, water_level)`.
#[allow(dead_code)]
fn advance_season(
    season: &str,
    turn_of_season: u32,
    temperature: f32,
    water_level: i32,
    turn: u32,
    seed: u32,
) -> (String, u32, f32, i32) {
    let mut tos = turn_of_season.saturating_add(1);
    let mut idx = SEASONS.iter().position(|&s| s == season).unwrap_or(0);
    if tos >= SEASON_LEN {
        tos = 0;
        idx = (idx + 1) % SEASONS.len();
    }
    let next_season = SEASONS[idx];
    let target = season_target_temp(next_season);
    let mut rng = (seed ^ turn.wrapping_mul(0x9E37_79B9) ^ ENV_SEASON_SALT).max(1);
    let noise = rand_range(&mut rng, -0.6, 0.6);
    let temp = temperature + (target - temperature) * 0.25 + noise;
    let water_delta = match next_season {
        "winter" => -2,
        "spring" => 2,
        _ => 0,
    };
    (
        next_season.to_string(),
        tos,
        round1(temp),
        (water_level + water_delta).clamp(-6, 6),
    )
}

/// Renewable resources are the complement of `is_finite_mineral` — reuse the
/// single classifier rather than re-listing resources (so the two never drift).
/// Coral is FINITE here (it is mined/depleted like a block), per the code's
/// `is_finite_mineral`, despite CONTEXT prose listing it as an organic example.
#[allow(dead_code)]
fn is_renewable(resource: &str) -> bool {
    !is_finite_mineral(resource)
}

/// Pure: renewable resource tiles tick their `amount` back toward a cap, at a
/// rate scaled by season/temperature (zero in winter or when too cold). Finite
/// minerals are NEVER regrown (ENV-03 sustained scarcity). Mutates in place —
/// the tile count is invariant (threat T-03-02). A partially-mined finite tile
/// still carries `resource: Some("ore")` and stays finite, so it is skipped;
/// a fully-mined finite tile already has `resource: None` and is skipped too.
#[allow(dead_code)]
fn regrow_resources(tiles: &mut [CivTile], season: &str, temperature: f32) {
    let rate = match season {
        "spring" | "summer" => 2,
        "autumn" => 1,
        _ => 0, // winter: no regrowth
    };
    if rate == 0 || temperature < 2.0 {
        return;
    }
    const REGROW_CAP: i32 = 18; // grounded in world-gen patch amounts (6..18)
    for tile in tiles.iter_mut() {
        if let Some(res) = tile.resource.as_deref() {
            if is_renewable(res) && tile.amount < REGROW_CAP {
                tile.amount = (tile.amount + rate).min(REGROW_CAP);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn first_civ_id(snapshot: &CivSessionSnapshot) -> String {
        snapshot.civs[0].id.clone()
    }

    /// Single-civ snapshot helper preserving the pre-multi-civ ergonomics for
    /// the existing tests (one model => one founding civ).
    fn test_snapshot(
        id: &str,
        name: &str,
        model: &str,
        seed: u32,
        now: u64,
    ) -> CivSessionSnapshot {
        initial_snapshot(
            id.to_string(),
            name.to_string(),
            &[CivParticipant {
                name: name.to_string(),
                model: model.to_string(),
                color: None,
            }],
            seed,
            now,
        )
    }

    #[test]
    fn world_generation_is_deterministic_by_seed() {
        let a = generate_world(1234, 1);
        let b = generate_world(1234, 1);
        assert_eq!(a.width, WORLD_WIDTH);
        assert_eq!(a.tiles.len(), (a.width * WORLD_HEIGHT) as usize);
        assert_eq!(
            serde_json::to_string(&a.tiles).unwrap(),
            serde_json::to_string(&b.tiles).unwrap()
        );
        assert_eq!(
            serde_json::to_string(&a.entities).unwrap(),
            serde_json::to_string(&b.entities).unwrap(),
            "founders must be byte-identical (the ore-vein pass must not perturb founder rng)"
        );
        assert!(a.entities.iter().any(|entity| entity.kind == "axolotl"));
    }

    #[test]
    fn advance_season_is_deterministic() {
        // Same (season, turn_of_season, temperature, water_level, turn, seed) ⇒ identical tuple.
        let a = advance_season("spring", 7, 14.0, 0, 5, 1234);
        let b = advance_season("spring", 7, 14.0, 0, 5, 1234);
        assert_eq!(a, b, "pure helper must be deterministic for replay");
    }

    #[test]
    fn advance_season_wraps_on_season_len() {
        // turn_of_season 7 + 1 == SEASON_LEN (8) → wrap to the next season, counter reset to 0.
        let (season, tos, _, _) = advance_season("spring", 7, 14.0, 0, 5, 1234);
        assert_eq!(season, "summer");
        assert_eq!(tos, 0);
        // Mid-season (no wrap): counter just increments.
        let (season, tos, _, _) = advance_season("spring", 0, 14.0, 0, 5, 1234);
        assert_eq!(season, "spring");
        assert_eq!(tos, 1);
    }

    #[test]
    fn advance_season_cycle_order() {
        // Walk four wraps and confirm spring→summer→autumn→winter→spring.
        let order = ["summer", "autumn", "winter", "spring"];
        let mut season = "spring".to_string();
        for expected in order {
            let (next, tos, _, _) = advance_season(&season, 7, 14.0, 0, 5, 1234);
            assert_eq!(next, expected, "season cycle must advance in order");
            assert_eq!(tos, 0, "counter resets on wrap");
            season = next;
        }
        assert_eq!(season, "spring", "cycle returns to spring after four wraps");
    }

    #[test]
    fn advance_season_temp_is_round1_stable_and_water_bounded() {
        let (_, _, temp, water) = advance_season("spring", 3, 14.0, 0, 5, 1234);
        // Temperature passes through round1 → byte-stable saved float.
        assert_eq!(temp, (temp * 10.0).round() / 10.0);
        // water_level stays within [-6, 6] even after a delta.
        assert!((-6..=6).contains(&water));
        // Extreme starting water clamps.
        let (_, _, _, water_hi) = advance_season("winter", 7, 4.0, 6, 9, 99);
        assert!((-6..=6).contains(&water_hi));
    }

    fn renewable_tile(resource: &str, amount: i32) -> CivTile {
        CivTile {
            x: 0,
            y: 60,
            terrain: "moss_bed".into(),
            resource: Some(resource.into()),
            amount,
            biome: String::new(),
        }
    }

    fn finite_tile(resource: &str, amount: i32) -> CivTile {
        CivTile {
            x: 0,
            y: 60,
            terrain: "stone".into(),
            resource: Some(resource.into()),
            amount,
            biome: String::new(),
        }
    }

    #[test]
    fn regrow_renewable_rises_to_cap() {
        let mut tiles = vec![renewable_tile("moss", 5), renewable_tile("kelp", 17)];
        regrow_resources(&mut tiles, "summer", 24.0);
        assert!(tiles[0].amount > 5, "renewable should gain amount");
        assert!(tiles[0].amount <= 18, "renewable must not exceed cap");
        assert_eq!(tiles[1].amount, 18, "near-cap renewable clamps to cap");
        // Saturate to cap and never exceed it on repeated ticks.
        for _ in 0..10 {
            regrow_resources(&mut tiles, "summer", 24.0);
        }
        assert_eq!(tiles[0].amount, 18);
        assert_eq!(tiles[1].amount, 18);
    }

    #[test]
    fn finite_resources_never_regrow() {
        // ENV-03: finite minerals stay depleted (sustained scarcity).
        let mut tiles = vec![finite_tile("ore", 3)];
        regrow_resources(&mut tiles, "summer", 24.0);
        assert_eq!(tiles[0].amount, 3, "finite must never regrow");
    }

    #[test]
    fn coral_is_finite_and_never_regrows() {
        // Micro-decision: coral follows is_finite_mineral (FINITE), not CONTEXT prose.
        assert!(is_finite_mineral("coral"));
        assert!(!is_renewable("coral"));
        let mut tiles = vec![finite_tile("coral", 4)];
        regrow_resources(&mut tiles, "summer", 24.0);
        assert_eq!(tiles[0].amount, 4, "coral is finite → no regrowth");
    }

    #[test]
    fn regrow_is_zero_in_winter() {
        let mut tiles = vec![renewable_tile("moss", 5)];
        regrow_resources(&mut tiles, "winter", 24.0);
        assert_eq!(tiles[0].amount, 5, "winter rate is 0 → unchanged");
    }

    #[test]
    fn regrow_zero_when_too_cold() {
        let mut tiles = vec![renewable_tile("moss", 5)];
        regrow_resources(&mut tiles, "summer", 1.0);
        assert_eq!(tiles[0].amount, 5, "below temperature threshold → unchanged");
    }

    #[test]
    fn regrow_preserves_tile_count() {
        let mut snapshot = test_snapshot("regrow-count", "Count", "mock-model", 42, 1);
        let before = snapshot.world.tiles.len();
        regrow_resources(&mut snapshot.world.tiles, "summer", 24.0);
        assert_eq!(
            snapshot.world.tiles.len(),
            before,
            "regrow mutates in place — tile count is invariant"
        );
    }

    #[test]
    fn world_scales_and_spawns_are_disjoint_per_civ() {
        let n = 3u32;
        let a = generate_world(4242, n);
        let b = generate_world(4242, n);
        // Deterministic by seed at any civ count.
        assert_eq!(
            serde_json::to_string(&a.tiles).unwrap(),
            serde_json::to_string(&b.tiles).unwrap()
        );
        // The world widens to make room for more civs.
        assert!(a.width > WORLD_WIDTH);
        assert_eq!(a.tiles.len(), (a.width * WORLD_HEIGHT) as usize);
        // Each civ founds a full colony tagged to its own id.
        for i in 1..=n {
            let cid = format!("civ-{i}");
            let axos = a
                .entities
                .iter()
                .filter(|e| e.kind == "axolotl" && e.civ_id.as_deref() == Some(cid.as_str()))
                .count() as u32;
            assert_eq!(
                axos, INITIAL_POPULATION,
                "{cid} should have a full founding colony"
            );
            assert!(
                a.entities
                    .iter()
                    .any(|e| e.role == "pond" && e.civ_id.as_deref() == Some(cid.as_str())),
                "{cid} should have a pond heart"
            );
        }
        // Exactly n distinct regions are claimed — one per civ, no overlap.
        let mut owners: Vec<&str> = a
            .regions
            .iter()
            .filter_map(|r| r.owner.as_deref())
            .collect();
        assert_eq!(
            owners.len(),
            n as usize,
            "expected one owned region per civ"
        );
        owners.sort_unstable();
        owners.dedup();
        assert_eq!(
            owners.len(),
            n as usize,
            "each civ should own a distinct region"
        );
        // Civs only ever spawn in livable biomes.
        for region in a.regions.iter().filter(|r| r.owner.is_some()) {
            let spawnable = BIOMES
                .iter()
                .find(|b| b.id == region.biome)
                .is_some_and(|b| b.spawnable);
            assert!(
                spawnable,
                "civ spawned in non-livable biome {}",
                region.biome
            );
        }
    }

    #[test]
    fn single_civ_spawns_near_world_center() {
        // The lone colony must settle near the centre, not against the left wall.
        for seed in [1234u32, 2024, 4242, 7, 99, 5000] {
            let w = generate_world(seed, 1);
            let pond = w
                .entities
                .iter()
                .find(|e| e.role == "pond")
                .expect("a pond heart");
            let mid = w.width / 2;
            let dist = (i64::from(pond.x) - i64::from(mid)).unsigned_abs() as u32;
            assert!(
                dist <= w.width / 4,
                "seed {seed}: colony at x={} is too far from center {mid} (width {})",
                pond.x,
                w.width
            );
        }
    }

    #[test]
    fn more_civs_than_livable_regions_still_found_every_colony() {
        // 11 civs but only ~8 livable regions: must not panic, and every civ still
        // founds a full colony (regions may be shared once civs exceed regions).
        let n = 11u32;
        let w = generate_world(321, n);
        for i in 1..=n {
            let cid = format!("civ-{i}");
            let axos = w
                .entities
                .iter()
                .filter(|e| e.kind == "axolotl" && e.civ_id.as_deref() == Some(cid.as_str()))
                .count() as u32;
            assert_eq!(
                axos, INITIAL_POPULATION,
                "{cid} should still found a full colony"
            );
        }
    }

    #[test]
    fn founding_world_tags_entities_and_claims_home() {
        let world = generate_world(2024, 1);
        // Every colony entity is tagged to the founding civ.
        assert!(world
            .entities
            .iter()
            .filter(|e| matches!(e.kind.as_str(), "axolotl" | "building"))
            .all(|e| e.civ_id.as_deref() == Some(FIRST_CIV_ID)));
        // The founding civ owns exactly its home region.
        let owned = world
            .regions
            .iter()
            .filter(|r| r.owner.as_deref() == Some(FIRST_CIV_ID))
            .count();
        assert_eq!(owned, 1);
    }

    #[test]
    fn initial_snapshot_is_multi_civ_shaped() {
        let s = test_snapshot("shape", "Shape", "m", 3, 1);
        assert_eq!(s.version, SCHEMA_VERSION);
        assert_eq!(s.civs.len(), 1);
        assert_eq!(s.civs[0].id, FIRST_CIV_ID);
        assert_eq!(s.civs[0].model, "m");
        assert!(!s.civs[0].color.is_empty());
        assert!(!s.civs[0].home_region.is_empty());
        assert!(s.civs[0].alive);
        assert_eq!(s.civs[0].population, INITIAL_POPULATION);
    }

    #[test]
    fn invalid_model_decision_is_rejected() {
        let err = parse_model_decision(r#"{"intent":"","actions":[],"public_rationale":"","ethics_note":"","expected_risks":[]}"#)
            .unwrap_err();
        assert!(err.contains("intent"));

        let err = parse_model_decision(r#"{"intent":"x","public_rationale":"x","ethics_note":"x","expected_risks":[],"actions":[{"type":"gather","resource":"unknown","workers":2}]}"#)
            .unwrap_err();
        assert!(err.contains("unknown resource"));
    }

    #[test]
    fn intervention_grants_resources_and_scores() {
        let mut snapshot = test_snapshot("test-session", "Test", "mock-model", 42, 1);
        let before = snapshot.civs[0].resources["food"];
        apply_intervention_to_snapshot(
            &mut snapshot,
            &CivIntervention {
                kind: "grant_resource".to_string(),
                target: "food".to_string(),
                amount: Some(25),
                x: None,
                y: None,
                duration: None,
                intensity: None,
                entity_id: None,
                accessory: None,
                civ_id: None,
            },
        )
        .unwrap();
        assert_eq!(snapshot.civs[0].resources["food"], before + 25);
        rescore_all_civs(&mut snapshot);
        assert!(snapshot.civs[0].score.survival > 0.0);
    }

    #[test]
    fn player_harvest_depletes_tile_and_grants_yield() {
        let mut snapshot = test_snapshot("harvest-session", "Harvest", "mock-model", 42, 1);
        let tile = snapshot
            .world
            .tiles
            .iter()
            .find(|tile| tile.resource.as_deref() == Some("moss") && tile.amount > 1)
            .cloned()
            .expect("expected a moss tile");
        let before_food = snapshot.civs[0].resources["food"];
        let before_amount = tile.amount;
        apply_intervention_to_snapshot(
            &mut snapshot,
            &CivIntervention {
                kind: "harvest_resource".to_string(),
                target: "moss".to_string(),
                amount: Some(2),
                x: Some(tile.x),
                y: Some(tile.y),
                duration: None,
                intensity: None,
                entity_id: None,
                accessory: None,
                civ_id: None,
            },
        )
        .unwrap();
        assert_eq!(snapshot.civs[0].resources["food"], before_food + 2);
        let after_tile = snapshot
            .world
            .tiles
            .iter()
            .find(|item| item.x == tile.x && item.y == tile.y)
            .unwrap();
        assert_eq!(after_tile.amount, before_amount - 2);
        assert_eq!(after_tile.resource.as_deref(), Some("moss"));
    }

    #[test]
    fn player_mine_and_place_tile_edits_world() {
        let mut snapshot = test_snapshot("terrain-session", "Terrain", "mock-model", 42, 1);
        let cid = first_civ_id(&snapshot);
        let axo_id = snapshot
            .world
            .entities
            .iter()
            .find(|entity| entity.kind == "axolotl")
            .unwrap()
            .id
            .clone();
        let tile = snapshot
            .world
            .tiles
            .iter()
            .find(|tile| is_substrate(&tile.terrain) && tile.resource.is_none())
            .cloned()
            .expect("expected a mineable substrate tile");
        let expected_gain = terrain_yield_resource(&tile.terrain).to_string();
        let before_gain = snapshot.civs[0]
            .resources
            .get(&expected_gain)
            .copied()
            .unwrap_or(0);
        apply_intervention_to_snapshot(
            &mut snapshot,
            &CivIntervention {
                kind: "mine_tile".to_string(),
                target: tile.terrain.clone(),
                amount: Some(1),
                x: Some(tile.x),
                y: Some(tile.y),
                duration: None,
                intensity: None,
                entity_id: Some(axo_id.clone()),
                accessory: None,
                civ_id: Some(cid.clone()),
            },
        )
        .unwrap();
        let mined = snapshot
            .world
            .tiles
            .iter()
            .find(|item| item.x == tile.x && item.y == tile.y)
            .unwrap();
        assert!(!is_substrate(&mined.terrain));
        assert!(mined.resource.is_none());
        assert_eq!(
            snapshot.civs[0]
                .resources
                .get(&expected_gain)
                .copied()
                .unwrap_or(0),
            before_gain + 1
        );

        let before_stone = snapshot.civs[0].resources["stone"];
        apply_intervention_to_snapshot(
            &mut snapshot,
            &CivIntervention {
                kind: "place_tile".to_string(),
                target: "stone".to_string(),
                amount: Some(1),
                x: Some(tile.x),
                y: Some(tile.y),
                duration: None,
                intensity: None,
                entity_id: Some(axo_id),
                accessory: None,
                civ_id: Some(cid),
            },
        )
        .unwrap();
        let placed = snapshot
            .world
            .tiles
            .iter()
            .find(|item| item.x == tile.x && item.y == tile.y)
            .unwrap();
        assert_eq!(placed.terrain, "stone");
        assert_eq!(snapshot.civs[0].resources["stone"], before_stone - 1);
    }

    #[test]
    fn player_move_talk_and_building_use_have_sim_effects() {
        let mut snapshot = test_snapshot("player-session", "Player", "mock-model", 42, 1);
        let cid = first_civ_id(&snapshot);
        let axo_id = snapshot
            .world
            .entities
            .iter()
            .find(|entity| entity.kind == "axolotl")
            .unwrap()
            .id
            .clone();
        apply_intervention_to_snapshot(
            &mut snapshot,
            &CivIntervention {
                kind: "move_entity".to_string(),
                target: String::new(),
                amount: None,
                x: Some(12),
                y: Some(18),
                duration: None,
                intensity: None,
                entity_id: Some(axo_id.clone()),
                accessory: None,
                civ_id: Some(cid.clone()),
            },
        )
        .unwrap();
        let moved = snapshot
            .world
            .entities
            .iter()
            .find(|entity| entity.id == axo_id)
            .unwrap();
        assert_eq!((moved.x, moved.y), (12, 18));
        assert_eq!(moved.activity, "player");

        let morale_before = snapshot.civs[0].morale;
        let mood_before = moved.mood;
        apply_intervention_to_snapshot(
            &mut snapshot,
            &CivIntervention {
                kind: "talk_entity".to_string(),
                target: String::new(),
                amount: None,
                x: None,
                y: None,
                duration: None,
                intensity: None,
                entity_id: Some(axo_id.clone()),
                accessory: None,
                civ_id: Some(cid.clone()),
            },
        )
        .unwrap();
        let talked = snapshot
            .world
            .entities
            .iter()
            .find(|entity| entity.id == axo_id)
            .unwrap();
        assert!(talked.mood > mood_before);
        assert!(snapshot.civs[0].morale > morale_before);
        let mood_after_talk = talked.mood;
        let morale_after_talk = snapshot.civs[0].morale;
        apply_intervention_to_snapshot(
            &mut snapshot,
            &CivIntervention {
                kind: "talk_entity".to_string(),
                target: String::new(),
                amount: None,
                x: None,
                y: None,
                duration: None,
                intensity: None,
                entity_id: Some(axo_id.clone()),
                accessory: None,
                civ_id: Some(cid.clone()),
            },
        )
        .unwrap();
        let talked_again = snapshot
            .world
            .entities
            .iter()
            .find(|entity| entity.id == axo_id)
            .unwrap();
        assert_eq!(talked_again.mood, mood_after_talk);
        assert_eq!(snapshot.civs[0].morale, morale_after_talk);
        let task = active_player_task(&snapshot).expect("expected an active NPC request");
        *snapshot.civs[0]
            .resources
            .entry(task.resource.clone())
            .or_insert(0) = task.baseline + task.amount;
        let morale_before_complete = snapshot.civs[0].morale;
        apply_intervention_to_snapshot(
            &mut snapshot,
            &CivIntervention {
                kind: "talk_entity".to_string(),
                target: String::new(),
                amount: None,
                x: None,
                y: None,
                duration: None,
                intensity: None,
                entity_id: Some(axo_id.clone()),
                accessory: None,
                civ_id: Some(cid.clone()),
            },
        )
        .unwrap();
        assert!(active_player_task(&snapshot).is_none());
        assert_eq!(
            snapshot.civs[0]
                .resources
                .get(&task.resource)
                .copied()
                .unwrap_or(0),
            task.baseline,
        );
        assert!(snapshot.civs[0].morale > morale_before_complete);

        let pond_id = snapshot
            .world
            .entities
            .iter()
            .find(|entity| entity.kind == "building" && entity.role == "pond")
            .unwrap()
            .id
            .clone();
        let water_before = snapshot.civs[0].resources["clean_water"];
        apply_intervention_to_snapshot(
            &mut snapshot,
            &CivIntervention {
                kind: "use_building".to_string(),
                target: String::new(),
                amount: None,
                x: None,
                y: None,
                duration: None,
                intensity: None,
                entity_id: Some(pond_id),
                accessory: None,
                civ_id: Some(cid),
            },
        )
        .unwrap();
        assert_eq!(snapshot.civs[0].resources["clean_water"], water_before + 1);
        let water_after_use = snapshot.civs[0].resources["clean_water"];
        let pond_id = snapshot
            .world
            .entities
            .iter()
            .find(|entity| entity.kind == "building" && entity.role == "pond")
            .unwrap()
            .id
            .clone();
        let cid_again = first_civ_id(&snapshot);
        apply_intervention_to_snapshot(
            &mut snapshot,
            &CivIntervention {
                kind: "use_building".to_string(),
                target: String::new(),
                amount: None,
                x: None,
                y: None,
                duration: None,
                intensity: None,
                entity_id: Some(pond_id),
                accessory: None,
                civ_id: Some(cid_again),
            },
        )
        .unwrap();
        assert_eq!(snapshot.civs[0].resources["clean_water"], water_after_use);
    }

    #[test]
    fn scoring_rewards_protective_policies() {
        let mut snapshot = test_snapshot("test-session", "Test", "mock-model", 42, 1);
        let cid = first_civ_id(&snapshot);
        let base = score_civilization(&snapshot, &cid).ethics;
        snapshot.civs[0]
            .policies
            .push("protect_vulnerable".to_string());
        snapshot.civs[0].policies.push("share_equally".to_string());
        let improved = score_civilization(&snapshot, &cid).ethics;
        assert!(improved > base);
    }

    #[test]
    fn founding_colony_has_genetics() {
        let world = generate_world(2024, 1);
        let axos: Vec<_> = world
            .entities
            .iter()
            .filter(|e| e.kind == "axolotl")
            .collect();
        assert_eq!(axos.len() as u32, INITIAL_POPULATION);
        assert!(axos.iter().all(|a| a.genes.is_some()));
        assert!(axos.iter().all(|a| MORPHS.contains(&a.morph.as_str())));
        assert!(axos.iter().any(|a| a.sex == "f") && axos.iter().any(|a| a.sex == "m"));
        assert!(world.entities.iter().any(|e| e.role == "nest"));
    }

    #[test]
    fn genetics_cross_is_deterministic_and_valid() {
        let mut seed = 123;
        let a = random_genes(&mut seed, "wild");
        let b = random_genes(&mut seed, "albino");
        let mut r1 = 999;
        let c1 = cross_genes(&a, &b, &mut r1);
        let mut r2 = 999;
        let c2 = cross_genes(&a, &b, &mut r2);
        assert_eq!(c1.allele_a, c2.allele_a);
        assert_eq!(c1.allele_b, c2.allele_b);
        assert!(MORPHS.contains(&expressed_morph(&c1).as_str()));
        assert!((0.3..=1.0).contains(&c1.fertility));
    }

    #[test]
    fn life_cycle_lays_eggs_and_syncs_population() {
        let mut s = test_snapshot("life-test", "Life", "mock", 7, 1);
        let cid = first_civ_id(&s);
        let start = s.civs[0].population;
        let mut saw_egg = false;
        for t in 1..=14 {
            s.turn = t;
            s.civs[0].health = 92.0;
            s.civs[0].morale = 92.0;
            s.civs[0].resources.insert("food".to_string(), 250);
            s.civs[0].resources.insert("clean_water".to_string(), 250);
            resolve_environment(&mut s, &cid);
            if s.world.entities.iter().any(|e| e.kind == "egg") {
                saw_egg = true;
            }
        }
        assert!(
            saw_egg,
            "expected at least one egg to be laid over 14 turns"
        );
        let living = s
            .world
            .entities
            .iter()
            .filter(|e| e.kind == "axolotl" && e.stage != "egg")
            .count() as u32;
        assert_eq!(s.civs[0].population, living);
        assert!(s.civs[0].population >= start);
        // Every offspring egg/axolotl stays tagged to its civ.
        assert!(s
            .world
            .entities
            .iter()
            .filter(|e| e.kind == "axolotl" || e.kind == "egg")
            .all(|e| e.civ_id.as_deref() == Some(cid.as_str())));
    }

    #[test]
    fn equip_accessory_round_trips() {
        let mut s = test_snapshot("acc-test", "Acc", "mock", 5, 1);
        let id = s
            .world
            .entities
            .iter()
            .find(|e| e.kind == "axolotl")
            .unwrap()
            .id
            .clone();
        apply_intervention_to_snapshot(
            &mut s,
            &CivIntervention {
                kind: "equip_accessory".to_string(),
                target: String::new(),
                amount: None,
                x: None,
                y: None,
                duration: None,
                intensity: None,
                entity_id: Some(id.clone()),
                accessory: Some("crown".to_string()),
                civ_id: None,
            },
        )
        .unwrap();
        let ent = s.world.entities.iter().find(|e| e.id == id).unwrap();
        assert!(ent.accessories.iter().any(|a| a == "crown"));
    }

    #[test]
    fn extracts_json_from_markdown_response() {
        let decision = parse_model_decision(
            "```json\n{\"intent\":\"stabilize\",\"public_rationale\":\"food first\",\"actions\":[{\"type\":\"gather\",\"resource\":\"food\",\"workers\":2}],\"ethics_note\":\"share fairly\",\"expected_risks\":[\"slow tech\"]}\n```",
        )
        .unwrap();
        assert_eq!(decision.actions[0].action_type, "gather");
    }

    #[test]
    fn legacy_v1_snapshot_migrates_to_multi_civ() {
        // Build a current snapshot, then rewrite it into the legacy v1 shape:
        // top-level `model` + single `civilization`, no `civs`/`version`/`environment`,
        // and entities stripped of `civ_id` (as old saves were).
        let s = initial_snapshot(
            "legacy".to_string(),
            "Old Pond".to_string(),
            &[CivParticipant {
                name: "Old Pond".to_string(),
                model: "old-model".to_string(),
                color: None,
            }],
            9,
            1,
        );
        let mut value = serde_json::to_value(&s).unwrap();
        {
            let obj = value.as_object_mut().unwrap();
            let civ0 = obj.get("civs").unwrap().as_array().unwrap()[0].clone();
            obj.insert("civilization".to_string(), civ0);
            obj.insert("model".to_string(), serde_json::json!("old-model"));
            obj.remove("civs");
            obj.remove("version");
            obj.remove("environment");
            if let Some(entities) = obj
                .get_mut("world")
                .and_then(|w| w.get_mut("entities"))
                .and_then(|e| e.as_array_mut())
            {
                for entity in entities {
                    if let Some(map) = entity.as_object_mut() {
                        map.remove("civ_id");
                    }
                }
            }
        }
        let raw = serde_json::to_string(&value).unwrap();

        let migrated = parse_snapshot(&raw).unwrap();
        assert_eq!(migrated.version, SCHEMA_VERSION);
        assert_eq!(migrated.civs.len(), 1);
        assert_eq!(migrated.civs[0].id, FIRST_CIV_ID);
        assert_eq!(migrated.civs[0].model, "old-model");
        assert!(migrated.civs[0].alive);
        // Backfill re-tagged every colony entity and claimed a home region.
        assert!(migrated
            .world
            .entities
            .iter()
            .filter(|e| matches!(e.kind.as_str(), "axolotl" | "building"))
            .all(|e| e.civ_id.as_deref() == Some(FIRST_CIV_ID)));
        assert!(!migrated.civs[0].home_region.is_empty());
    }

    #[test]
    fn legacy_single_model_config_founds_one_civ() {
        // Legacy shape {name, model, seed} with no `civs` deserializes and
        // resolves to exactly one founding participant (back-compat, D-05).
        let raw = r#"{"name":"W","model":"kimi","seed":7}"#;
        let config: CivSessionConfig = serde_json::from_str(raw).unwrap();
        let participants = resolve_participants(&config).unwrap();
        assert_eq!(participants.len(), 1);
        assert_eq!(participants[0].model, "kimi");

        let snapshot = initial_snapshot("legacy-one".to_string(), "W".to_string(), &participants, 7, 1);
        assert_eq!(snapshot.civs.len(), 1);
        assert_eq!(snapshot.civs[0].model, "kimi");
        // Auto colour from the palette head.
        assert_eq!(snapshot.civs[0].color, CIV_COLORS[0]);
    }

    #[test]
    fn multi_participant_config_founds_n_civs_with_distinct_colors() {
        let raw = r##"{"name":"W","seed":7,"civs":[{"name":"A","model":"kimi"},{"name":"B","model":"deepseek","color":"#ff0000"}]}"##;
        let config: CivSessionConfig = serde_json::from_str(raw).unwrap();
        let participants = resolve_participants(&config).unwrap();
        assert_eq!(participants.len(), 2);
        // A gets the auto palette head; B keeps its override.
        assert_eq!(participants[0].color.as_deref(), Some(CIV_COLORS[0]));
        assert_eq!(participants[1].color.as_deref(), Some("#ff0000"));

        let snapshot = initial_snapshot("multi-2".to_string(), "W".to_string(), &participants, 7, 1);
        assert_eq!(snapshot.civs.len(), 2);
        assert_eq!(snapshot.civs[0].color, CIV_COLORS[0]);
        assert_eq!(snapshot.civs[1].color, "#ff0000");
        // Distinct colours and distinct ids.
        assert_ne!(snapshot.civs[0].color, snapshot.civs[1].color);
        assert_eq!(snapshot.civs[0].id, "civ-1");
        assert_eq!(snapshot.civs[1].id, "civ-2");
        assert_eq!(snapshot.civs[1].name, "B");
    }

    #[test]
    fn empty_config_errors() {
        // No civs and no model at all.
        let raw = r#"{"name":"W","seed":7}"#;
        let config: CivSessionConfig = serde_json::from_str(raw).unwrap();
        let err = resolve_participants(&config).unwrap_err();
        assert!(err.contains("at least one"), "unexpected error: {err}");
    }

    #[test]
    fn too_many_participants_errors() {
        let config = CivSessionConfig {
            name: "W".to_string(),
            seed: Some(7),
            civs: vec![
                CivParticipant { name: "A".to_string(), model: "m".to_string(), color: None },
                CivParticipant { name: "B".to_string(), model: "m".to_string(), color: None },
                CivParticipant { name: "C".to_string(), model: "m".to_string(), color: None },
                CivParticipant { name: "D".to_string(), model: "m".to_string(), color: None },
            ],
            model: None,
        };
        let err = resolve_participants(&config).unwrap_err();
        assert!(err.contains("at most 3"), "unexpected error: {err}");
    }

    #[test]
    fn fresh_civ_has_no_controller() {
        let s = test_snapshot("ctl", "C", "m", 3, 1);
        assert!(s.civs[0].controller.is_none());
    }

    #[test]
    fn leaderboard_includes_controller_key() {
        let s = test_snapshot("lb", "L", "m", 3, 1);
        let board = leaderboard(&s.civs);
        let first = &board[0];
        assert!(
            first.as_object().unwrap().contains_key("controller"),
            "leaderboard entry missing controller key"
        );
        assert!(first["controller"].is_null());
    }

    #[test]
    fn snapshot_missing_controller_key_deserializes() {
        // A saved civ JSON lacking "controller" still loads (serde default).
        let s = test_snapshot("mc", "M", "m", 3, 1);
        let mut value = serde_json::to_value(&s).unwrap();
        for civ in value["civs"].as_array_mut().unwrap() {
            civ.as_object_mut().unwrap().remove("controller");
        }
        let raw = serde_json::to_string(&value).unwrap();
        let loaded: CivSessionSnapshot = serde_json::from_str(&raw).unwrap();
        assert!(loaded.civs[0].controller.is_none());
    }

    #[test]
    fn push_decision_log_persists_civ_id_and_reasoning() {
        let mut s = test_snapshot("dl", "D", "m", 3, 1);
        let cid = first_civ_id(&s);
        push_decision_log(
            &mut s,
            &cid,
            "stabilize",
            "food first",
            "share fairly",
            Some("internal chain of thought".to_string()),
        );
        let entry = s.log.last().unwrap();
        assert_eq!(entry.kind, "ai_decision");
        assert_eq!(entry.civ_id.as_deref(), Some(cid.as_str()));
        assert_eq!(entry.reasoning.as_deref(), Some("internal chain of thought"));
    }

    #[test]
    fn log_entry_missing_civ_id_reasoning_deserializes() {
        let raw = r#"{"turn":1,"kind":"session","title":"t","body":"b","created_at":0}"#;
        let entry: CivLogEntry = serde_json::from_str(raw).unwrap();
        assert!(entry.civ_id.is_none());
        assert!(entry.reasoning.is_none());
    }

    #[test]
    fn civ_does_not_collapse_while_eggs_remain() {
        let mut s = test_snapshot("collapse", "C", "m", 11, 1);
        let cid = first_civ_id(&s);
        // Wipe the colony's axolotls but leave its buildings and a single egg.
        s.world.entities.retain(|e| e.kind == "building");
        s.world.entities.push(CivEntity {
            id: "egg-test".to_string(),
            kind: "egg".to_string(),
            name: "Egg".to_string(),
            x: 10,
            y: 40,
            health: 100.0,
            mood: 100.0,
            role: "egg".to_string(),
            civ_id: Some(cid.clone()),
            stage: "egg".to_string(),
            genes: Some(default_genes()),
            hatches_in: Some(2),
            ..Default::default()
        });
        s.civs[0].population = 0;
        // An egg can still hatch and revive the colony, so it must not collapse yet.
        assert!(!should_collapse(&s, &cid));
        // With no eggs left, a population-0 colony truly collapses.
        s.world.entities.retain(|e| e.kind != "egg");
        assert!(should_collapse(&s, &cid));
    }

    fn gather_action(resource: &str, workers: u32) -> CivDecisionAction {
        CivDecisionAction {
            action_type: "gather".to_string(),
            resource: Some(resource.to_string()),
            workers: Some(workers),
            building: None,
            x: None,
            y: None,
            tech_id: None,
            direction: None,
            policy: None,
            event_id: None,
        }
    }

    #[test]
    fn world_has_depth_banded_veins() {
        // Bucket every resourced substrate tile by depth below its column's seabed:
        // deep veins should be fewer but richer than shallow ones.
        let w = generate_world(2024, 1);
        let mut shallow = (0u32, 0i64); // (count, sum amount) for depth 2..8
        let mut deep = (0u32, 0i64); //   (count, sum amount) for depth >= 18
        for t in &w.tiles {
            if t.resource.is_none() || !is_substrate(&t.terrain) {
                continue;
            }
            let floor = seabed_row_at(&w, t.x);
            if t.y <= floor {
                continue;
            }
            let d = t.y - floor;
            if (2..8).contains(&d) {
                shallow.0 += 1;
                shallow.1 += i64::from(t.amount);
            } else if d >= 18 {
                deep.0 += 1;
                deep.1 += i64::from(t.amount);
            }
        }
        assert!(shallow.0 > 0, "expected shallow veins");
        assert!(deep.0 > 0, "expected deep veins");
        assert!(
            deep.0 < shallow.0,
            "deep veins should be rarer than shallow"
        );
        let shallow_mean = shallow.1 as f64 / f64::from(shallow.0);
        let deep_mean = deep.1 as f64 / f64::from(deep.0);
        assert!(
            deep_mean > shallow_mean,
            "deep veins should be richer (deep mean {deep_mean} vs shallow {shallow_mean})"
        );
    }

    #[test]
    fn mining_caps_yield_and_floods_emptied_block() {
        let mut s = test_snapshot("mine", "M", "m", 5, 1);
        let cid = first_civ_id(&s);
        let (cx, _) = colony_center(&s, &cid);
        // Leave exactly one ore block (5 units) on the colony's seabed; clear the
        // rest so it is unambiguously the nearest.
        for t in s.world.tiles.iter_mut() {
            if t.resource.as_deref() == Some("ore") {
                t.resource = None;
                t.amount = 0;
            }
        }
        // A BURIED ore block (below the seabed surface) floods when mined out.
        let ty = seabed_row_at(&s.world, cx) + 5;
        {
            let tile = s
                .world
                .tiles
                .iter_mut()
                .find(|t| t.x == cx && t.y == ty)
                .expect("a buried substrate tile below the colony");
            tile.resource = Some("ore".to_string());
            tile.amount = 5;
        }
        let before = *s.civs[0].resources.get("ore").unwrap_or(&0);
        // 8 workers would gather 24, but the block only holds 5.
        gather(&mut s, &cid, &gather_action("ore", 8));
        let after = *s.civs[0].resources.get("ore").unwrap_or(&0);
        assert_eq!(after - before, 5, "yield is capped by the block's amount");
        let tile = s
            .world
            .tiles
            .iter()
            .find(|t| t.x == cx && t.y == ty)
            .unwrap();
        assert_eq!(tile.amount, 0);
        assert!(
            tile.resource.is_none(),
            "an emptied block clears its resource"
        );
        assert!(
            tile.terrain == "water" || tile.terrain == "deepwater",
            "an emptied block floods to water, got {}",
            tile.terrain
        );
    }

    #[test]
    fn renewable_gather_is_not_block_limited() {
        let mut s = test_snapshot("ren", "R", "m", 5, 1);
        let cid = first_civ_id(&s);
        // No moss tiles anywhere: food (a renewable) must still yield its flat rate.
        for t in s.world.tiles.iter_mut() {
            if t.resource.as_deref() == Some("moss") {
                t.resource = None;
                t.amount = 0;
            }
        }
        let before = *s.civs[0].resources.get("food").unwrap_or(&0);
        gather(&mut s, &cid, &gather_action("food", 8));
        let after = *s.civs[0].resources.get("food").unwrap_or(&0);
        assert_eq!(
            after - before,
            24,
            "renewables keep a flat yield even with no block"
        );
    }

    #[test]
    fn mining_a_surface_block_keeps_the_ground_solid() {
        // Stripping ore from a seabed-SURFACE block must not flood it — the seabed
        // stays solid/buildable so default building placement can't fall into a hole.
        let mut s = test_snapshot("surf", "S", "m", 5, 1);
        let cid = first_civ_id(&s);
        let (cx, _) = colony_center(&s, &cid);
        for t in s.world.tiles.iter_mut() {
            if t.resource.as_deref() == Some("stone") {
                t.resource = None;
                t.amount = 0;
            }
        }
        let surface = seabed_row_at(&s.world, cx);
        {
            let tile = s
                .world
                .tiles
                .iter_mut()
                .find(|t| t.x == cx && t.y == surface)
                .expect("the seabed-surface tile");
            tile.resource = Some("stone".to_string());
            tile.amount = 3;
        }
        gather(&mut s, &cid, &gather_action("stone", 8));
        let tile = s
            .world
            .tiles
            .iter()
            .find(|t| t.x == cx && t.y == surface)
            .unwrap();
        assert_eq!(tile.amount, 0);
        assert!(tile.resource.is_none());
        assert!(
            is_substrate(&tile.terrain),
            "a mined SURFACE block stays solid ground, got {}",
            tile.terrain
        );
        // The seabed top for the column is unchanged (no crater).
        assert_eq!(seabed_row_at(&s.world, cx), surface);
    }

    #[test]
    fn mining_requires_tools() {
        let mut s = test_snapshot("tools", "T", "m", 5, 1);
        let cid = first_civ_id(&s);
        let (cx, _) = colony_center(&s, &cid);
        for t in s.world.tiles.iter_mut() {
            if t.resource.as_deref() == Some("ore") {
                t.resource = None;
                t.amount = 0;
            }
        }
        let ty = seabed_row_at(&s.world, cx) + 5;
        {
            let tile = s
                .world
                .tiles
                .iter_mut()
                .find(|t| t.x == cx && t.y == ty)
                .expect("a buried substrate tile");
            tile.resource = Some("ore".to_string());
            tile.amount = 8;
        }
        // A fresh colony has no stone tools, so ore is unminable (tier 2 > tier 1).
        s.civs[0]
            .techs
            .retain(|t| t != "stone_tools" && t != "metal_tools");
        assert_eq!(mining_tier(&s.civs[0]), 1);
        let before = *s.civs[0].resources.get("ore").unwrap_or(&0);
        gather(&mut s, &cid, &gather_action("ore", 8));
        assert_eq!(
            *s.civs[0].resources.get("ore").unwrap_or(&0),
            before,
            "ore cannot be mined without stone_tools"
        );
        // Stone tools unlock ore (tier 2); glowshards still need metal tools.
        s.civs[0].techs.push("stone_tools".to_string());
        assert_eq!(mining_tier(&s.civs[0]), 2);
        gather(&mut s, &cid, &gather_action("ore", 8));
        assert!(
            *s.civs[0].resources.get("ore").unwrap_or(&0) > before,
            "ore is mined once stone_tools is researched"
        );
        assert!(required_mining_tier("glowshards") > mining_tier(&s.civs[0]));
    }

    #[test]
    fn tool_tech_chain_is_acyclic() {
        // stone_tools must be buyable with tier-1 (no-tools) materials.
        for (res, _) in tech_cost("stone_tools") {
            assert!(
                required_mining_tier(&res) <= 1,
                "stone_tools costs {res}, which needs tools to mine -> deadlock"
            );
        }
        // metal_tools must be buyable once stone_tools (tier 2) is in hand.
        for (res, _) in tech_cost("metal_tools") {
            assert!(
                required_mining_tier(&res) <= 2,
                "metal_tools costs {res}, which needs tier-3 tools -> deadlock"
            );
        }
    }

    /// Builds an N-civ snapshot by cloning the founding civ into civ-1..civ-N.
    /// (World entities stay tagged to civ-1 — these tests only exercise the civ
    /// list, turn order, and intervention targeting, none of which read entities.)
    fn multi_civ_snapshot(seed: u32, n: usize) -> CivSessionSnapshot {
        let mut s = test_snapshot("multi", "Multi", "m", seed, 1);
        let base = s.civs[0].clone();
        for i in 1..n {
            let mut c = base.clone();
            c.id = civ_id_for(i);
            c.name = format!("Civ {}", i + 1);
            s.civs.push(c);
        }
        s
    }

    #[test]
    fn civ_turn_order_covers_living_civs_deterministically() {
        let mut s = multi_civ_snapshot(2024, 5);
        s.civs[2].alive = false; // collapse civ-3
        s.turn = 7;
        let a = civ_turn_order(&s);
        let b = civ_turn_order(&s);
        assert_eq!(a, b, "order must be deterministic for a fixed (seed, turn)");
        assert_eq!(a.len(), 4, "only the four living civs decide");
        assert!(!a.contains(&civ_id_for(2)), "the collapsed civ is skipped");
        let mut seen = a.clone();
        seen.sort();
        seen.dedup();
        assert_eq!(seen.len(), 4, "every living civ appears exactly once");
    }

    #[test]
    fn civ_turn_order_rotates_first_mover_across_turns() {
        // The civ that acts first must change across turns, or civ-1 keeps a
        // permanent first-mover advantage racing rivals to shared finite blocks.
        let s = multi_civ_snapshot(2024, 4);
        let mut firsts = std::collections::HashSet::new();
        for turn in 1..=24 {
            let mut st = s.clone();
            st.turn = turn;
            if let Some(first) = civ_turn_order(&st).into_iter().next() {
                firsts.insert(first);
            }
        }
        assert!(
            firsts.len() > 1,
            "first-mover should rotate across turns, saw {firsts:?}"
        );
    }

    #[test]
    fn intervention_targets_named_civ() {
        let mut s = multi_civ_snapshot(42, 3);
        let before0 = s.civs[0].resources["food"];
        let before1 = s.civs[1].resources["food"];
        apply_intervention_to_snapshot(
            &mut s,
            &CivIntervention {
                kind: "grant_resource".to_string(),
                target: "food".to_string(),
                amount: Some(20),
                x: None,
                y: None,
                duration: None,
                intensity: None,
                entity_id: None,
                accessory: None,
                civ_id: Some(civ_id_for(1)), // civ-2
            },
        )
        .unwrap();
        assert_eq!(
            s.civs[1].resources["food"],
            before1 + 20,
            "the named civ is granted"
        );
        assert_eq!(
            s.civs[0].resources["food"], before0,
            "other civs are untouched"
        );
    }

    #[test]
    fn intervention_unknown_civ_is_rejected() {
        let mut s = multi_civ_snapshot(42, 2);
        let err = apply_intervention_to_snapshot(
            &mut s,
            &CivIntervention {
                kind: "grant_resource".to_string(),
                target: "food".to_string(),
                amount: Some(20),
                x: None,
                y: None,
                duration: None,
                intensity: None,
                entity_id: None,
                accessory: None,
                civ_id: Some("civ-99".to_string()),
            },
        )
        .unwrap_err();
        assert!(err.contains("unknown civ"), "got: {err}");
    }

    #[test]
    fn intervention_without_civ_id_targets_first_living_civ() {
        // Back-compat: a collapsed first civ is skipped for the next living one.
        let mut s = multi_civ_snapshot(42, 2);
        s.civs[0].alive = false;
        let before0 = s.civs[0].resources["food"];
        let before1 = s.civs[1].resources["food"];
        apply_intervention_to_snapshot(
            &mut s,
            &CivIntervention {
                kind: "grant_resource".to_string(),
                target: "food".to_string(),
                amount: Some(15),
                x: None,
                y: None,
                duration: None,
                intensity: None,
                entity_id: None,
                accessory: None,
                civ_id: None,
            },
        )
        .unwrap();
        assert_eq!(
            s.civs[1].resources["food"],
            before1 + 15,
            "the first living civ receives it"
        );
        assert_eq!(
            s.civs[0].resources["food"], before0,
            "the collapsed civ is skipped"
        );
    }
}

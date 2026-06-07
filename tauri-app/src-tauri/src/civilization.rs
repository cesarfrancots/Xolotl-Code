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
    /// Target civ id (attack/diplomacy/trade) or target region id (claim).
    #[serde(default)]
    pub target: Option<String>,
    /// Diplomacy stance for diplomacy/set_stance: "ally|trade|neutral|hostile".
    #[serde(default)]
    pub stance: Option<String>,
    /// trade: the resource wanted in return (the give-resource reuses `resource`).
    #[serde(default)]
    pub receive: Option<String>,
    /// trade: amount of `resource` to give.
    #[serde(default)]
    pub amount: Option<u32>,
    /// trade: amount of `receive` to get back.
    #[serde(default)]
    pub receive_amount: Option<u32>,
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
    // Advance the world's environment at TURN START so each civ observes the freshly
    // drifted season/forecast and any fired disaster's reshape this same turn; a
    // fired disaster's CivModifier rides the existing post-loop resolve_environment +
    // tick_modifiers below.
    tick_environment(&mut snapshot);

    // Each living civ decides and acts, in a deterministic per-turn shuffled order
    // so first-mover advantage on shared resources rotates fairly across civs.
    let turn_order = civ_turn_order(&snapshot);

    // Attacks are QUEUED during the decision loop, not resolved inline, so all attacks
    // declared this turn resolve together in one deterministic attacker-sorted pass
    // after the loop (WAR-02, Pitfall 2). Each entry is (attacker_civ_id, target_civ_id).
    let mut attacks: Vec<(String, String)> = Vec::new();

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

        // Collect attack/raid intents to resolve in the post-loop combat pass. The
        // action was already validated in 04-01's validate_action; here we only record
        // (attacker, target) — resolution is deferred so order is deterministic, not
        // dependent on the shuffled decision order.
        for action in &decision.actions {
            if matches!(action.action_type.as_str(), "attack" | "raid") {
                if let Some(target) = action.target.as_deref() {
                    if !target.trim().is_empty() {
                        attacks.push((civ_id.clone(), target.to_string()));
                    }
                }
            }
        }
    }

    // COMBAT WORLD PASS — runs AFTER the decision loop and BEFORE resolve_environment,
    // so casualties (entity removals) land before run_life_cycle re-syncs the
    // population mirror this same turn (WAR-02).
    resolve_combat(&mut snapshot, &mut attacks);

    // PREDATOR WORLD PASS — runs AFTER combat and BEFORE resolve_environment (WAR-04),
    // so predator hunt casualties (entity removals) also land before the population
    // mirror re-syncs. Order: decision loop → resolve_combat → step_predators →
    // resolve_environment. Uses its own predator salt (uncorrelated with combat).
    step_predators(&mut snapshot);

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
                    "id": region.id,
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
         - claim: target = an unclaimed region id (see visible_world.biome_regions[].id) adjacent to your territory; omit target to auto-expand to an adjacent unclaimed region\n\
         - attack: target = a rival civ id (refused if that civ is your ally); plunders resources and can seize a region on a decisive win\n\
         - diplomacy: target = a rival civ id, stance one of ally, trade, neutral, hostile\n\
         - trade: target = a rival civ id, resource + amount to give, receive + receive_amount to get (blocked if either side is hostile)\n\
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
        "claim" => {
            // target optional: present = a specific region id; absent = deterministic
            // adjacent expansion. Nothing required to validate here.
        }
        "attack" | "raid" => {
            // The attack RESOLUTION lands in 04-02; validating the target field now
            // gates it harmlessly so the queue+combat pass only adds resolution.
            if action
                .target
                .as_deref()
                .unwrap_or_default()
                .trim()
                .is_empty()
            {
                return Err("attack.target (rival civ id) is required".to_string());
            }
        }
        "diplomacy" | "set_stance" => {
            let stance = action
                .stance
                .as_deref()
                .ok_or("diplomacy.stance is required")?;
            if !matches!(stance, "ally" | "trade" | "neutral" | "hostile") {
                return Err(format!("unknown stance: {stance}"));
            }
            if action
                .target
                .as_deref()
                .unwrap_or_default()
                .trim()
                .is_empty()
            {
                return Err("diplomacy.target (rival civ id) is required".to_string());
            }
        }
        "trade" => {
            if action
                .target
                .as_deref()
                .unwrap_or_default()
                .trim()
                .is_empty()
            {
                return Err("trade.target (rival civ id) is required".to_string());
            }
            if action.resource.is_none() || action.receive.is_none() {
                return Err("trade requires resource (to give) and receive (to get)".to_string());
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
            "claim" => match claim_region(snapshot, civ_id, action.target.as_deref()) {
                Ok(region_id) => push_log(
                    snapshot,
                    "claim",
                    &format!("{} claimed territory", civ_label(snapshot, civ_id)),
                    &format!(
                        "Region {region_id} is now held by {}.",
                        civ_label(snapshot, civ_id)
                    ),
                ),
                Err(why) => push_log(
                    snapshot,
                    "claim",
                    &format!("{}'s claim failed", civ_label(snapshot, civ_id)),
                    &why,
                ),
            },
            "diplomacy" | "set_stance" => {
                if let (Some(t), Some(st)) = (action.target.as_deref(), action.stance.as_deref()) {
                    set_stance(snapshot, civ_id, t, st);
                    push_log(
                        snapshot,
                        "diplomacy",
                        &format!(
                            "{} set stance {st} toward {}",
                            civ_label(snapshot, civ_id),
                            civ_label(snapshot, t)
                        ),
                        "Diplomatic posture updated.",
                    );
                }
            }
            "trade" => {
                if let (Some(t), Some(give), Some(recv)) = (
                    action.target.as_deref(),
                    action.resource.as_deref(),
                    action.receive.as_deref(),
                ) {
                    let give_amt = i32::try_from(action.amount.unwrap_or(0)).unwrap_or(i32::MAX);
                    let recv_amt =
                        i32::try_from(action.receive_amount.unwrap_or(0)).unwrap_or(i32::MAX);
                    match apply_trade(snapshot, civ_id, t, give, give_amt, recv, recv_amt) {
                        Ok(()) => push_log(
                            snapshot,
                            "trade",
                            &format!(
                                "{} traded with {}",
                                civ_label(snapshot, civ_id),
                                civ_label(snapshot, t)
                            ),
                            &format!("Gave {give_amt} {give}, received {recv_amt} {recv}."),
                        ),
                        Err(why) => push_log(
                            snapshot,
                            "trade",
                            &format!("{}'s trade failed", civ_label(snapshot, civ_id)),
                            &why,
                        ),
                    }
                }
            }
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

/// Write `civ_id`'s diplomacy stance toward `target` (WAR-03). The stance value is
/// validated upstream in `validate_action`; here we just persist it. Self-targeting
/// and unknown targets are defensive no-ops so a malformed model decision can never
/// corrupt the map or panic (T-04-01).
fn set_stance(snapshot: &mut CivSessionSnapshot, civ_id: &str, target: &str, stance: &str) {
    let Some(ci) = civ_index(snapshot, civ_id) else {
        return;
    };
    if target == civ_id || civ_index(snapshot, target).is_none() {
        return;
    }
    snapshot.civs[ci]
        .diplomacy
        .insert(target.to_string(), stance.to_string());
}

/// Claim a region for `civ_id` (WAR-01). Generalizes the home-claim at spawn: a civ
/// may claim an UNCLAIMED region that is ADJACENT to territory it already owns. With
/// an explicit `target` region id, that region is claimed (rejected if owned or
/// non-adjacent); without one, the deterministically-lowest-id adjacent unclaimed
/// region is claimed. Returns the claimed region id on success. Ownership only ever
/// flips away from a civ via a raid (04-02), never by claim (T-04-06).
fn claim_region(
    snapshot: &mut CivSessionSnapshot,
    civ_id: &str,
    target: Option<&str>,
) -> Result<String, String> {
    if civ_index(snapshot, civ_id).is_none() {
        return Err("unknown civ".to_string());
    }
    // This civ's owned [x, x+width) intervals, plus its spawn column (the home seed).
    let owned: Vec<(u32, u32)> = snapshot
        .world
        .regions
        .iter()
        .filter(|r| r.owner.as_deref() == Some(civ_id))
        .map(|r| (r.x, r.x + r.width))
        .collect();
    let spawn_x = civ_index(snapshot, civ_id).map(|ci| snapshot.civs[ci].spawn_x);

    // A region is adjacent if its interval borders or overlaps any owned interval,
    // or it contains this civ's spawn column (the first claim from home).
    let is_adjacent = |r: &CivRegion| -> bool {
        let (lo, hi) = (r.x, r.x + r.width);
        if let Some(sx) = spawn_x {
            if sx >= lo && sx < hi {
                return true;
            }
        }
        owned.iter().any(|&(olo, ohi)| lo <= ohi && olo <= hi)
    };

    if let Some(region_id) = target {
        let region = snapshot
            .world
            .regions
            .iter_mut()
            .find(|r| r.id == region_id)
            .ok_or_else(|| format!("no such region: {region_id}"))?;
        if region.owner.is_some() {
            return Err(format!("region {region_id} is already owned"));
        }
        if !is_adjacent(region) {
            return Err(format!(
                "region {region_id} is not adjacent to your territory"
            ));
        }
        region.owner = Some(civ_id.to_string());
        Ok(region_id.to_string())
    } else {
        // Pick the deterministically-lowest-id unclaimed adjacent region.
        let mut candidates: Vec<String> = snapshot
            .world
            .regions
            .iter()
            .filter(|r| r.owner.is_none() && is_adjacent(r))
            .map(|r| r.id.clone())
            .collect();
        candidates.sort();
        let region_id = candidates
            .into_iter()
            .next()
            .ok_or("no adjacent unclaimed region to expand into")?;
        if let Some(region) = snapshot
            .world
            .regions
            .iter_mut()
            .find(|r| r.id == region_id)
        {
            region.owner = Some(civ_id.to_string());
        }
        Ok(region_id)
    }
}

/// Deterministic two-civ resource swap (WAR-03). Both gives are capped at the
/// giver's current holdings, drained via `consume` (clamps >=0) and credited to the
/// receiver with the SAME capped amount, so totals are conserved and no resource can
/// go negative (T-04-04). Blocked (returns Err, mutates nothing) when either side has
/// declared the other hostile (T-04-05). Self-trade is rejected.
///
/// Borrow discipline: both holdings are read into copied scalars FIRST, then all of
/// one civ's map mutations are applied, then the other's — never interleaving a live
/// `&mut` borrow of `civs[fi]` with one of `civs[ti]`.
fn apply_trade(
    snapshot: &mut CivSessionSnapshot,
    from: &str,
    to: &str,
    give: &str,
    give_amt: i32,
    recv: &str,
    recv_amt: i32,
) -> Result<(), String> {
    let fi = civ_index(snapshot, from).ok_or("unknown from civ")?;
    let ti = civ_index(snapshot, to).ok_or("unknown to civ")?;
    if fi == ti {
        return Err("cannot trade with self".to_string());
    }
    // Block if either side declared the other hostile.
    let hostile = snapshot.civs[fi].diplomacy.get(to).map(String::as_str) == Some("hostile")
        || snapshot.civs[ti].diplomacy.get(from).map(String::as_str) == Some("hostile");
    if hostile {
        return Err("trade blocked: hostile stance".to_string());
    }
    // Read both holdings first (copied i32) so nothing goes negative and totals conserve.
    let give_have = *snapshot.civs[fi].resources.get(give).unwrap_or(&0);
    let recv_have = *snapshot.civs[ti].resources.get(recv).unwrap_or(&0);
    let g = give_amt.max(0).min(give_have);
    let r = recv_amt.max(0).min(recv_have);
    // Civ-by-civ mutation: drain `from`'s give + credit its received resource, THEN
    // drain `to`'s give + credit its received resource. No interleaved &mut borrows.
    consume(&mut snapshot.civs[fi].resources, give, g);
    *snapshot.civs[fi]
        .resources
        .entry(recv.to_string())
        .or_insert(0) += r;
    consume(&mut snapshot.civs[ti].resources, recv, r);
    *snapshot.civs[ti]
        .resources
        .entry(give.to_string())
        .or_insert(0) += g;
    Ok(())
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

// --- Combat engine: pure, seed-deterministic helpers (W6 / WAR-02, WAR-03) ---
//
// All combat math is replay-stable: it reads only snapshot state, removes axolotl
// ENTITIES for casualties (the population counter is a mirror re-synced in
// `run_life_cycle`, civilization.rs:2897), drains/credits resources via `consume`
// (clamped >=0), and selects victims by sorted entity id. The combat pass that
// drives these (in `advance_civ_turn`) seeds one rng with the distinct combat salt
// `0xC0FF_EE01` and resolves attacks in attacker-sorted order — see `resolve_combat`.

/// Per-attack ceiling on the fraction of either side's living axolotls that can die
/// in a single strike. A hard cap (plus the >=1-survivor clamp in `bounded_loss`)
/// guarantees no instant wipeout — a civ can only fall through attrition + the
/// existing `should_collapse` gate (T-04-02).
const CASUALTY_CAP: f32 = 0.34;
/// Strength ratio above which a raid is a DECISIVE win (plunder + region seize).
const WIN_THRESHOLD: f32 = 1.3;
/// Fraction of a held resource a decisive raid plunders (bounded + conserved).
const PLUNDER_FRAC: f32 = 0.20;

/// Deterministic combat strength of `civ_id`. Monotonic in population, the `tools`
/// resource, tech count, and owned-territory count. THE Phase-5 seam: the genetic
/// `strength` gene term plugs in HERE and nowhere else. Returns 0.0 for an unknown
/// civ. `f64` intermediates dodge clippy `cast_precision_loss`; the final `as f32`
/// passes through `round1` for replay-clean floats.
fn civ_strength(snapshot: &CivSessionSnapshot, civ_id: &str) -> f32 {
    let Some(ci) = civ_index(snapshot, civ_id) else {
        return 0.0;
    };
    let c = &snapshot.civs[ci];
    let pop = f64::from(c.population);
    let tools = f64::from(*c.resources.get("tools").unwrap_or(&0));
    let tech = c.techs.len() as f64;
    let owned = snapshot
        .world
        .regions
        .iter()
        .filter(|r| r.owner.as_deref() == Some(civ_id))
        .count() as f64;
    // Phase-5 SEAM: add a `genes.strength` term to this sum here only.
    round1((pop * 1.0 + tools * 0.2 + tech * 1.5 + owned * 2.0) as f32)
}

/// Living (non-egg) axolotl entities of `civ_id`. Eggs survive a raid — only living
/// axolotls fight and fall.
fn living_axolotl_count(snapshot: &CivSessionSnapshot, civ_id: &str) -> u32 {
    civ_entities(snapshot, civ_id)
        .filter(|e| e.kind == "axolotl" && e.stage != "egg")
        .count() as u32
}

/// Remove up to `n` living axolotl entities of `civ_id`, returning the count killed.
/// Casualties are entity removals (NOT a `population` decrement — the counter is a
/// mirror, civilization.rs:2897); the population re-syncs from the survivors in the
/// next `run_life_cycle`, which is why the combat pass MUST run before
/// `resolve_environment`. Victims are chosen by sorted entity id for replay
/// determinism (mirrors the elder-death retain at civilization.rs:2778).
fn kill_axolotls(snapshot: &mut CivSessionSnapshot, civ_id: &str, n: u32) -> u32 {
    if n == 0 {
        return 0;
    }
    let mut victims: Vec<String> = snapshot
        .world
        .entities
        .iter()
        .filter(|e| e.kind == "axolotl" && e.stage != "egg" && e.civ_id.as_deref() == Some(civ_id))
        .map(|e| e.id.clone())
        .collect();
    victims.sort();
    victims.truncate(n as usize);
    let killed = victims.len() as u32;
    if killed > 0 {
        snapshot.world.entities.retain(|e| !victims.contains(&e.id));
    }
    killed
}

/// Convert a casualty `frac` of `civ_id`'s living axolotls into a count that ALWAYS
/// leaves at least one survivor (so a single attack can never reach 0 — T-04-02).
/// `frac` is pre-clamped to `CASUALTY_CAP` by the caller; this clamps the resulting
/// count to `living - 1`.
fn bounded_loss(snapshot: &CivSessionSnapshot, civ_id: &str, frac: f32) -> u32 {
    let living = living_axolotl_count(snapshot, civ_id);
    if living <= 1 {
        return 0;
    }
    let count = (f64::from(living) * f64::from(frac.clamp(0.0, CASUALTY_CAP))) as u32;
    count.min(living.saturating_sub(1))
}

/// Plunder a BOUNDED, CONSERVED share of `defender`'s resources to `attacker` on a
/// decisive win. For each plundered key the take is `floor(have * PLUNDER_FRAC)`,
/// drained from the defender via `consume` (clamps >=0) and credited verbatim to the
/// attacker — so the attacker's gain == the defender's loss and nothing goes negative
/// (T-04-04). Borrow discipline mirrors `apply_trade`: read the defender's holdings
/// into copied scalars FIRST, then mutate one civ's map fully, then the other's.
fn plunder(snapshot: &mut CivSessionSnapshot, attacker: &str, defender: &str) {
    let Some(ai) = civ_index(snapshot, attacker) else {
        return;
    };
    let Some(di) = civ_index(snapshot, defender) else {
        return;
    };
    if ai == di {
        return;
    }
    // Read phase: copy (key, take) pairs from the defender's holdings, sorted by key
    // for a deterministic plunder order (no HashMap iteration leaking into state).
    let mut takes: Vec<(String, i32)> = snapshot.civs[di]
        .resources
        .iter()
        .filter_map(|(key, &have)| {
            let take = (f64::from(have) * f64::from(PLUNDER_FRAC)) as i32;
            if take > 0 {
                Some((key.clone(), take))
            } else {
                None
            }
        })
        .collect();
    takes.sort();
    // Write phase: drain the defender, then credit the attacker the same amounts.
    for (key, take) in &takes {
        consume(&mut snapshot.civs[di].resources, key, *take);
    }
    for (key, take) in &takes {
        *snapshot.civs[ai].resources.entry(key.clone()).or_insert(0) += *take;
    }
}

/// Seize ONE of `defender`'s regions for `attacker` on a decisive win (Open Q2:
/// auto-seize, no extra action field). Prefers a PERIPHERAL region — the defender's
/// `home_region` is dropped from the candidate set when it owns more than one — so a
/// raid bites the frontier first. A cornered civ that owns only its home region can
/// still lose it (territory is fully contestable). Region ids are sorted for
/// deterministic selection.
fn seize_region(snapshot: &mut CivSessionSnapshot, attacker: &str, defender: &str) {
    let home = civ_index(snapshot, defender)
        .map(|di| snapshot.civs[di].home_region.clone())
        .unwrap_or_default();
    let mut owned: Vec<String> = snapshot
        .world
        .regions
        .iter()
        .filter(|r| r.owner.as_deref() == Some(defender))
        .map(|r| r.id.clone())
        .collect();
    owned.sort();
    if owned.len() > 1 {
        owned.retain(|id| id != &home);
    }
    if let Some(region_id) = owned.into_iter().next() {
        if let Some(region) = snapshot
            .world
            .regions
            .iter_mut()
            .find(|r| r.id == region_id)
        {
            region.owner = Some(attacker.to_string());
        }
    }
}

/// Resolve a single deterministic attack of `attacker` against `defender`, returning
/// whether it was a DECISIVE win. WAR-02 + WAR-03. Invariants (all tested):
/// - **Ally gate (WAR-03, unilateral):** if the attacker's own stance toward the
///   defender is `ally`, the attack is a logged no-op — no casualties, plunder, or
///   flip — and the function returns false. This is the chosen UNILATERAL rule.
/// - **Determinism:** outcome derives only from `civ_strength` and the seeded `rng`
///   (a `seed^turn^0xC0FF_EE01` stream threaded by the caller). No clock/uuid.
/// - **Bounded casualties:** both sides lose entities via `kill_axolotls`, capped at
///   `CASUALTY_CAP` and always leaving >=1 survivor (no instant wipeout, T-04-02).
/// - **Conserved plunder + region seize** only on a decisive win.
///
/// A missing/collapsed civ on either side is a guarded no-op (returns false, T-04-01).
fn resolve_attack(
    snapshot: &mut CivSessionSnapshot,
    attacker: &str,
    defender: &str,
    rng: &mut u32,
) -> bool {
    let Some(ai) = civ_index(snapshot, attacker) else {
        return false;
    };
    if civ_index(snapshot, defender).is_none() || attacker == defender {
        return false;
    }
    // Ally gate (WAR-03, UNILATERAL): the attacker refuses to strike a civ it has
    // itself flagged `ally`. Logged no-op; no mutation of either side's state.
    let allied = snapshot.civs[ai]
        .diplomacy
        .get(defender)
        .map(String::as_str)
        == Some("ally");
    if allied {
        push_log(
            snapshot,
            "combat",
            &format!(
                "{} refuses to attack an ally",
                civ_label(snapshot, attacker)
            ),
            &format!(
                "{} holds an alliance with {} and will not raid it.",
                civ_label(snapshot, attacker),
                civ_label(snapshot, defender)
            ),
        );
        return false;
    }

    let a = civ_strength(snapshot, attacker);
    // Defender home-territory bonus: a defender fighting on home soil is sturdier.
    let home_bonus = civ_index(snapshot, defender)
        .map(|di| {
            let home = snapshot.civs[di].home_region.clone();
            let holds_home = snapshot
                .world
                .regions
                .iter()
                .any(|r| r.id == home && r.owner.as_deref() == Some(defender));
            if holds_home {
                2.0
            } else {
                0.0
            }
        })
        .unwrap_or(0.0);
    let d = civ_strength(snapshot, defender) + home_bonus;
    let roll = rand_range(rng, 0.85, 1.15);
    let ratio = (a * roll) / d.max(1.0);

    // Bounded casualties on BOTH sides, scaled by the strength ratio.
    let def_loss = bounded_loss(snapshot, defender, (ratio * 0.10).min(CASUALTY_CAP));
    let atk_loss = bounded_loss(
        snapshot,
        attacker,
        (0.06 / ratio.max(0.01)).min(CASUALTY_CAP),
    );
    kill_axolotls(snapshot, defender, def_loss);
    kill_axolotls(snapshot, attacker, atk_loss);

    let win = ratio > WIN_THRESHOLD;
    if win {
        plunder(snapshot, attacker, defender);
        seize_region(snapshot, attacker, defender);
    }
    win
}

/// The post-decision COMBAT WORLD PASS (WAR-02). Resolves every attack queued during
/// the decision loop in one deterministic order: `attacks` is sorted by
/// `(attacker, target)` so the resolution order never depends on the shuffled
/// decision order (Pitfall 2), and a SINGLE rng stream seeded with the distinct
/// combat salt `0xC0FF_EE01` is threaded across all attacks. A civ that collapsed
/// earlier this pass is skipped defensively (T-04-01). The ally-refusal log is
/// emitted inside `resolve_attack`; to avoid a contradictory "raid repelled" line for
/// an ally, this pass detects the same unilateral ally stance and `continue`s without
/// the generic combat log when the gate would fire.
fn resolve_combat(snapshot: &mut CivSessionSnapshot, attacks: &mut [(String, String)]) {
    attacks.sort();
    let mut rng = (snapshot.seed ^ snapshot.turn.wrapping_mul(0x9E37_79B9) ^ 0xC0FF_EE01).max(1);
    for (attacker, defender) in attacks.iter() {
        let Some(ai) = civ_index(snapshot, attacker) else {
            continue;
        };
        if civ_index(snapshot, defender).is_none() {
            continue;
        }
        // Ally gate: resolve_attack also enforces this and logs the refusal; detect it
        // here so the no-op does not also emit a misleading generic "raid" line.
        let allied = snapshot.civs[ai]
            .diplomacy
            .get(defender)
            .map(String::as_str)
            == Some("ally");
        if allied {
            resolve_attack(snapshot, attacker, defender, &mut rng);
            continue;
        }
        let win = resolve_attack(snapshot, attacker, defender, &mut rng);
        push_log(
            snapshot,
            "combat",
            &format!(
                "{} raided {}",
                civ_label(snapshot, attacker),
                civ_label(snapshot, defender)
            ),
            if win {
                "The raid broke through — plunder taken and territory may have shifted."
            } else {
                "The raid was repelled with losses on both sides."
            },
        );
    }
}

// --- Predator engine: wild fauna spawned by `predator_incursion` (W6 / WAR-04) ---
//
// Predators are the only net-new concept in Phase 4: net-new wild `CivEntity`s
// (`kind == "predator"`, `civ_id == None`) spawned when Phase 3's
// `predator_incursion` forecast fires (`tick_environment`), then driven each turn by
// the predator world pass `step_predators` (called from `advance_civ_turn` AFTER
// `resolve_combat` and BEFORE `resolve_environment`, so predator casualties — entity
// removals, never a `population` decrement — land before the population mirror
// re-syncs). Defense reuses the combat seam `civ_strength`: a strong civ takes less
// damage and culls more predators (culled predators drop food). Everything is
// replay-stable: ids are `format!("predator-{turn}-{n}")` (no uuid/clock) and both
// passes seed one rng with the distinct predator salt `0xBADD_CA75`.

/// Distinct predator RNG salt (vs combat `0xC0FF_EE01`, civ_turn_order `0x51ED_2701`,
/// env-season `0xE05A_F107`) so predator rolls stay uncorrelated with the other passes.
const PREDATOR_SALT: u32 = 0xBADD_CA75;

/// Spawn `count` net-new wild predator entities near the colony nearest the disaster
/// `epicenter_x`. WAR-04. Called from `tick_environment`'s `predator_incursion` fire
/// branch. Predators are `civ_id == None` wild fauna with deterministic
/// `predator-{turn}-{n}` ids (no uuid/clock) and `age == 0` (the lifespan counter).
/// Placement jitter is drawn from `rng` (the predator-salt stream) and clamped to the
/// world bounds. A no-op if no living civ exists (nothing to hunt).
fn spawn_predators(snapshot: &mut CivSessionSnapshot, epicenter_x: u32, count: u32, rng: &mut u32) {
    // Nearest living colony centre to the epicenter (deterministic: min by |dx|, then
    // by civ id so ties break stably).
    let mut centers: Vec<(String, (u32, u32))> = snapshot
        .civs
        .iter()
        .filter(|c| c.alive)
        .map(|c| (c.id.clone(), colony_center(snapshot, &c.id)))
        .collect();
    centers.sort_by(|a, b| {
        let da = (i64::from(a.1 .0) - i64::from(epicenter_x)).unsigned_abs();
        let db = (i64::from(b.1 .0) - i64::from(epicenter_x)).unsigned_abs();
        da.cmp(&db).then_with(|| a.0.cmp(&b.0))
    });
    let Some((_, (cx, cy))) = centers.into_iter().next() else {
        return; // no living civ → nothing to hunt
    };
    let turn = snapshot.turn;
    let width = snapshot.world.width;
    let height = snapshot.world.height;
    let mut spawned = Vec::new();
    for n in 0..count {
        let jitter_x = rand_range(rng, -3.0, 3.0) as i64;
        let jitter_y = rand_range(rng, -2.0, 2.0) as i64;
        let px = (i64::from(cx) + jitter_x).clamp(0, i64::from(width) - 1) as u32;
        let py = (i64::from(cy) + jitter_y).clamp(0, i64::from(height) - 1) as u32;
        spawned.push(CivEntity {
            id: format!("predator-{turn}-{n}"),
            kind: "predator".to_string(),
            role: "predator".to_string(),
            name: "Wild predator".to_string(),
            x: px,
            y: py,
            health: 1.0,
            civ_id: None,
            stage: "adult".to_string(),
            age: 0,
            ..Default::default()
        });
    }
    snapshot.world.entities.extend(spawned);
}

/// Predator lifespan in turns. Tied to `disaster_duration("predator_incursion")` (3)
/// plus slack so a spawned wave hunts for a few turns before expiring (T-04-03).
const PREDATOR_LIFESPAN: u32 = 5;
/// Squared distance within which a predator is "in range" of a colony and attacks
/// (and within which a civ's defenders can cull it). ~6 tiles.
const PREDATOR_RANGE2: u64 = 36;
/// Food a defending civ gains when it culls a predator (a small, fixed, bounded
/// credit — conserved-style, can never go negative; T-04-11).
const PREDATOR_FOOD_DROP: i32 = 3;

/// Per-predator hunt/defense intents collected in the read phase of `step_predators`,
/// applied (entity removals + food credits) in the write phase to respect the borrow
/// checker (no aliasing `world.entities` while iterating).
struct PredatorOutcome {
    /// New predator positions after moving toward the nearest colony, keyed by id.
    moves: Vec<(String, u32, u32)>,
    /// Per-civ axolotl kills to apply (civ_id -> kills), bounded later by `kill_axolotls`.
    kills: HashMap<String, u32>,
    /// Per-civ food credits from culled predators (civ_id -> food).
    food: HashMap<String, i32>,
    /// Predator ids to remove (culled by defense OR expired by lifespan).
    dead: Vec<String>,
    /// Surviving predator ids whose age must be incremented this step.
    aged: Vec<String>,
}

/// The post-decision PREDATOR WORLD PASS (WAR-04). One deterministic step: each
/// predator (processed in stable id-sorted order) moves toward the nearest living
/// colony; if in range it hunts (kills bounded axolotl entities, reduced by the civ's
/// `civ_strength` defense) and may be culled by that civ's defenders (a strong civ
/// culls more); culled predators drop food; predators at `age >= PREDATOR_LIFESPAN`
/// expire. Casualties REMOVE axolotl entities (never a `population` decrement — the
/// counter is a mirror) and the pass runs BEFORE `resolve_environment`, so losses land
/// before the mirror re-syncs. Seeds one rng with the distinct predator salt; reads all
/// state into local Vecs/maps FIRST, then applies mutations, to avoid aliasing
/// `world.entities` while iterating (borrow discipline mirrors `plunder`).
fn step_predators(snapshot: &mut CivSessionSnapshot) {
    let mut rng = (snapshot.seed ^ snapshot.turn.wrapping_mul(0x9E37_79B9) ^ PREDATOR_SALT).max(1);

    // --- Read phase: collect predators (stable id-sorted) + living colony centres. ---
    let mut predators: Vec<(String, u32, u32, u32)> = snapshot
        .world
        .entities
        .iter()
        .filter(|e| e.kind == "predator" && e.civ_id.is_none())
        .map(|e| (e.id.clone(), e.x, e.y, e.age))
        .collect();
    predators.sort();
    if predators.is_empty() {
        return;
    }
    let centers: Vec<(String, u32, u32, f32)> = snapshot
        .civs
        .iter()
        .filter(|c| c.alive)
        .map(|c| {
            let (cx, cy) = colony_center(snapshot, &c.id);
            (c.id.clone(), cx, cy, civ_strength(snapshot, &c.id))
        })
        .collect();

    let mut outcome = PredatorOutcome {
        moves: Vec::new(),
        kills: HashMap::new(),
        food: HashMap::new(),
        dead: Vec::new(),
        aged: Vec::new(),
    };

    for (pid, px, py, page) in &predators {
        // Expire by lifespan first — an expired predator does not hunt this step.
        if *page >= PREDATOR_LIFESPAN {
            outcome.dead.push(pid.clone());
            continue;
        }
        // Nearest living colony (deterministic: min dist2, then by civ id).
        let Some((cid, cx, cy, strength)) = centers
            .iter()
            .min_by(|a, b| {
                dist2(*px, *py, a.1, a.2)
                    .cmp(&dist2(*px, *py, b.1, b.2))
                    .then_with(|| a.0.cmp(&b.0))
            })
            .cloned()
        else {
            // No living civ to hunt — just age the predator.
            outcome.aged.push(pid.clone());
            continue;
        };

        // Move one step toward the colony centre (clamped to bounds).
        let nx = step_toward(*px, cx);
        let ny = step_toward(*py, cy);
        outcome.moves.push((pid.clone(), nx, ny));

        // In range? Use the post-move position so a predator that just arrived bites.
        let in_range = dist2(nx, ny, cx, cy) <= PREDATOR_RANGE2;
        let mut culled = false;
        if in_range {
            // Hunt: base damage 1, reduced to 0 once the civ is strong enough (defense).
            // strength 0 → full damage; scales down to 0 by ~strength 20.
            let defense = (strength / 20.0).clamp(0.0, 1.0);
            let damage = if rand_f(&mut rng) >= defense { 1 } else { 0 };
            if damage > 0 {
                *outcome.kills.entry(cid.clone()).or_insert(0) += damage;
            }
            // Defense cull: stronger civs cull more often. cull chance scales with strength.
            let cull_chance = (strength / 30.0).clamp(0.0, 0.9);
            if rand_f(&mut rng) < cull_chance {
                culled = true;
                outcome.dead.push(pid.clone());
                *outcome.food.entry(cid.clone()).or_insert(0) += PREDATOR_FOOD_DROP;
            }
        }
        if !culled {
            outcome.aged.push(pid.clone());
        }
    }

    // --- Write phase: apply moves, then kills (bounded), then culls/expiry + food. ---
    if !outcome.moves.is_empty() {
        let move_map: HashMap<&str, (u32, u32)> = outcome
            .moves
            .iter()
            .map(|(id, x, y)| (id.as_str(), (*x, *y)))
            .collect();
        for e in &mut snapshot.world.entities {
            if let Some(&(nx, ny)) = move_map.get(e.id.as_str()) {
                e.x = nx;
                e.y = ny;
            }
        }
    }

    let mut hunted_any = false;
    let mut civ_kills: Vec<(String, u32)> = outcome.kills.into_iter().collect();
    civ_kills.sort();
    for (cid, want) in &civ_kills {
        // Bounded: never remove a civ's last living axolotl (leave >=1).
        let living = living_axolotl_count(snapshot, cid);
        let allowed = (*want).min(living.saturating_sub(1));
        let killed = kill_axolotls(snapshot, cid, allowed);
        if killed > 0 {
            hunted_any = true;
        }
    }

    // Age survivors (those not removed this step).
    if !outcome.aged.is_empty() {
        let age_set: std::collections::HashSet<&str> =
            outcome.aged.iter().map(String::as_str).collect();
        for e in &mut snapshot.world.entities {
            if e.kind == "predator" && age_set.contains(e.id.as_str()) {
                e.age = e.age.saturating_add(1);
            }
        }
    }

    // Credit culled-predator food drops (a credit can never go negative).
    let mut food_credits: Vec<(String, i32)> = outcome.food.into_iter().collect();
    food_credits.sort();
    let culled_any = !outcome.dead.is_empty();
    for (cid, food) in &food_credits {
        if let Some(ci) = civ_index(snapshot, cid) {
            *snapshot.civs[ci]
                .resources
                .entry("food".to_string())
                .or_insert(0) += *food;
        }
    }

    // Remove culled + expired predators in one retain.
    if !outcome.dead.is_empty() {
        let dead: std::collections::HashSet<&str> =
            outcome.dead.iter().map(String::as_str).collect();
        snapshot
            .world
            .entities
            .retain(|e| !(e.kind == "predator" && dead.contains(e.id.as_str())));
    }

    if hunted_any || culled_any {
        push_log(
            snapshot,
            "predator",
            "Wild predators on the prowl",
            "Predators hunted the colonies; defenders fought back and drove some off.",
        );
    }
}

/// Move one tile from `from` toward `to` (saturating, clamp-free since both are valid
/// world coords). Used to advance predators toward a colony centre each step.
fn step_toward(from: u32, to: u32) -> u32 {
    use std::cmp::Ordering;
    match from.cmp(&to) {
        Ordering::Less => from + 1,
        Ordering::Greater => from - 1,
        Ordering::Equal => from,
    }
}

// --- Environment engine: pure, seed-deterministic helpers (W4) ---
//
// These leaf helpers are wired into the turn loop by the Wave-3 orchestrator
// (`tick_environment`, plan 03-03), which runs them once per turn from
// `advance_civ_turn`.

/// Turns spent in a season before it wraps to the next one. Claude's discretion
/// per CONTEXT (Seasons & Temperature).
const SEASON_LEN: u32 = 8;
const SEASONS: [&str; 4] = ["spring", "summer", "autumn", "winter"];
/// Unique env-tick RNG salt (distinct from `civ_turn_order`'s `0x51ED_2701`).
const ENV_SEASON_SALT: u32 = 0xE05A_F107;

/// Mild/cold/warm baseline the temperature drifts toward each season.
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
fn is_renewable(resource: &str) -> bool {
    !is_finite_mineral(resource)
}

/// Pure: renewable resource tiles tick their `amount` back toward a cap, at a
/// rate scaled by season/temperature (zero in winter or when too cold). Finite
/// minerals are NEVER regrown (ENV-03 sustained scarcity). Mutates in place —
/// the tile count is invariant (threat T-03-02). A partially-mined finite tile
/// still carries `resource: Some("ore")` and stays finite, so it is skipped;
/// a fully-mined finite tile already has `resource: None` and is skipped too.
fn regrow_resources(tiles: &mut [CivTile], season: &str, temperature: f32) {
    let rate = match season {
        "spring" | "summer" => 2,
        "autumn" => 1,
        _ => 0, // winter: no regrowth
    };
    if rate == 0 || temperature < 2.0 {
        return;
    }
    const REGROW_CAP: i32 = 17; // matches the world-gen renewable ceiling (6 + rng%12 = 6..=17)
    for tile in tiles.iter_mut() {
        if let Some(res) = tile.resource.as_deref() {
            if is_renewable(res) && tile.amount < REGROW_CAP {
                tile.amount = (tile.amount + rate).min(REGROW_CAP);
            }
        }
    }
}

/// Forecast lead window: a rolled disaster fires this many turns AFTER it is
/// announced (CONTEXT "forecast-then-fire", 2-3 turns).
const DISASTER_FORECAST_LEAD: (u32, u32) = (1, 3);
/// Cap on disaster blast radius (RESEARCH Pitfall 2: a runaway radius could strip
/// the whole seabed and soft-brick a colony).
const DISASTER_RADIUS_MAX: u32 = 8;
/// Unique env-forecast RNG salt (distinct from `civ_turn_order`'s `0x51ED_2701`
/// AND 03-01's `ENV_SEASON_SALT`) so the disaster stream never aliases.
const ENV_FORECAST_SALT: u32 = 0xD15A_57E2;

/// Season-weighted disaster eligibility. `flood`/`quake` reshape terrain
/// (`apply_disaster_to_tiles`); `drought`/`cold_snap`/`storm`/`predator_incursion`
/// each reuse an EXISTING `resolve_environment` modifier arm
/// (drought/cold_snap/fatigue/quarrel_pressure) so every fired kind has a real
/// effect — no new `CivModifier` kind without a matching arm (Pitfall 5).
fn disaster_kinds_for(season: &str, temperature: f32) -> &'static [&'static str] {
    match season {
        "winter" => &["cold_snap", "storm", "quake"],
        "summer" => {
            if temperature >= 22.0 {
                &["drought", "flood", "storm", "quake"]
            } else {
                &["flood", "storm", "quake"]
            }
        }
        "spring" => &["flood", "storm", "predator_incursion"],
        // autumn (and any unknown season): wet-season erosion makes landslides
        // (terrain-reshape, via apply_disaster_to_tiles) plausible here.
        _ => &["storm", "quake", "drought", "landslide"],
    }
}

/// Pure: deterministically decide whether (and what) the NEXT disaster is, given
/// `(seed, turn)` and the current env. The returned `CivDisaster.remaining_turns`
/// is the FORECAST LEAD countdown (turns until it fires) — NOT its active
/// duration; the caller (`tick_environment`, Wave 3) stores it in `env.forecast`,
/// decrements it each turn, and resets it to the active duration when it fires.
/// id/kind/epicenter/radius/intensity all derive from `(seed, turn)` so the whole
/// roll is replayable — no uuid, no wall-clock (threat T-03-04).
fn roll_forecast(
    seed: u32,
    turn: u32,
    env: &CivEnvironment,
    world_width: u32,
) -> Option<CivDisaster> {
    let mut rng = (seed ^ turn.wrapping_mul(0x9E37_79B9) ^ ENV_FORECAST_SALT).max(1);
    // Base chance, modestly higher in the harsh seasons (CONTEXT weighting).
    let p = rand_f(&mut rng);
    let chance = match env.season.as_str() {
        "winter" | "summer" => 0.30,
        _ => 0.20,
    };
    if p >= chance {
        return None;
    }
    let kinds = disaster_kinds_for(&env.season, env.temperature);
    let kind = kinds[(next_rng(&mut rng) as usize) % kinds.len()];
    let max_x = world_width.saturating_sub(2).max(1);
    let epicenter_x = (1 + (next_rng(&mut rng) % max_x)).clamp(1, max_x);
    let radius = (1 + (next_rng(&mut rng) % DISASTER_RADIUS_MAX)).clamp(1, DISASTER_RADIUS_MAX);
    let intensity = round1(rand_range(&mut rng, 0.5, 3.0)).clamp(0.1, 3.0);
    let lead = (DISASTER_FORECAST_LEAD.0
        + (next_rng(&mut rng) % (DISASTER_FORECAST_LEAD.1 - DISASTER_FORECAST_LEAD.0 + 1)))
        .clamp(DISASTER_FORECAST_LEAD.0, DISASTER_FORECAST_LEAD.1);
    Some(CivDisaster {
        id: format!("dis-{turn}-{kind}"), // seed/turn-derived → replayable, NOT uuid
        kind: kind.to_string(),
        epicenter_x,
        radius,
        intensity,
        remaining_turns: lead, // forecast lead countdown (Open Q3 convention)
    })
}

/// Pure: physically reshape `tiles` around the disaster epicenter, in place and
/// boundedly. `flood`/`quake`/`landslide` convert sub-surface substrate to
/// water/deepwater (mirrors the mining terraform rules); terrain-neutral kinds
/// (`storm`/`drought`/`cold_snap`/`predator_incursion`) leave tiles untouched —
/// their effect is a `CivModifier`/one-shot at fire time, not a terrain change.
///
/// Invariants (asserted by the determinism/bounds tests, threat T-03-05):
/// tile count unchanged (mutate in place, never push/remove); `x ∈ [0, width)`;
/// `y ∈ [WATER_SURFACE_Y, WORLD_HEIGHT)`; never converts a tile at/above the
/// seabed surface (keeps the colony floor buildable, can't soft-brick a colony).
fn apply_disaster_to_tiles(tiles: &mut [CivTile], dis: &CivDisaster, width: u32) {
    // Terrain-only for the physical-reshape kinds; the rest are civ-effect/announce.
    if !matches!(dis.kind.as_str(), "flood" | "quake" | "landslide") {
        return;
    }
    let cx = dis.epicenter_x.clamp(1, width.saturating_sub(2).max(1));
    let r = dis.radius.min(DISASTER_RADIUS_MAX);
    let lo = cx.saturating_sub(r);
    let hi = (cx + r).min(width.saturating_sub(1));
    for x in lo..=hi {
        // Seabed surface for this column (inline `seabed_row_at` over the slice —
        // the helper takes `&CivWorld`, but here we only have a tile slice).
        let surface = tiles
            .iter()
            .filter(|t| t.x == x && is_substrate(&t.terrain))
            .map(|t| t.y)
            .min()
            .unwrap_or(WORLD_HEIGHT - 2);
        // How deep to reshape this column — bounded, never the whole column.
        let depth = match dis.kind.as_str() {
            "flood" => 2, // raise water over the top 1-2 sub-surface rows
            _ => 1,       // quake/landslide carve a single sub-surface void
        };
        // Only convert BELOW surface+1 (Pitfall 2: keep the surface solid/buildable).
        let start = (surface + 2).max(WATER_SURFACE_Y);
        for ty in start..start.saturating_add(depth).min(WORLD_HEIGHT) {
            if let Some(t) = tiles.iter_mut().find(|t| t.x == x && t.y == ty) {
                if is_substrate(&t.terrain) && ty > surface + 1 && ty >= WATER_SURFACE_Y {
                    t.terrain = if ty >= DEEP_WATER_Y {
                        "deepwater"
                    } else {
                        "water"
                    }
                    .to_string();
                    t.resource = None;
                    t.amount = 0;
                }
            }
        }
    }
}

/// Active duration (turns a disaster lingers in `env.disasters` after it fires),
/// per kind. Bounded so a fired disaster can never outlive a few turns.
fn disaster_duration(kind: &str) -> u32 {
    let raw = match kind {
        "drought" | "cold_snap" => 5,
        "flood" => 4,
        "predator_incursion" => 3,
        "quake" | "storm" => 2,
        _ => 3,
    };
    raw.clamp(1, 12)
}

/// World-level per-turn environment step. Runs once at TURN START (after the turn
/// increment, before the civ decision loop) so every civ observes the freshly
/// advanced season/forecast and a fired disaster's reshape this same turn.
///
/// The sequence is LOCKED (CONTEXT "Integration & Determinism"): fire any due
/// forecast (reshape terrain + push a reused `CivModifier` + log) → advance the
/// season/temperature/water (log on wrap) → regrow renewable resources → tick the
/// active disasters' countdowns and retire expired ones (log expiry) → roll/refresh
/// the forecast (log announce). All randomness derives from `seed`+`turn` via the
/// Wave-1/2 pure helpers; ids are `format!("dis-{turn}-{kind}")` — no uuid, no
/// wall-clock — so the whole tick is byte-deterministic replay (threat T-03-08).
fn tick_environment(snapshot: &mut CivSessionSnapshot) {
    let width = snapshot.world.width;

    // (a) Fire any DUE forecast. The forecast's `remaining_turns` is the lead
    //     countdown while it sits in `env.forecast` (Open Q3 convention).
    if let Some(mut forecast) = snapshot.environment.forecast.take() {
        forecast.remaining_turns = forecast.remaining_turns.saturating_sub(1);
        if forecast.remaining_turns == 0 {
            // It fires this turn: reshape terrain, push the reused civ-effect
            // modifier (only for kinds with an existing resolve_environment arm),
            // log it, and move it into the active disasters with its active duration.
            forecast.remaining_turns = disaster_duration(&forecast.kind);
            apply_disaster_to_tiles(&mut snapshot.world.tiles, &forecast, width);
            // Reuse an EXISTING CivModifier kind so resolve_environment applies it
            // (Pitfall 5: never push an unknown kind — it would be a silent no-op).
            // storm/predator_incursion map to the existing fatigue/quarrel_pressure
            // morale arms (:2551,:2555) so the most-frequently-rolled kinds have a
            // real mechanical effect (ENV-02) instead of being cosmetic.
            let modifier_kind = match forecast.kind.as_str() {
                "drought" => Some("drought"),
                "cold_snap" => Some("cold_snap"),
                "storm" => Some("fatigue"),
                "predator_incursion" => Some("quarrel_pressure"),
                _ => None, // flood/quake = terrain-only (reshape, no modifier)
            };
            if let Some(mk) = modifier_kind {
                snapshot.modifiers.push(CivModifier {
                    // Share the disaster's own id so the fired disaster and its
                    // companion modifier correlate in logs (LW-03). forecast.id is
                    // already deterministic (`dis-{roll_turn}-{kind}`, no uuid/clock).
                    id: forecast.id.clone(),
                    kind: mk.to_string(),
                    label: format!("Disaster: {mk}"),
                    polarity: "debuff".to_string(),
                    remaining_turns: forecast.remaining_turns,
                    intensity: forecast.intensity,
                });
            }
            push_log(
                snapshot,
                "disaster",
                &format!("A {} struck", forecast.kind),
                &format!(
                    "A {} hit near column {} (radius {}, intensity {:.1}).",
                    forecast.kind, forecast.epicenter_x, forecast.radius, forecast.intensity
                ),
            );
            // WAR-04: a fired predator_incursion ALSO spawns net-new wild predator
            // entities near the threatened colony (the quarrel_pressure modifier above
            // is KEPT — predators are the physical threat, morale pressure the ambient
            // dread; RESEARCH Open Q3). Self-contained predator-salt rng + format! ids
            // preserve this tick's byte-determinism (no uuid/clock; T-04-03).
            if forecast.kind == "predator_incursion" {
                let mut prng =
                    (snapshot.seed ^ snapshot.turn.wrapping_mul(0x9E37_79B9) ^ PREDATOR_SALT)
                        .max(1);
                let count = 1 + (forecast.intensity.clamp(0.0, 2.0) as u32); // 1-3 predators
                let epicenter_x = forecast.epicenter_x;
                spawn_predators(snapshot, epicenter_x, count, &mut prng);
            }
            snapshot.environment.disasters.push(forecast);
        } else {
            // Not due yet — keep counting down in the forecast slot.
            snapshot.environment.forecast = Some(forecast);
        }
    }

    // (b) Advance season/temperature/water. Read the scalars into locals first so
    //     the helper call doesn't alias `snapshot.environment` with later mutations.
    let prev_season = snapshot.environment.season.clone();
    let (season, turn_of_season, temperature, water_level) = advance_season(
        &snapshot.environment.season,
        snapshot.environment.turn_of_season,
        snapshot.environment.temperature,
        snapshot.environment.water_level,
        snapshot.turn,
        snapshot.seed,
    );
    snapshot.environment.season = season.clone();
    snapshot.environment.turn_of_season = turn_of_season;
    snapshot.environment.temperature = temperature;
    snapshot.environment.water_level = water_level;
    if season != prev_season {
        push_log(
            snapshot,
            "season",
            &format!("Season turned to {season}"),
            &format!("The {prev_season} gives way to {season}; temperature settles near {temperature:.1}\u{b0}."),
        );
    }

    // (c) Regrow renewable resources using the just-advanced season/temperature.
    regrow_resources(&mut snapshot.world.tiles, &season, temperature);

    // (d) Tick active disasters' countdowns and retire expired ones (mirror
    //     tick_modifiers). Collect expiring ids BEFORE retain to avoid a borrow
    //     conflict with push_log.
    for disaster in snapshot.environment.disasters.iter_mut() {
        disaster.remaining_turns = disaster.remaining_turns.saturating_sub(1);
    }
    let expired: Vec<(String, String)> = snapshot
        .environment
        .disasters
        .iter()
        .filter(|d| d.remaining_turns == 0)
        .map(|d| (d.id.clone(), d.kind.clone()))
        .collect();
    snapshot
        .environment
        .disasters
        .retain(|d| d.remaining_turns > 0);
    for (_, kind) in &expired {
        push_log(
            snapshot,
            "disaster",
            &format!("The {kind} subsided"),
            &format!("The {kind} has run its course and the world steadies."),
        );
    }

    // (e) Roll/refresh the forecast if none is pending, announcing it ahead of time.
    if snapshot.environment.forecast.is_none() {
        if let Some(forecast) =
            roll_forecast(snapshot.seed, snapshot.turn, &snapshot.environment, width)
        {
            let kind = forecast.kind.clone();
            let lead = forecast.remaining_turns;
            snapshot.environment.forecast = Some(forecast);
            push_log(
                snapshot,
                "forecast",
                &format!("A {kind} is forecast"),
                &format!(
                    "Signs point to a {kind} in roughly {lead} turn(s); civilizations may prepare."
                ),
            );
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
    fn test_snapshot(id: &str, name: &str, model: &str, seed: u32, now: u64) -> CivSessionSnapshot {
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
        let mut tiles = vec![renewable_tile("moss", 5), renewable_tile("kelp", 16)];
        regrow_resources(&mut tiles, "summer", 24.0);
        assert!(tiles[0].amount > 5, "renewable should gain amount");
        assert!(tiles[0].amount <= 17, "renewable must not exceed cap");
        assert_eq!(tiles[1].amount, 17, "near-cap renewable clamps to cap");
        // Saturate to cap and never exceed it on repeated ticks.
        for _ in 0..10 {
            regrow_resources(&mut tiles, "summer", 24.0);
        }
        assert_eq!(tiles[0].amount, 17);
        assert_eq!(tiles[1].amount, 17);
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
        assert_eq!(
            tiles[0].amount, 5,
            "below temperature threshold → unchanged"
        );
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

        let snapshot = initial_snapshot(
            "legacy-one".to_string(),
            "W".to_string(),
            &participants,
            7,
            1,
        );
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

        let snapshot =
            initial_snapshot("multi-2".to_string(), "W".to_string(), &participants, 7, 1);
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
                CivParticipant {
                    name: "A".to_string(),
                    model: "m".to_string(),
                    color: None,
                },
                CivParticipant {
                    name: "B".to_string(),
                    model: "m".to_string(),
                    color: None,
                },
                CivParticipant {
                    name: "C".to_string(),
                    model: "m".to_string(),
                    color: None,
                },
                CivParticipant {
                    name: "D".to_string(),
                    model: "m".to_string(),
                    color: None,
                },
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
        assert_eq!(
            entry.reasoning.as_deref(),
            Some("internal chain of thought")
        );
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
            target: None,
            stance: None,
            receive: None,
            amount: None,
            receive_amount: None,
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

    // --- ENV-02: roll_forecast determinism + season-weighting (03-02 Task 1) ---

    fn env_for(season: &str, temperature: f32) -> CivEnvironment {
        let mut env = CivEnvironment::new();
        env.season = season.to_string();
        env.temperature = temperature;
        env
    }

    /// Find a (seed, turn) that actually rolls a disaster, so the bound/id tests
    /// have a Some to inspect regardless of the base-chance gate.
    fn first_forecast(season: &str, temperature: f32, width: u32) -> CivDisaster {
        let env = env_for(season, temperature);
        for turn in 0..256u32 {
            if let Some(dis) = roll_forecast(1234, turn, &env, width) {
                return dis;
            }
        }
        panic!("expected at least one forecast within 256 turns");
    }

    #[test]
    fn roll_forecast_is_deterministic() {
        // Same (seed, turn, env, width) ⇒ identical Option<CivDisaster> (replay).
        let env = env_for("winter", 4.0);
        for turn in 0..16u32 {
            let a = roll_forecast(777, turn, &env, WORLD_WIDTH);
            let b = roll_forecast(777, turn, &env, WORLD_WIDTH);
            assert_eq!(
                serde_json::to_string(&a).unwrap(),
                serde_json::to_string(&b).unwrap(),
                "pure forecast roll must be byte-stable for replay (turn {turn})"
            );
        }
    }

    #[test]
    fn roll_forecast_clamps_bounds() {
        // Whatever the season, a Some forecast stays inside the world/param bounds.
        for (season, temp) in [
            ("winter", 4.0),
            ("summer", 24.0),
            ("spring", 14.0),
            ("autumn", 14.0),
        ] {
            let env = env_for(season, temp);
            for turn in 0..256u32 {
                if let Some(dis) = roll_forecast(4242, turn, &env, WORLD_WIDTH) {
                    assert!(
                        (1..=WORLD_WIDTH - 2).contains(&dis.epicenter_x),
                        "epicenter_x {} out of [1, width-2]",
                        dis.epicenter_x
                    );
                    assert!(
                        (1..=8).contains(&dis.radius),
                        "radius {} out of [1, 8]",
                        dis.radius
                    );
                    assert!(
                        (0.1..=3.0).contains(&dis.intensity),
                        "intensity {} out of [0.1, 3.0]",
                        dis.intensity
                    );
                    assert!(
                        (1..=3).contains(&dis.remaining_turns),
                        "lead {} out of [1, 3]",
                        dis.remaining_turns
                    );
                }
            }
        }
    }

    #[test]
    fn roll_forecast_id_is_seed_derived() {
        // Threat T-03-04: id is `dis-{turn}-{kind}` — no uuid, no wall-clock.
        let dis = first_forecast("winter", 4.0, WORLD_WIDTH);
        let turn = forecast_turn_for("winter", 4.0, WORLD_WIDTH);
        // id is exactly the seed/turn-derived `dis-{turn}-{kind}` — fully replayable.
        assert_eq!(dis.id, format!("dis-{}-{}", turn, dis.kind));
        assert!(dis.id.starts_with("dis-"), "id must be seed/turn-derived");
        // A uuid id would be 36 chars of hex/dashes; a wall-clock id would carry a
        // 10+ digit unix-second run. The derived id carries neither.
        assert!(dis.id.len() < 30, "id must not be a uuid");
    }

    /// Companion to `roll_forecast_id_is_seed_derived`: the turn the first forecast lands on.
    fn forecast_turn_for(season: &str, temperature: f32, width: u32) -> u32 {
        let env = env_for(season, temperature);
        for turn in 0..256u32 {
            if roll_forecast(1234, turn, &env, width).is_some() {
                return turn;
            }
        }
        panic!("no forecast");
    }

    #[test]
    fn disaster_kinds_are_season_weighted() {
        // Winter eligibility includes a cold kind; hot summer includes a heat kind.
        let winter = disaster_kinds_for("winter", 4.0);
        assert!(
            winter.contains(&"cold_snap"),
            "winter must allow a cold disaster"
        );
        let summer = disaster_kinds_for("summer", 24.0);
        assert!(
            summer.contains(&"drought"),
            "hot summer must allow a heat disaster"
        );
        // Below the heat threshold, summer drops the drought.
        let cool_summer = disaster_kinds_for("summer", 18.0);
        assert!(
            !cool_summer.contains(&"drought"),
            "cool summer must not roll drought"
        );
        // LW-01: autumn allows landslide so the apply_disaster_to_tiles landslide
        // reshape arm is reachable through the normal tick path (not dead code).
        let autumn = disaster_kinds_for("autumn", 14.0);
        assert!(
            autumn.contains(&"landslide"),
            "autumn must allow landslide (reshape variety)"
        );
    }

    // --- ENV-02: apply_disaster_to_tiles bounded reshape + invariants (03-02 Task 2) ---

    fn flood_at(epicenter_x: u32, radius: u32) -> CivDisaster {
        CivDisaster {
            id: "dis-1-flood".into(),
            kind: "flood".into(),
            epicenter_x,
            radius,
            intensity: 2.0,
            remaining_turns: 4,
        }
    }

    #[test]
    fn apply_disaster_preserves_tile_count() {
        let mut snapshot = test_snapshot("dis-count", "Count", "mock-model", 42, 1);
        let before = snapshot.world.tiles.len();
        let width = snapshot.world.width;
        let dis = flood_at(width / 2, 3);
        apply_disaster_to_tiles(&mut snapshot.world.tiles, &dis, width);
        assert_eq!(
            snapshot.world.tiles.len(),
            before,
            "apply_disaster mutates in place — tile count is invariant"
        );
        assert_eq!(
            before,
            (width * WORLD_HEIGHT) as usize,
            "world stays width*height"
        );
    }

    #[test]
    fn flood_reshapes_terrain_to_water() {
        // ENV-02 hard requirement: terrain is PHYSICALLY reshaped near the epicenter.
        let mut snapshot = test_snapshot("dis-reshape", "Reshape", "mock-model", 42, 1);
        let width = snapshot.world.width;
        let cx = width / 2;
        // Snapshot the sub-surface substrate tiles in the blast column band BEFORE.
        let before: Vec<(u32, u32, String)> = snapshot
            .world
            .tiles
            .iter()
            .map(|t| (t.x, t.y, t.terrain.clone()))
            .collect();
        let dis = flood_at(cx, 3);
        apply_disaster_to_tiles(&mut snapshot.world.tiles, &dis, width);
        let changed =
            snapshot
                .world
                .tiles
                .iter()
                .zip(before.iter())
                .any(|(t, (_, _, terrain_before))| {
                    &t.terrain != terrain_before
                        && matches!(t.terrain.as_str(), "water" | "deepwater")
                });
        assert!(
            changed,
            "flood must convert at least one sub-surface substrate tile to water"
        );
    }

    #[test]
    fn apply_disaster_never_touches_air_band() {
        // No tile with y < WATER_SURFACE_Y may be modified (keep colony floor buildable).
        let mut snapshot = test_snapshot("dis-air", "Air", "mock-model", 42, 1);
        let width = snapshot.world.width;
        let before: Vec<CivTile> = snapshot.world.tiles.clone();
        let dis = flood_at(width / 2, 4);
        apply_disaster_to_tiles(&mut snapshot.world.tiles, &dis, width);
        for (after, prior) in snapshot.world.tiles.iter().zip(before.iter()) {
            if after.y < WATER_SURFACE_Y {
                assert_eq!(
                    serde_json::to_string(after).unwrap(),
                    serde_json::to_string(prior).unwrap(),
                    "air band (y < {WATER_SURFACE_Y}) must never be modified"
                );
            }
        }
    }

    #[test]
    fn apply_disaster_stays_in_bounds() {
        // Edge epicenters must not panic and must not write outside the world.
        for ex in [0u32, 1, 200, 250, 255] {
            let mut snapshot = test_snapshot("dis-edge", "Edge", "mock-model", 42, 1);
            let width = snapshot.world.width;
            let dis = flood_at(ex.min(width.saturating_sub(1)), 8);
            apply_disaster_to_tiles(&mut snapshot.world.tiles, &dis, width);
            for t in &snapshot.world.tiles {
                assert!(t.x < width, "x {} escaped width {}", t.x, width);
                assert!(t.y < WORLD_HEIGHT, "y {} escaped WORLD_HEIGHT", t.y);
            }
        }
    }

    #[test]
    fn terrain_neutral_disaster_leaves_tiles_unchanged() {
        // storm/drought/cold_snap/predator_incursion are civ-effect/announce — no reshape.
        for kind in ["storm", "drought", "cold_snap", "predator_incursion"] {
            let mut snapshot = test_snapshot("dis-neutral", "Neutral", "mock-model", 42, 1);
            let width = snapshot.world.width;
            let before = serde_json::to_string(&snapshot.world.tiles).unwrap();
            let dis = CivDisaster {
                id: format!("dis-1-{kind}"),
                kind: kind.into(),
                epicenter_x: width / 2,
                radius: 4,
                intensity: 2.0,
                remaining_turns: 4,
            };
            apply_disaster_to_tiles(&mut snapshot.world.tiles, &dis, width);
            let after = serde_json::to_string(&snapshot.world.tiles).unwrap();
            assert_eq!(
                before, after,
                "terrain-neutral kind '{kind}' must not reshape tiles"
            );
        }
    }

    #[test]
    fn apply_disaster_is_deterministic() {
        // Identical tile vecs + identical disaster ⇒ byte-identical result.
        let a = test_snapshot("dis-det-a", "A", "mock-model", 42, 1);
        let b = test_snapshot("dis-det-b", "B", "mock-model", 42, 1);
        let width = a.world.width;
        let mut ta = a.world.tiles.clone();
        let mut tb = b.world.tiles.clone();
        // Same starting tiles (same seed/world gen).
        assert_eq!(
            serde_json::to_string(&ta).unwrap(),
            serde_json::to_string(&tb).unwrap()
        );
        let dis = flood_at(width / 2, 3);
        apply_disaster_to_tiles(&mut ta, &dis, width);
        apply_disaster_to_tiles(&mut tb, &dis, width);
        assert_eq!(
            serde_json::to_string(&ta).unwrap(),
            serde_json::to_string(&tb).unwrap(),
            "apply_disaster must be byte-deterministic"
        );
    }

    #[test]
    fn landslide_reshapes_like_quake_and_holds_invariants() {
        // LW-01: landslide is now reachable (autumn eligibility) and its reshape arm
        // is live. It shares quake's depth-1 sub-surface carve, so for the same
        // epicenter/radius it must produce a byte-identical reshape — proving the arm
        // runs (not dead) while keeping the tile-count and bounds invariants.
        let mk = |kind: &str| CivDisaster {
            id: format!("dis-1-{kind}"),
            kind: kind.into(),
            epicenter_x: 30,
            radius: 3,
            intensity: 2.0,
            remaining_turns: disaster_duration(kind),
        };

        let mut land = test_snapshot("dis-landslide", "Slide", "mock-model", 42, 1);
        let mut quake = test_snapshot("dis-quake", "Quake", "mock-model", 42, 1);
        let width = land.world.width;
        let before_count = land.world.tiles.len();

        apply_disaster_to_tiles(&mut land.world.tiles, &mk("landslide"), width);
        apply_disaster_to_tiles(&mut quake.world.tiles, &mk("quake"), width);

        // Landslide reshapes exactly as quake (same depth-1 arm) — proves it is live.
        assert_eq!(
            serde_json::to_string(&land.world.tiles).unwrap(),
            serde_json::to_string(&quake.world.tiles).unwrap(),
            "landslide must reshape identically to quake (shared depth-1 carve)"
        );
        // Tile count invariant + bounds hold after the landslide reshape.
        assert_eq!(
            land.world.tiles.len(),
            before_count,
            "landslide mutates in place — tile count is invariant"
        );
        assert_eq!(
            before_count,
            (width * WORLD_HEIGHT) as usize,
            "world stays width*height"
        );
        for t in &land.world.tiles {
            assert!(t.x < width, "x {} escaped width {}", t.x, width);
            assert!(t.y < WORLD_HEIGHT, "y {} escaped WORLD_HEIGHT", t.y);
        }
    }

    // --- ENV-01/02/03: tick_environment orchestrator (Wave-3 / 03-03 Task 1) ---

    /// Build a forecast sitting in `env.forecast` with a given lead countdown.
    fn pending_forecast(kind: &str, remaining_turns: u32) -> CivDisaster {
        CivDisaster {
            id: format!("dis-1-{kind}"),
            kind: kind.into(),
            epicenter_x: 30,
            radius: 3,
            intensity: 2.0,
            remaining_turns,
        }
    }

    #[test]
    fn tick_environment_advances_season() {
        // tick_environment drifts the season counter/temperature and, on a wrap,
        // logs a "season" entry. Start one tick before the wrap (turn_of_season 7).
        let mut snapshot = test_snapshot("env-season", "Season", "mock-model", 42, 1);
        snapshot.environment.turn_of_season = 7; // 7 + 1 == SEASON_LEN → wrap
        snapshot.environment.season = "spring".to_string();
        let before_temp = snapshot.environment.temperature;
        snapshot.turn = 1;
        tick_environment(&mut snapshot);
        assert_eq!(snapshot.environment.season, "summer", "season must wrap");
        assert_eq!(
            snapshot.environment.turn_of_season, 0,
            "counter resets on wrap"
        );
        assert_ne!(
            snapshot.environment.temperature, before_temp,
            "temperature must drift"
        );
        assert!(
            snapshot.log.iter().any(|e| e.kind == "season"),
            "a season change must be logged"
        );
    }

    #[test]
    fn tick_environment_forecast_then_fire() {
        // A forecast with remaining_turns==1 fires this tick (moves into disasters[],
        // remaining_turns reset to its active duration); one with ==3 only decrements.
        let mut snapshot = test_snapshot("env-fire", "Fire", "mock-model", 42, 1);
        snapshot.environment.forecast = Some(pending_forecast("flood", 1));
        snapshot.turn = 1;
        tick_environment(&mut snapshot);
        assert!(
            snapshot
                .environment
                .disasters
                .iter()
                .any(|d| d.kind == "flood"),
            "a due forecast must fire into disasters[]"
        );
        let fired = snapshot
            .environment
            .disasters
            .iter()
            .find(|d| d.kind == "flood")
            .unwrap();
        assert!(
            fired.remaining_turns >= 1,
            "fired disaster's remaining_turns must be reset to its active duration (> 0)"
        );

        // A non-due forecast (lead 3) only decrements and stays in env.forecast.
        let mut later = test_snapshot("env-pending", "Pending", "mock-model", 999, 1);
        later.environment.forecast = Some(pending_forecast("flood", 3));
        later.turn = 1;
        tick_environment(&mut later);
        // It is NOT in disasters[] yet...
        assert!(
            !later
                .environment
                .disasters
                .iter()
                .any(|d| d.kind == "flood"),
            "a non-due forecast must not fire yet"
        );
        // ...and a forecast (the decremented original or a freshly rolled one) is still pending.
        assert!(
            later.environment.forecast.is_some(),
            "a non-due forecast must remain pending"
        );
    }

    #[test]
    fn tick_environment_disaster_logged() {
        // After a fire, a "disaster" log entry exists.
        let mut snapshot = test_snapshot("env-log", "Log", "mock-model", 42, 1);
        snapshot.environment.forecast = Some(pending_forecast("flood", 1));
        snapshot.turn = 1;
        tick_environment(&mut snapshot);
        assert!(
            snapshot.log.iter().any(|e| e.kind == "disaster"),
            "a fired disaster must be logged with kind 'disaster'"
        );
        // A turn that rolls a forecast logs a "forecast" announcement. Sweep turns
        // on a calm snapshot until one rolls (the roll is seed/turn-deterministic).
        let mut calm = test_snapshot("env-forecast-log", "Forecast", "mock-model", 4242, 1);
        let mut saw_forecast_log = false;
        for t in 1..=64u32 {
            calm.turn = t;
            tick_environment(&mut calm);
            if calm.log.iter().any(|e| e.kind == "forecast") {
                saw_forecast_log = true;
                break;
            }
        }
        assert!(
            saw_forecast_log,
            "a rolled forecast must be logged with kind 'forecast'"
        );
    }

    #[test]
    fn tick_environment_disaster_expiry() {
        // An active disaster with remaining_turns==1 is removed after a tick and an
        // expiry "disaster" log entry is emitted.
        let mut snapshot = test_snapshot("env-expiry", "Expiry", "mock-model", 42, 1);
        snapshot.environment.forecast = None;
        snapshot.environment.disasters = vec![CivDisaster {
            id: "dis-0-storm".into(),
            kind: "storm".into(),
            epicenter_x: 30,
            radius: 2,
            intensity: 1.0,
            remaining_turns: 1,
        }];
        let log_before = snapshot.log.len();
        snapshot.turn = 1;
        tick_environment(&mut snapshot);
        assert!(
            !snapshot
                .environment
                .disasters
                .iter()
                .any(|d| d.id == "dis-0-storm"),
            "a disaster at remaining_turns 0 must be retired"
        );
        assert!(
            snapshot.log.len() > log_before && snapshot.log.iter().any(|e| e.kind == "disaster"),
            "disaster expiry must be logged"
        );
    }

    #[test]
    fn tick_environment_fired_disaster_pushes_reused_modifier() {
        // Every fired non-terrain disaster pushes a reused CivModifier whose kind has
        // a LIVE resolve_environment arm (Pitfall 5: no unknown kind that would
        // silently no-op). storm→fatigue and predator_incursion→quarrel_pressure give
        // the most-frequently-rolled kinds a real mechanical effect (MD-01 / ENV-02).
        for (kind, modifier_kind) in [
            ("drought", "drought"),
            ("cold_snap", "cold_snap"),
            ("storm", "fatigue"),
            ("predator_incursion", "quarrel_pressure"),
        ] {
            let mut snapshot = test_snapshot("env-mod", "Mod", "mock-model", 42, 1);
            snapshot.environment.forecast = Some(pending_forecast(kind, 1));
            snapshot.turn = 1;
            tick_environment(&mut snapshot);
            assert!(
                snapshot.modifiers.iter().any(|m| m.kind == modifier_kind),
                "a fired {kind} must push a reused '{modifier_kind}' modifier"
            );
            // The pushed kind must be one resolve_environment actually handles —
            // assert it is NOT the silent-no-op wildcard set (negative test).
            assert!(
                matches!(
                    modifier_kind,
                    "drought" | "cold_snap" | "fatigue" | "quarrel_pressure"
                ),
                "a fired {kind} must map to a kind with a live resolve_environment arm"
            );
        }
        // A flood (terrain-only) must NOT push any modifier — neither its own kind
        // nor a reused one (Pitfall 5: no unknown 'flood' kind, and no modifier at all).
        let mut flood = test_snapshot("env-flood-mod", "Flood", "mock-model", 42, 1);
        flood.environment.forecast = Some(pending_forecast("flood", 1));
        flood.turn = 1;
        tick_environment(&mut flood);
        assert!(
            !flood.modifiers.iter().any(|m| m.kind == "flood"),
            "a flood must not introduce an unknown 'flood' modifier kind"
        );
        assert!(
            flood.modifiers.is_empty(),
            "a terrain-only flood must push no modifier at all"
        );
    }

    #[test]
    fn tick_environment_regrowth_runs_in_tick() {
        // A renewable tile below cap gains amount after a summer tick; an ore tile
        // is unchanged (finite stays depleted).
        let mut snapshot = test_snapshot("env-regrow", "Regrow", "mock-model", 42, 1);
        // Force a warm, regrowth-friendly season for the tick.
        snapshot.environment.season = "summer".to_string();
        snapshot.environment.turn_of_season = 0;
        snapshot.environment.temperature = 24.0;
        // Seed a known renewable + finite tile by overwriting two existing tiles.
        snapshot.world.tiles[0] = renewable_tile("moss", 5);
        snapshot.world.tiles[1] = finite_tile("ore", 3);
        snapshot.turn = 1;
        tick_environment(&mut snapshot);
        assert!(
            snapshot.world.tiles[0].amount > 5,
            "a renewable tile below cap must regrow during the tick"
        );
        assert_eq!(
            snapshot.world.tiles[1].amount, 3,
            "a finite ore tile must never regrow"
        );
    }

    // --- ENV-01/02/03: full-tick byte-determinism + back-compat (Wave-3 / 03-03 Task 2) ---

    #[test]
    fn tick_environment_deterministic() {
        // Threat T-03-08: a single tick on two clones of the same (seed, turn) must
        // yield serde-identical environment + world.tiles (deterministic replay).
        let mut a = test_snapshot("det", "Det", "mock-model", 777, 1);
        let mut b = a.clone();
        a.turn = 1;
        b.turn = 1;
        tick_environment(&mut a);
        tick_environment(&mut b);
        assert_eq!(
            serde_json::to_string(&a.environment).unwrap(),
            serde_json::to_string(&b.environment).unwrap(),
            "environment must be byte-deterministic for a given (seed, turn)"
        );
        assert_eq!(
            serde_json::to_string(&a.world.tiles).unwrap(),
            serde_json::to_string(&b.world.tiles).unwrap(),
            "world.tiles must be byte-deterministic for a given (seed, turn)"
        );
    }

    #[test]
    fn tick_environment_multi_turn_deterministic() {
        // Run a full multi-turn replay on two clones (incrementing turn as
        // advance_civ_turn does) and assert final environment + tiles serde-equal.
        // Seed 777 fires at least one disaster within 12 turns (forecast→fire→expiry
        // cycle), so this also exercises the reshape path under replay.
        let mut a = test_snapshot("multi", "Multi", "mock-model", 777, 1);
        let mut b = a.clone();
        let mut saw_disaster = false;
        for t in 1..=12u32 {
            a.turn = t;
            tick_environment(&mut a);
            b.turn = t;
            tick_environment(&mut b);
            if !a.environment.disasters.is_empty() {
                saw_disaster = true;
            }
        }
        assert_eq!(
            serde_json::to_string(&a.environment).unwrap(),
            serde_json::to_string(&b.environment).unwrap(),
            "multi-turn environment replay must be byte-identical"
        );
        assert_eq!(
            serde_json::to_string(&a.world.tiles).unwrap(),
            serde_json::to_string(&b.world.tiles).unwrap(),
            "multi-turn world.tiles replay must be byte-identical"
        );
        assert!(
            saw_disaster,
            "seed 777 must fire at least one disaster within 12 turns (exercises the cycle)"
        );
    }

    #[test]
    fn tile_count_invariant_after_ticks() {
        // Threat T-03-10: repeated ticks (including disaster fires) never add or
        // remove tiles — the world stays exactly width * WORLD_HEIGHT.
        let mut a = test_snapshot("inv", "Inv", "mock-model", 777, 1);
        let n = a.world.tiles.len();
        let expected = (a.world.width * WORLD_HEIGHT) as usize;
        assert_eq!(n, expected, "world starts at width * WORLD_HEIGHT");
        for t in 1..=24u32 {
            a.turn = t;
            tick_environment(&mut a);
        }
        assert_eq!(
            a.world.tiles.len(),
            n,
            "tile count must be invariant across many ticks"
        );
        assert_eq!(
            a.world.tiles.len(),
            expected,
            "tile count must stay width * WORLD_HEIGHT after ticks"
        );
    }

    #[test]
    fn old_save_loads_calm_spring() {
        // Threat T-03-09: a save missing the `environment` key still loads, defaulting
        // to a calm spring via #[serde(default = "default_environment")]. This proves
        // the no-new-field line held (a non-defaulted new field would fail to parse).
        let s = test_snapshot("oldsave", "Old", "mock-model", 9, 1);
        let mut value = serde_json::to_value(&s).unwrap();
        value
            .as_object_mut()
            .unwrap()
            .remove("environment")
            .expect("snapshot serialized with an environment key");
        let raw = serde_json::to_string(&value).unwrap();
        let loaded = parse_snapshot(&raw).expect("old save (no environment) must still load");
        assert_eq!(
            loaded.environment.season, "spring",
            "an env-less save defaults to calm spring"
        );
        assert_eq!(loaded.environment.turn_of_season, 0);
        assert!(loaded.environment.disasters.is_empty());
        assert!(loaded.environment.forecast.is_none());
    }

    // ---- W6 (Phase 4) combat/diplomacy surface: CivDecisionAction + validate_action ----

    #[test]
    fn new_action_fields_deserialize() {
        // A diplomacy action JSON carries the new target/stance fields.
        let raw = r#"{"type":"diplomacy","target":"civ-2","stance":"ally"}"#;
        let action: CivDecisionAction =
            serde_json::from_str(raw).expect("diplomacy action must deserialize");
        assert_eq!(action.action_type, "diplomacy");
        assert_eq!(action.target.as_deref(), Some("civ-2"));
        assert_eq!(action.stance.as_deref(), Some("ally"));
        // A trade action carries give/receive resources + amounts.
        let raw = r#"{"type":"trade","target":"civ-2","resource":"food","amount":10,"receive":"stone","receive_amount":5}"#;
        let trade: CivDecisionAction =
            serde_json::from_str(raw).expect("trade action must deserialize");
        assert_eq!(trade.receive.as_deref(), Some("stone"));
        assert_eq!(trade.amount, Some(10));
        assert_eq!(trade.receive_amount, Some(5));
    }

    #[test]
    fn old_action_json_still_deserializes() {
        // Pre-Phase-4 action JSON (no target/stance/receive/amount/receive_amount)
        // must still load; serde defaults fill the new fields with None.
        let raw = r#"{"type":"gather","resource":"food","workers":2}"#;
        let action: CivDecisionAction =
            serde_json::from_str(raw).expect("old action JSON must still deserialize");
        assert_eq!(action.action_type, "gather");
        assert_eq!(action.workers, Some(2));
        assert!(action.target.is_none());
        assert!(action.stance.is_none());
        assert!(action.receive.is_none());
        assert!(action.amount.is_none());
        assert!(action.receive_amount.is_none());
    }

    fn action_json(raw: &str) -> CivDecisionAction {
        serde_json::from_str(raw).expect("valid action JSON")
    }

    #[test]
    fn validate_action_accepts_new_actions() {
        // claim with no target (deterministic adjacent expansion) is valid.
        assert!(validate_action(&action_json(r#"{"type":"claim"}"#)).is_ok());
        // claim with an explicit region target is valid.
        assert!(validate_action(&action_json(r#"{"type":"claim","target":"region-3"}"#)).is_ok());
        assert!(validate_action(&action_json(
            r#"{"type":"diplomacy","target":"civ-2","stance":"ally"}"#
        ))
        .is_ok());
        assert!(validate_action(&action_json(
            r#"{"type":"trade","target":"civ-2","resource":"food","receive":"stone"}"#
        ))
        .is_ok());
        assert!(validate_action(&action_json(r#"{"type":"attack","target":"civ-2"}"#)).is_ok());
    }

    #[test]
    fn validate_action_rejects_malformed_new_actions() {
        // Unknown stance.
        assert!(validate_action(&action_json(
            r#"{"type":"diplomacy","target":"civ-2","stance":"foo"}"#
        ))
        .is_err());
        // Missing target on diplomacy.
        assert!(validate_action(&action_json(r#"{"type":"diplomacy","stance":"ally"}"#)).is_err());
        // Empty target on attack.
        assert!(validate_action(&action_json(r#"{"type":"attack"}"#)).is_err());
        // Trade missing the give/receive resources.
        assert!(validate_action(&action_json(r#"{"type":"trade","target":"civ-2"}"#)).is_err());
    }

    #[test]
    fn validate_action_still_rejects_unknown_types() {
        // ARENA-02: the catch-all keeps rejecting unknown action types so existing
        // gather/build/etc. are unaffected.
        let err = validate_action(&action_json(r#"{"type":"teleport"}"#)).unwrap_err();
        assert_eq!(err, "unknown action type: teleport");
    }

    // ---- W6 (Phase 4) claim_region / set_stance / apply_trade helpers ----

    /// The first region NOT owned by civ-1 (the home region is claimed at spawn).
    /// Regions tile contiguously, so the neighbour of the home region is adjacent.
    fn first_unclaimed_region_id(s: &CivSessionSnapshot) -> String {
        s.world
            .regions
            .iter()
            .find(|r| r.owner.is_none())
            .map(|r| r.id.clone())
            .expect("a world has at least one unclaimed region")
    }

    /// An unclaimed region adjacent to civ-1's owned territory (shares a boundary
    /// with the home region, since regions tile contiguously across the world).
    fn adjacent_unclaimed_region_id(s: &CivSessionSnapshot, civ_id: &str) -> String {
        let owned: Vec<(u32, u32)> = s
            .world
            .regions
            .iter()
            .filter(|r| r.owner.as_deref() == Some(civ_id))
            .map(|r| (r.x, r.x + r.width))
            .collect();
        s.world
            .regions
            .iter()
            .filter(|r| r.owner.is_none())
            .find(|r| {
                let (lo, hi) = (r.x, r.x + r.width);
                owned.iter().any(|&(olo, ohi)| lo <= ohi && olo <= hi)
            })
            .map(|r| r.id.clone())
            .expect("a contiguous world has an unclaimed region adjacent to home")
    }

    #[test]
    fn claim_region_sets_owner_on_adjacent_unclaimed() {
        let mut s = multi_civ_snapshot(2024, 2);
        let cid = civ_id_for(0);
        let region_id = adjacent_unclaimed_region_id(&s, &cid);
        let claimed = claim_region(&mut s, &cid, Some(&region_id)).expect("adjacent claim ok");
        assert_eq!(claimed, region_id);
        let region = s.world.regions.iter().find(|r| r.id == region_id).unwrap();
        assert_eq!(region.owner.as_deref(), Some(cid.as_str()));
    }

    #[test]
    fn claim_region_auto_expands_when_target_omitted() {
        let mut s = multi_civ_snapshot(2024, 2);
        let cid = civ_id_for(0);
        let owned_before = s
            .world
            .regions
            .iter()
            .filter(|r| r.owner.as_deref() == Some(cid.as_str()))
            .count();
        let claimed = claim_region(&mut s, &cid, None).expect("auto-expand ok");
        let region = s.world.regions.iter().find(|r| r.id == claimed).unwrap();
        assert_eq!(region.owner.as_deref(), Some(cid.as_str()));
        let owned_after = s
            .world
            .regions
            .iter()
            .filter(|r| r.owner.as_deref() == Some(cid.as_str()))
            .count();
        assert_eq!(owned_after, owned_before + 1);
    }

    #[test]
    fn claim_region_rejects_owned_region() {
        let mut s = multi_civ_snapshot(2024, 2);
        let cid = civ_id_for(0);
        // First give civ-2 an adjacent region of civ-1's, then have civ-1 try to claim it.
        let region_id = adjacent_unclaimed_region_id(&s, &cid);
        if let Some(region) = s.world.regions.iter_mut().find(|r| r.id == region_id) {
            region.owner = Some(civ_id_for(1));
        }
        let err = claim_region(&mut s, &cid, Some(&region_id)).unwrap_err();
        assert!(err.contains("already owned"), "got: {err}");
        // Owner unchanged (still civ-2).
        let region = s.world.regions.iter().find(|r| r.id == region_id).unwrap();
        assert_eq!(region.owner.as_deref(), Some(civ_id_for(1).as_str()));
    }

    #[test]
    fn claim_region_rejects_non_adjacent() {
        let mut s = multi_civ_snapshot(2024, 2);
        let cid = civ_id_for(0);
        // Strip civ-1's owned regions AND its spawn so nothing is adjacent, then
        // attempt to claim some unclaimed region.
        for region in &mut s.world.regions {
            if region.owner.as_deref() == Some(cid.as_str()) {
                region.owner = None;
            }
        }
        if let Some(ci) = civ_index(&s, &cid) {
            // Move the spawn far outside every region so no region contains it.
            s.civs[ci].spawn_x = u32::MAX;
        }
        let region_id = first_unclaimed_region_id(&s);
        let err = claim_region(&mut s, &cid, Some(&region_id)).unwrap_err();
        assert!(err.contains("not adjacent"), "got: {err}");
        let region = s.world.regions.iter().find(|r| r.id == region_id).unwrap();
        assert!(
            region.owner.is_none(),
            "non-adjacent claim must not mutate owner"
        );
    }

    #[test]
    fn set_stance_writes_diplomacy_map() {
        let mut s = multi_civ_snapshot(2024, 2);
        let a = civ_id_for(0);
        let b = civ_id_for(1);
        set_stance(&mut s, &a, &b, "ally");
        let ci = civ_index(&s, &a).unwrap();
        assert_eq!(
            s.civs[ci].diplomacy.get(&b).map(String::as_str),
            Some("ally")
        );
        // Self-targeting is ignored.
        set_stance(&mut s, &a, &a, "hostile");
        assert!(s.civs[ci].diplomacy.get(&a).is_none());
    }

    #[test]
    fn apply_trade_swaps_and_conserves_resources() {
        let mut s = multi_civ_snapshot(2024, 2);
        let a = civ_id_for(0);
        let b = civ_id_for(1);
        let ai = civ_index(&s, &a).unwrap();
        let bi = civ_index(&s, &b).unwrap();
        // Known starting holdings (initial_snapshot seeds food=42, stone=10).
        let a_food0 = s.civs[ai].resources["food"];
        let a_stone0 = s.civs[ai].resources["stone"];
        let b_food0 = s.civs[bi].resources["food"];
        let b_stone0 = s.civs[bi].resources["stone"];
        apply_trade(&mut s, &a, &b, "food", 10, "stone", 5).expect("trade ok");
        assert_eq!(s.civs[ai].resources["food"], a_food0 - 10);
        assert_eq!(s.civs[ai].resources["stone"], a_stone0 + 5);
        assert_eq!(s.civs[bi].resources["food"], b_food0 + 10);
        assert_eq!(s.civs[bi].resources["stone"], b_stone0 - 5);
        // Conservation: total food and total stone across both civs is unchanged.
        assert_eq!(
            s.civs[ai].resources["food"] + s.civs[bi].resources["food"],
            a_food0 + b_food0
        );
        assert_eq!(
            s.civs[ai].resources["stone"] + s.civs[bi].resources["stone"],
            a_stone0 + b_stone0
        );
    }

    #[test]
    fn apply_trade_clamps_over_ask_and_never_negative() {
        let mut s = multi_civ_snapshot(2024, 2);
        let a = civ_id_for(0);
        let b = civ_id_for(1);
        let ai = civ_index(&s, &a).unwrap();
        let bi = civ_index(&s, &b).unwrap();
        let a_food0 = s.civs[ai].resources["food"];
        let b_food0 = s.civs[bi].resources["food"];
        // Ask civ-1 to give 1_000_000 food (far more than it holds) for nothing back.
        apply_trade(&mut s, &a, &b, "food", 1_000_000, "stone", 0).expect("clamped trade ok");
        // Giver is drained to 0 (never negative); receiver gains exactly the giver's holdings.
        assert_eq!(s.civs[ai].resources["food"], 0);
        assert_eq!(s.civs[bi].resources["food"], b_food0 + a_food0);
        assert!(s.civs[ai].resources.values().all(|&v| v >= 0));
        assert!(s.civs[bi].resources.values().all(|&v| v >= 0));
    }

    #[test]
    fn apply_trade_blocked_when_hostile() {
        let mut s = multi_civ_snapshot(2024, 2);
        let a = civ_id_for(0);
        let b = civ_id_for(1);
        let ai = civ_index(&s, &a).unwrap();
        let bi = civ_index(&s, &b).unwrap();
        // civ-2 declares civ-1 hostile; the trade must be refused and mutate nothing.
        set_stance(&mut s, &b, &a, "hostile");
        let snap_before = serde_json::to_string(&s.civs).unwrap();
        let err = apply_trade(&mut s, &a, &b, "food", 10, "stone", 5).unwrap_err();
        assert!(err.contains("hostile"), "got: {err}");
        assert_eq!(
            serde_json::to_string(&s.civs).unwrap(),
            snap_before,
            "a hostile-blocked trade must mutate nothing"
        );
        let _ = (ai, bi);
    }

    #[test]
    fn apply_trade_rejects_self_trade() {
        let mut s = multi_civ_snapshot(2024, 2);
        let a = civ_id_for(0);
        let err = apply_trade(&mut s, &a, &a, "food", 10, "stone", 5).unwrap_err();
        assert!(err.contains("self"), "got: {err}");
    }

    // --- WAR-02 / WAR-03 combat tests (04-02) ---
    //
    // multi_civ_snapshot only seeds axolotl ENTITIES for civ-1; the cloned civ-2
    // struct has a population counter but no entities. `give_civ_axolotls` pushes
    // adult axolotl entities tagged with a civ id so the DEFENDER can lose entities.

    fn give_civ_axolotls(s: &mut CivSessionSnapshot, civ_id: &str, n: u32) {
        for i in 0..n {
            s.world.entities.push(CivEntity {
                id: format!("axo-{civ_id}-test-{i}"),
                kind: "axolotl".to_string(),
                name: format!("Test Axolotl {i}"),
                x: 10 + i,
                y: 20,
                health: 80.0,
                mood: 70.0,
                role: "worker".to_string(),
                civ_id: Some(civ_id.to_string()),
                stage: "adult".to_string(),
                sex: if i % 2 == 0 { "f" } else { "m" }.to_string(),
                age: 10,
                ..Default::default()
            });
        }
    }

    #[test]
    fn civ_strength_monotonic() {
        let base = multi_civ_snapshot(2024, 2);
        let cid = civ_id_for(0);
        let ci = civ_index(&base, &cid).unwrap();
        let s0 = civ_strength(&base, &cid);
        // Deterministic: same input -> same f32.
        assert_eq!(s0, civ_strength(&base, &cid));

        // Population up -> strength up.
        let mut s_pop = base.clone();
        s_pop.civs[ci].population += 5;
        assert!(
            civ_strength(&s_pop, &cid) > s0,
            "more population must raise strength"
        );

        // Tools up -> strength up.
        let mut s_tools = base.clone();
        *s_tools.civs[ci]
            .resources
            .entry("tools".to_string())
            .or_insert(0) += 50;
        assert!(
            civ_strength(&s_tools, &cid) > s0,
            "more tools must raise strength"
        );

        // A new tech -> strength up.
        let mut s_tech = base.clone();
        s_tech.civs[ci].techs.push("a_brand_new_tech".to_string());
        assert!(
            civ_strength(&s_tech, &cid) > s0,
            "an added tech must raise strength"
        );

        // An owned region -> strength up.
        let mut s_owned = base.clone();
        if let Some(region) = s_owned.world.regions.iter_mut().find(|r| r.owner.is_none()) {
            region.owner = Some(cid.clone());
        }
        assert!(
            civ_strength(&s_owned, &cid) > s0,
            "an owned region must raise strength"
        );
    }

    #[test]
    fn resolve_attack_is_deterministic() {
        let mut base = multi_civ_snapshot(2024, 2);
        base.turn = 5;
        give_civ_axolotls(&mut base, &civ_id_for(1), 8);
        let mut a = base.clone();
        let mut b = base.clone();
        let mut ra = (a.seed ^ a.turn.wrapping_mul(0x9E37_79B9) ^ 0xC0FF_EE01).max(1);
        let mut rb = (b.seed ^ b.turn.wrapping_mul(0x9E37_79B9) ^ 0xC0FF_EE01).max(1);
        let oa = resolve_attack(&mut a, &civ_id_for(0), &civ_id_for(1), &mut ra);
        let ob = resolve_attack(&mut b, &civ_id_for(0), &civ_id_for(1), &mut rb);
        assert_eq!(oa, ob, "outcome must be identical for a fixed (seed, turn)");
        assert_eq!(
            serde_json::to_string(&a.civs).unwrap(),
            serde_json::to_string(&b.civs).unwrap(),
            "civs JSON must be byte-identical across clones"
        );
        assert_eq!(
            serde_json::to_string(&a.world.entities).unwrap(),
            serde_json::to_string(&b.world.entities).unwrap(),
            "entity casualties must be byte-identical across clones"
        );
    }

    #[test]
    fn combat_casualties_remove_entities() {
        let mut s = multi_civ_snapshot(2024, 2);
        s.turn = 3;
        // civ-1 is the defender (it has founder axolotl entities). Make the attacker
        // (civ-2) far stronger so the defender takes losses.
        let attacker = civ_id_for(1);
        let defender = civ_id_for(0);
        let ai = civ_index(&s, &attacker).unwrap();
        s.civs[ai].population += 40;
        *s.civs[ai].resources.entry("tools".to_string()).or_insert(0) += 200;
        let before = living_axolotl_count(&s, &defender);
        let mut rng = (s.seed ^ s.turn.wrapping_mul(0x9E37_79B9) ^ 0xC0FF_EE01).max(1);
        resolve_attack(&mut s, &attacker, &defender, &mut rng);
        let after_entities = living_axolotl_count(&s, &defender);
        assert!(
            after_entities < before,
            "the defender must lose living axolotl entities ({before} -> {after_entities})"
        );
        // The population mirror re-syncs from surviving entities in resolve_environment.
        resolve_environment(&mut s, &defender);
        let di = civ_index(&s, &defender).unwrap();
        assert_eq!(
            s.civs[di].population, after_entities,
            "population mirror must reflect the reduced entity count, not the pre-attack number"
        );
    }

    #[test]
    fn attack_no_instant_wipeout() {
        let mut s = multi_civ_snapshot(2024, 2);
        s.turn = 7;
        // A 1-population defender vs a vastly stronger attacker.
        let attacker = civ_id_for(0); // has founder entities + we boost it
        let defender = civ_id_for(1);
        let ai = civ_index(&s, &attacker).unwrap();
        s.civs[ai].population += 100;
        *s.civs[ai].resources.entry("tools".to_string()).or_insert(0) += 500;
        give_civ_axolotls(&mut s, &defender, 1); // exactly one living defender
        let mut rng = (s.seed ^ s.turn.wrapping_mul(0x9E37_79B9) ^ 0xC0FF_EE01).max(1);
        resolve_attack(&mut s, &attacker, &defender, &mut rng);
        assert!(
            living_axolotl_count(&s, &defender) >= 1,
            "a single attack must never reduce a defender to 0 living axolotls"
        );
    }

    #[test]
    fn plunder_is_bounded_and_conserved() {
        let mut s = multi_civ_snapshot(2024, 2);
        s.turn = 2;
        let attacker = civ_id_for(0); // founder entities; boosted to force a decisive win
        let defender = civ_id_for(1);
        let ai = civ_index(&s, &attacker).unwrap();
        let di = civ_index(&s, &defender).unwrap();
        s.civs[ai].population += 200;
        *s.civs[ai].resources.entry("tools".to_string()).or_insert(0) += 1000;
        give_civ_axolotls(&mut s, &defender, 6);
        // Known defender holdings to track conservation.
        let def_food0 = s.civs[di].resources.get("food").copied().unwrap_or(0);
        let atk_food0 = s.civs[ai].resources.get("food").copied().unwrap_or(0);
        let mut rng = (s.seed ^ s.turn.wrapping_mul(0x9E37_79B9) ^ 0xC0FF_EE01).max(1);
        let win = resolve_attack(&mut s, &attacker, &defender, &mut rng);
        assert!(win, "the overwhelming attacker must score a decisive win");
        let def_food1 = s.civs[di].resources.get("food").copied().unwrap_or(0);
        let atk_food1 = s.civs[ai].resources.get("food").copied().unwrap_or(0);
        // Conservation: attacker's food gain == defender's food loss.
        assert_eq!(
            atk_food1 - atk_food0,
            def_food0 - def_food1,
            "attacker gain must equal defender loss (conserved)"
        );
        // Bounded: at most PLUNDER_FRAC of the original holding was taken.
        let taken = def_food0 - def_food1;
        assert!(
            taken <= (def_food0 as f32 * PLUNDER_FRAC).ceil() as i32,
            "plunder must be bounded by the cap fraction (took {taken} of {def_food0})"
        );
        // No negative resources anywhere.
        assert!(s.civs[ai].resources.values().all(|&v| v >= 0));
        assert!(s.civs[di].resources.values().all(|&v| v >= 0));
    }

    #[test]
    fn attack_no_negative_resources() {
        // A defender with tiny holdings raided decisively must never go negative.
        let mut s = multi_civ_snapshot(2024, 2);
        s.turn = 4;
        let attacker = civ_id_for(0);
        let defender = civ_id_for(1);
        let ai = civ_index(&s, &attacker).unwrap();
        let di = civ_index(&s, &defender).unwrap();
        s.civs[ai].population += 200;
        *s.civs[ai].resources.entry("tools".to_string()).or_insert(0) += 1000;
        // Drain the defender to near-empty.
        for v in s.civs[di].resources.values_mut() {
            *v = 1;
        }
        give_civ_axolotls(&mut s, &defender, 6);
        let mut rng = (s.seed ^ s.turn.wrapping_mul(0x9E37_79B9) ^ 0xC0FF_EE01).max(1);
        resolve_attack(&mut s, &attacker, &defender, &mut rng);
        assert!(
            s.civs[di].resources.values().all(|&v| v >= 0),
            "defender resources must never go negative after a raid"
        );
        assert!(s.civs[ai].resources.values().all(|&v| v >= 0));
    }

    #[test]
    fn raid_transfers_owner() {
        let mut s = multi_civ_snapshot(2024, 2);
        s.turn = 6;
        let attacker = civ_id_for(0);
        let defender = civ_id_for(1);
        let ai = civ_index(&s, &attacker).unwrap();
        s.civs[ai].population += 200;
        *s.civs[ai].resources.entry("tools".to_string()).or_insert(0) += 1000;
        give_civ_axolotls(&mut s, &defender, 6);
        // Give the defender its home region plus a peripheral region (>1 owned).
        let home = s.civs[civ_index(&s, &defender).unwrap()]
            .home_region
            .clone();
        let mut peripheral = String::new();
        for region in &mut s.world.regions {
            if region.id == home {
                region.owner = Some(defender.clone());
            } else if region.owner.is_none() && peripheral.is_empty() {
                region.owner = Some(defender.clone());
                peripheral = region.id.clone();
            }
        }
        assert!(!peripheral.is_empty(), "test needs a peripheral region");
        let owned_before = s
            .world
            .regions
            .iter()
            .filter(|r| r.owner.as_deref() == Some(defender.as_str()))
            .count();
        let mut rng = (s.seed ^ s.turn.wrapping_mul(0x9E37_79B9) ^ 0xC0FF_EE01).max(1);
        let win = resolve_attack(&mut s, &attacker, &defender, &mut rng);
        assert!(win, "decisive win required to seize a region");
        let owned_after = s
            .world
            .regions
            .iter()
            .filter(|r| r.owner.as_deref() == Some(defender.as_str()))
            .count();
        assert_eq!(
            owned_after,
            owned_before - 1,
            "exactly one region must flip"
        );
        // The peripheral (non-home) region was taken; the home was spared (it owned >1).
        let peripheral_owner = s
            .world
            .regions
            .iter()
            .find(|r| r.id == peripheral)
            .and_then(|r| r.owner.clone());
        assert_eq!(
            peripheral_owner.as_deref(),
            Some(attacker.as_str()),
            "the peripheral region must flip to the attacker"
        );
        let home_owner = s
            .world
            .regions
            .iter()
            .find(|r| r.id == home)
            .and_then(|r| r.owner.clone());
        assert_eq!(
            home_owner.as_deref(),
            Some(defender.as_str()),
            "the defender's home region is preferentially spared"
        );
    }

    #[test]
    fn allies_do_not_fight() {
        let mut s = multi_civ_snapshot(2024, 2);
        s.turn = 8;
        let attacker = civ_id_for(0);
        let defender = civ_id_for(1);
        let ai = civ_index(&s, &attacker).unwrap();
        s.civs[ai].population += 200;
        *s.civs[ai].resources.entry("tools".to_string()).or_insert(0) += 1000;
        give_civ_axolotls(&mut s, &defender, 6);
        // UNILATERAL rule: the attacker flags the defender as an ally.
        set_stance(&mut s, &attacker, &defender, "ally");
        let before = serde_json::to_string(&s.civs).unwrap();
        let before_entities = serde_json::to_string(&s.world.entities).unwrap();
        let logs_before = s.log.len();
        let mut rng = (s.seed ^ s.turn.wrapping_mul(0x9E37_79B9) ^ 0xC0FF_EE01).max(1);
        let win = resolve_attack(&mut s, &attacker, &defender, &mut rng);
        assert!(!win, "an attack on an ally is never a win");
        assert_eq!(
            serde_json::to_string(&s.civs).unwrap(),
            before,
            "no casualties, plunder, or flip when attacking an ally"
        );
        assert_eq!(
            serde_json::to_string(&s.world.entities).unwrap(),
            before_entities,
            "no entity removal when attacking an ally"
        );
        assert!(s.log.len() > logs_before, "the ally refusal must be logged");
    }

    // --- WAR-02 combat world pass (resolve_combat) tests (04-02 Task 2) ---

    #[test]
    fn turn_with_combat_is_replay_stable() {
        let mut base = multi_civ_snapshot(2024, 2);
        base.turn = 5;
        // civ-2 hostile toward civ-1, with its own entities to lose; queue civ-1→civ-2.
        give_civ_axolotls(&mut base, &civ_id_for(1), 8);
        set_stance(&mut base, &civ_id_for(1), &civ_id_for(0), "hostile");
        let mut a = base.clone();
        let mut b = base.clone();
        let mut qa = vec![(civ_id_for(0), civ_id_for(1))];
        let mut qb = vec![(civ_id_for(0), civ_id_for(1))];
        resolve_combat(&mut a, &mut qa);
        resolve_combat(&mut b, &mut qb);
        // Compare the combat-mutated state (civs + entities + regions). The log carries
        // a wall-clock `created_at`, so the established determinism tests compare the
        // load-bearing state, not the full snapshot — see tick_environment_deterministic.
        assert_eq!(
            serde_json::to_string(&a.civs).unwrap(),
            serde_json::to_string(&b.civs).unwrap(),
            "civs must be byte-identical across the replayed combat pass"
        );
        assert_eq!(
            serde_json::to_string(&a.world.entities).unwrap(),
            serde_json::to_string(&b.world.entities).unwrap(),
            "entity casualties must be byte-identical across the replayed combat pass"
        );
        assert_eq!(
            serde_json::to_string(&a.world.regions).unwrap(),
            serde_json::to_string(&b.world.regions).unwrap(),
            "region ownership must be byte-identical across the replayed combat pass"
        );
    }

    #[test]
    fn resolve_combat_sorts_attacks_into_fixed_order() {
        // Two attacks queued in opposite orders must produce identical state, proving
        // the pass sorts the queue before resolving (order-independent of decision order).
        let mut base = multi_civ_snapshot(2024, 3);
        base.turn = 9;
        give_civ_axolotls(&mut base, &civ_id_for(1), 8);
        give_civ_axolotls(&mut base, &civ_id_for(2), 8);
        // civ-1 attacks civ-2; civ-3 attacks civ-2. Boost both attackers.
        for cid in [civ_id_for(0), civ_id_for(2)] {
            let i = civ_index(&base, &cid).unwrap();
            base.civs[i].population += 60;
            *base.civs[i]
                .resources
                .entry("tools".to_string())
                .or_insert(0) += 200;
        }
        let mut a = base.clone();
        let mut b = base.clone();
        // Queue in one order on `a`, the reverse on `b`.
        let mut qa = vec![
            (civ_id_for(0), civ_id_for(1)),
            (civ_id_for(2), civ_id_for(1)),
        ];
        let mut qb = vec![
            (civ_id_for(2), civ_id_for(1)),
            (civ_id_for(0), civ_id_for(1)),
        ];
        resolve_combat(&mut a, &mut qa);
        resolve_combat(&mut b, &mut qb);
        assert_eq!(
            serde_json::to_string(&a.civs).unwrap(),
            serde_json::to_string(&b.civs).unwrap(),
            "resolution must be independent of the queued (decision) order"
        );
        assert_eq!(
            serde_json::to_string(&a.world.entities).unwrap(),
            serde_json::to_string(&b.world.entities).unwrap(),
            "casualties must be independent of the queued order"
        );
        // The pass sorts the slice in place to a fixed (attacker, target) order.
        assert_eq!(qa, qb, "both queues must sort to the same fixed order");
        assert!(
            qa.windows(2).all(|w| w[0] <= w[1]),
            "the queue must be sorted ascending after the pass"
        );
    }

    #[test]
    fn combat_pass_runs_before_population_mirror_resync() {
        // Simulate the advance_civ_turn ordering: combat pass, THEN resolve_environment.
        // The defender's population mirror must reflect the casualties.
        let mut s = multi_civ_snapshot(2024, 2);
        s.turn = 3;
        // civ-1 is the defender (it has founder entities); boost the attacker (civ-2).
        let attacker = civ_id_for(1);
        let defender = civ_id_for(0);
        let ai = civ_index(&s, &attacker).unwrap();
        s.civs[ai].population += 80;
        *s.civs[ai].resources.entry("tools".to_string()).or_insert(0) += 400;
        let before = living_axolotl_count(&s, &defender);
        let mut queue = vec![(attacker.clone(), defender.clone())];
        resolve_combat(&mut s, &mut queue);
        let after_entities = living_axolotl_count(&s, &defender);
        assert!(
            after_entities < before,
            "the combat pass must remove defender entities ({before} -> {after_entities})"
        );
        // Now resolve_environment re-syncs the mirror — it must equal the survivor count.
        resolve_environment(&mut s, &defender);
        let di = civ_index(&s, &defender).unwrap();
        assert_eq!(
            s.civs[di].population, after_entities,
            "population mirror (re-synced after combat) must reflect the casualties"
        );
    }

    // --- WAR-04 wild predators (spawn_predators + step_predators) tests (04-03) ---

    /// Count the wild predator entities currently in the world.
    fn predator_count(s: &CivSessionSnapshot) -> usize {
        s.world
            .entities
            .iter()
            .filter(|e| e.kind == "predator" && e.civ_id.is_none())
            .count()
    }

    /// Push `n` wild predator entities adjacent to `civ_id`'s colony centre (for the
    /// step_predators tests — bypasses the forecast-fire spawn path).
    fn give_predators_near(s: &mut CivSessionSnapshot, civ_id: &str, n: u32) {
        let (cx, cy) = colony_center(s, civ_id);
        for i in 0..n {
            s.world.entities.push(CivEntity {
                id: format!("predator-test-{i}"),
                kind: "predator".to_string(),
                role: "predator".to_string(),
                name: "Wild predator".to_string(),
                x: cx,
                y: cy,
                health: 1.0,
                civ_id: None,
                stage: "adult".to_string(),
                age: 0,
                ..Default::default()
            });
        }
    }

    #[test]
    fn predator_incursion_spawns_predators() {
        // A fired predator_incursion forecast spawns >=1 wild predator entity
        // (kind=="predator", civ_id==None) with the deterministic predator-{turn}-{n}
        // id, while STILL pushing the quarrel_pressure modifier (Open Q3).
        let mut s = multi_civ_snapshot(2024, 2);
        give_civ_axolotls(&mut s, &civ_id_for(0), 6);
        s.environment.forecast = Some(pending_forecast("predator_incursion", 1));
        s.turn = 3;
        let before = predator_count(&s);
        tick_environment(&mut s);
        let after = predator_count(&s);
        assert!(
            after > before,
            "a fired predator_incursion must spawn net-new predator entities ({before} -> {after})"
        );
        // Every spawned predator is wild (civ_id None) with a deterministic id.
        let preds: Vec<&CivEntity> = s
            .world
            .entities
            .iter()
            .filter(|e| e.kind == "predator")
            .collect();
        assert!(
            preds.iter().all(|p| p.civ_id.is_none()),
            "predators must be wild fauna (civ_id == None)"
        );
        assert!(
            preds.iter().all(|p| p.id.starts_with("predator-3-")),
            "predator ids must follow predator-{{turn}}-{{n}} (deterministic, no uuid/clock)"
        );
        // Open Q3: the quarrel_pressure morale modifier still fires alongside the predators.
        assert!(
            s.modifiers.iter().any(|m| m.kind == "quarrel_pressure"),
            "the existing quarrel_pressure modifier must STILL fire with predators (Open Q3)"
        );
    }

    #[test]
    fn predator_spawn_is_deterministic() {
        // Firing predator_incursion at the same (seed, turn) on two clones yields
        // byte-identical world.entities (predator ids + positions identical).
        let mut base = multi_civ_snapshot(2024, 2);
        give_civ_axolotls(&mut base, &civ_id_for(0), 6);
        base.environment.forecast = Some(pending_forecast("predator_incursion", 1));
        base.turn = 4;
        let mut a = base.clone();
        let mut b = base.clone();
        tick_environment(&mut a);
        tick_environment(&mut b);
        assert!(
            predator_count(&a) > 0,
            "the test must actually spawn predators"
        );
        assert_eq!(
            serde_json::to_string(&a.world.entities).unwrap(),
            serde_json::to_string(&b.world.entities).unwrap(),
            "predator spawn must be byte-identical across clones at a fixed (seed, turn)"
        );
    }

    #[test]
    fn non_predator_disaster_spawns_no_predators() {
        // A non-predator disaster (drought) must NOT spawn any predator entities.
        let mut s = multi_civ_snapshot(2024, 2);
        give_civ_axolotls(&mut s, &civ_id_for(0), 6);
        s.environment.forecast = Some(pending_forecast("drought", 1));
        s.turn = 3;
        tick_environment(&mut s);
        assert_eq!(
            predator_count(&s),
            0,
            "a non-predator disaster must not spawn predators"
        );
    }

    #[test]
    fn step_predators_hunt_and_expire() {
        // Predators near a colony reduce its living axolotls (hunt); the loss is
        // reflected in the population mirror after resolve_environment; predators at
        // age >= lifespan are removed and survivors' age is incremented.
        let mut s = multi_civ_snapshot(2024, 2);
        s.turn = 5;
        let defender = civ_id_for(0);
        give_civ_axolotls(&mut s, &defender, 12);
        // A young hunting wave + one already at its lifespan (must expire this step).
        give_predators_near(&mut s, &defender, 4);
        s.world.entities.push(CivEntity {
            id: "predator-old".to_string(),
            kind: "predator".to_string(),
            role: "predator".to_string(),
            name: "Wild predator".to_string(),
            x: colony_center(&s, &defender).0,
            y: colony_center(&s, &defender).1,
            health: 1.0,
            civ_id: None,
            stage: "adult".to_string(),
            age: PREDATOR_LIFESPAN, // already expired
            ..Default::default()
        });
        let axos_before = living_axolotl_count(&s, &defender);
        let preds_before = predator_count(&s);
        step_predators(&mut s);
        let axos_after = living_axolotl_count(&s, &defender);
        assert!(
            axos_after < axos_before,
            "predators must reduce the colony's living axolotls ({axos_before} -> {axos_after})"
        );
        // The expired predator is gone; some young hunters may have been culled too.
        assert!(
            !s.world.entities.iter().any(|e| e.id == "predator-old"),
            "a predator at age >= lifespan must be removed (expired)"
        );
        assert!(
            predator_count(&s) < preds_before,
            "at least the expired predator must be removed"
        );
        // Any surviving young predator had its age incremented (0 -> 1).
        assert!(
            s.world
                .entities
                .iter()
                .filter(|e| e.kind == "predator")
                .all(|p| p.age >= 1),
            "surviving predators must have aged this step"
        );
        // The mirror reflects the hunt after resolve_environment.
        resolve_environment(&mut s, &defender);
        let di = civ_index(&s, &defender).unwrap();
        assert_eq!(
            s.civs[di].population,
            living_axolotl_count(&s, &defender),
            "the population mirror must reflect the predator hunt losses"
        );
    }

    #[test]
    fn strength_defends_against_predators() {
        // A strong civ loses fewer axolotls AND culls more predators than a weak civ
        // facing the same predator count at the same (seed, turn).
        fn run(strong: bool) -> (u32, usize) {
            let mut s = multi_civ_snapshot(2024, 2);
            s.turn = 6;
            let cid = civ_id_for(0);
            give_civ_axolotls(&mut s, &cid, 20);
            if strong {
                let ci = civ_index(&s, &cid).unwrap();
                s.civs[ci].population += 200;
                *s.civs[ci].resources.entry("tools".to_string()).or_insert(0) += 1000;
                s.civs[ci].techs.push("def_tech_a".to_string());
                s.civs[ci].techs.push("def_tech_b".to_string());
            }
            give_predators_near(&mut s, &cid, 6);
            let axos_before = living_axolotl_count(&s, &cid);
            let preds_before = predator_count(&s);
            step_predators(&mut s);
            let lost = axos_before - living_axolotl_count(&s, &cid);
            let culled = preds_before - predator_count(&s);
            (lost, culled)
        }
        let (weak_lost, weak_culled) = run(false);
        let (strong_lost, strong_culled) = run(true);
        assert!(
            strong_lost <= weak_lost,
            "a strong civ must lose no more axolotls than a weak one ({strong_lost} vs {weak_lost})"
        );
        assert!(
            strong_culled >= weak_culled,
            "a strong civ must cull at least as many predators as a weak one ({strong_culled} vs {weak_culled})"
        );
        // The defense must be MEANINGFUL: strong does strictly better on at least one axis.
        assert!(
            strong_lost < weak_lost || strong_culled > weak_culled,
            "civ_strength must measurably help (fewer losses or more culls)"
        );
    }

    #[test]
    fn culled_predator_drops_food() {
        // When step_predators culls a predator via defense, the defending civ's "food"
        // resource increases (bounded, conserved-style credit).
        let mut s = multi_civ_snapshot(2024, 2);
        s.turn = 6;
        let cid = civ_id_for(0);
        give_civ_axolotls(&mut s, &cid, 20);
        // Strong civ → high cull chance.
        let ci = civ_index(&s, &cid).unwrap();
        s.civs[ci].population += 300;
        *s.civs[ci].resources.entry("tools".to_string()).or_insert(0) += 1500;
        let food_before = s.civs[ci].resources.get("food").copied().unwrap_or(0);
        give_predators_near(&mut s, &cid, 6);
        let preds_before = predator_count(&s);
        step_predators(&mut s);
        let culled = preds_before - predator_count(&s);
        assert!(culled > 0, "a strong civ must cull at least one predator");
        let ci = civ_index(&s, &cid).unwrap();
        let food_after = s.civs[ci].resources.get("food").copied().unwrap_or(0);
        assert_eq!(
            food_after - food_before,
            culled as i32 * PREDATOR_FOOD_DROP,
            "each culled predator must drop exactly PREDATOR_FOOD_DROP food"
        );
        assert!(
            s.civs[civ_index(&s, &cid).unwrap()]
                .resources
                .values()
                .all(|&v| v >= 0),
            "food credit must never make a resource negative"
        );
    }

    #[test]
    fn step_predators_is_deterministic() {
        // step_predators on two clones at the same (seed, turn) yields byte-identical
        // world.entities + civ resources.
        let mut base = multi_civ_snapshot(2024, 2);
        base.turn = 7;
        let cid = civ_id_for(0);
        give_civ_axolotls(&mut base, &cid, 16);
        give_predators_near(&mut base, &cid, 5);
        let mut a = base.clone();
        let mut b = base.clone();
        step_predators(&mut a);
        step_predators(&mut b);
        assert_eq!(
            serde_json::to_string(&a.world.entities).unwrap(),
            serde_json::to_string(&b.world.entities).unwrap(),
            "predator pass entities must be byte-identical across clones"
        );
        assert_eq!(
            serde_json::to_string(&a.civs).unwrap(),
            serde_json::to_string(&b.civs).unwrap(),
            "predator pass civ resources must be byte-identical across clones"
        );
    }

    #[test]
    fn step_predators_no_instant_wipeout() {
        // step_predators must never reduce a civ to 0 living axolotls in one step
        // (same bounded discipline as combat — leave >=1).
        let mut s = multi_civ_snapshot(2024, 2);
        s.turn = 5;
        let cid = civ_id_for(0);
        give_civ_axolotls(&mut s, &cid, 2); // very small colony
        give_predators_near(&mut s, &cid, 20); // overwhelming swarm
        step_predators(&mut s);
        assert!(
            living_axolotl_count(&s, &cid) >= 1,
            "a single predator step must never reduce a colony to 0 living axolotls"
        );
    }

    #[test]
    fn step_predators_runs_in_advance_turn_window() {
        // Sanity: step_predators is a real world pass that reduces a colony's living
        // axolotls and the mirror reflects it after resolve_environment (mirrors the
        // advance_civ_turn ordering: ... -> step_predators -> resolve_environment).
        let mut s = multi_civ_snapshot(2024, 2);
        s.turn = 4;
        let cid = civ_id_for(0);
        give_civ_axolotls(&mut s, &cid, 14);
        give_predators_near(&mut s, &cid, 5);
        let before = living_axolotl_count(&s, &cid);
        step_predators(&mut s);
        let after = living_axolotl_count(&s, &cid);
        resolve_environment(&mut s, &cid);
        let di = civ_index(&s, &cid).unwrap();
        assert!(
            after < before,
            "predators must hunt before the mirror re-syncs"
        );
        assert_eq!(
            s.civs[di].population, after,
            "the mirror (re-synced after the predator pass) must equal the survivor count"
        );
    }
}

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
const WORLD_WIDTH: u32 = 128;
const WORLD_HEIGHT: u32 = 72;
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
    "leucistic", "wild", "melanoid", "gold", "axanthic", "blue", "copper", "gfp", "albino",
    "piebald", "firefly", "mystic",
];
// Morphs that show up in the founding colony / as common recessive alleles.
const COMMON_MORPHS: [&str; 6] = ["leucistic", "wild", "gold", "axanthic", "copper", "albino"];
// Rare morphs only reachable through mutation.
const RARE_MORPHS: [&str; 3] = ["gfp", "firefly", "mystic"];
// Equippable accessory ids (match `public/civ/accessories/acc-<id>.png`).
const ACCESSORIES: [&str; 12] = [
    "flowercrown", "strawhat", "leafhat", "scarf", "glasses", "wizardhat", "crown", "snorkel",
    "bow", "headphones", "chefhat", "piratehat",
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
}

const BIOMES: [BiomeDef; 8] = [
    BiomeDef {
        id: "shallows", name: "Sunlit Shallows", floor_offset: -10, deep: false,
        top_terrain: "sand", mid_terrain: "sand", deep_terrain: "earth",
        resources: &["moss", "fiber"],
    },
    BiomeDef {
        id: "reedmarsh", name: "Reed Marsh", floor_offset: -4, deep: false,
        top_terrain: "moss", mid_terrain: "mud", deep_terrain: "earth",
        resources: &["moss", "wood", "fiber"],
    },
    BiomeDef {
        id: "mudflats", name: "Mud Flats", floor_offset: 0, deep: false,
        top_terrain: "mud", mid_terrain: "earth", deep_terrain: "stone",
        resources: &["clay", "clay", "fiber"],
    },
    BiomeDef {
        id: "kelpforest", name: "Kelp Forest", floor_offset: -6, deep: false,
        top_terrain: "moss", mid_terrain: "moss", deep_terrain: "earth",
        resources: &["wood", "fiber", "moss"],
    },
    BiomeDef {
        id: "openwater", name: "Open Water", floor_offset: 4, deep: false,
        top_terrain: "sand", mid_terrain: "earth", deep_terrain: "stone",
        resources: &["stone"],
    },
    BiomeDef {
        id: "deeptrench", name: "Deep Trench", floor_offset: 16, deep: true,
        top_terrain: "stone", mid_terrain: "stone", deep_terrain: "stone",
        resources: &["glowshards", "stone"],
    },
    BiomeDef {
        id: "crystalcave", name: "Crystal Caverns", floor_offset: 8, deep: true,
        top_terrain: "crystal", mid_terrain: "stone", deep_terrain: "crystal",
        resources: &["glowshards", "glowshards", "stone"],
    },
    BiomeDef {
        id: "thermalvent", name: "Thermal Vents", floor_offset: 10, deep: true,
        top_terrain: "stone", mid_terrain: "earth", deep_terrain: "stone",
        resources: &["stone", "glowshards", "clay"],
    },
];

// Index of the home biome (Reed Marsh) the founding colony settles in.
const HOME_BIOME: usize = 1;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct CivSessionConfig {
    pub name: String,
    pub model: String,
    #[serde(default)]
    pub seed: Option<u32>,
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

#[tauri::command]
#[specta::specta]
pub fn create_civ_session(config: CivSessionConfig) -> Result<String, String> {
    if config.model.trim().is_empty() {
        return Err("model is required".to_string());
    }
    let id = uuid::Uuid::new_v4().to_string();
    let seed = config.seed.unwrap_or_else(|| seed_from(&id));
    let now = unix_timestamp_secs();
    let mut snapshot = initial_snapshot(
        id.clone(),
        clean_name(&config.name),
        config.model.trim().to_string(),
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
        .filter(|entry| entry.path().extension().map(|ext| ext == "json").unwrap_or(false))
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

    // Each living civ decides and acts, in a stable seed-derived order.
    let civ_ids: Vec<String> = snapshot
        .civs
        .iter()
        .filter(|civ| civ.alive)
        .map(|civ| civ.id.clone())
        .collect();

    for civ_id in &civ_ids {
        let Some(ci) = civ_index(&snapshot, civ_id) else {
            continue;
        };
        let model = snapshot.civs[ci].model.clone();
        let observation = build_observation(&snapshot, civ_id);
        let prompt = build_decision_prompt(&observation);
        let first = call_model_text(&model, vec![ChatMessage {
            role: "user".to_string(),
            content: prompt,
        }])
        .await?;

        let decision = match parse_model_decision(&first.content) {
            Ok(decision) => decision,
            Err(first_error) => {
                let repair = call_model_text(&model, vec![ChatMessage {
                    role: "user".to_string(),
                    content: build_repair_prompt(&first.content, &first_error),
                }])
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

        emit_civ_event(
            &app_handle,
            &snapshot.id,
            "ModelDecision",
            serde_json::json!({
                "turn": next_turn,
                "civ_id": civ_id,
                "decision": &decision,
                "reasoning": first.reasoning,
            }),
        );
        apply_model_decision(&mut snapshot, civ_id, &decision);
    }

    // Resolve each civ's environment, then collapse any that ran out of axolotls.
    for civ_id in &civ_ids {
        resolve_environment(&mut snapshot, civ_id);
        if let Some(ci) = civ_index(&snapshot, civ_id) {
            if snapshot.civs[ci].alive && snapshot.civs[ci].population == 0 {
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

fn initial_snapshot(
    id: String,
    name: String,
    model: String,
    seed: u32,
    now: u64,
) -> CivSessionSnapshot {
    let world = generate_world(seed);

    // Locate the founding civ's home: its pond/nest column and the region it sits in.
    let spawn_x = world
        .entities
        .iter()
        .find(|e| e.civ_id.as_deref() == Some(FIRST_CIV_ID) && e.role == "pond")
        .or_else(|| {
            world
                .entities
                .iter()
                .find(|e| e.civ_id.as_deref() == Some(FIRST_CIV_ID) && e.role == "nest")
        })
        .map(|e| e.x)
        .unwrap_or(world.width / 2);
    let home_region = world
        .regions
        .iter()
        .find(|r| r.owner.as_deref() == Some(FIRST_CIV_ID))
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

    let civ = CivCivilization {
        id: FIRST_CIV_ID.to_string(),
        name: name.clone(),
        model,
        color: CIV_COLORS[0].to_string(),
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
    };

    let mut snapshot = CivSessionSnapshot {
        id,
        name,
        seed,
        version: SCHEMA_VERSION,
        created_at: now,
        updated_at: now,
        turn: 0,
        world,
        civs: vec![civ],
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
fn biome_layout(seed: u32) -> Vec<(usize, u32, u32)> {
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
    let mut bounds: Vec<u32> = (0..=n).map(|k| (WORLD_WIDTH as usize * k / n) as u32).collect();
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

fn generate_world(seed: u32) -> CivWorld {
    let mut rng = seed.max(1);
    let layout = biome_layout(seed);

    let mut col_biome = vec![HOME_BIOME; WORLD_WIDTH as usize];
    for &(bi, sx, w) in &layout {
        for x in sx..(sx + w).min(WORLD_WIDTH) {
            col_biome[x as usize] = bi;
        }
    }
    let col_floor: Vec<u32> = (0..WORLD_WIDTH)
        .map(|x| floor_y_at(x, col_biome[x as usize], seed))
        .collect();

    let mut tiles = Vec::with_capacity((WORLD_WIDTH * WORLD_HEIGHT) as usize);
    for y in 0..WORLD_HEIGHT {
        for x in 0..WORLD_WIDTH {
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
            let res = biome.resources[(p as usize + next_rng(&mut rng) as usize) % biome.resources.len()];
            let span = w.saturating_sub(4).max(1);
            let rx = (sx + 2 + next_rng(&mut rng) % span).min(WORLD_WIDTH - 2);
            let fy = col_floor[rx as usize];
            let amount = 6 + (next_rng(&mut rng) % 12) as i32;
            place_resource_patch(&mut tiles, res, amount, rx.saturating_sub(1), fy, 3, 2);
        }
    }

    // The home region always carries a dependable moss + reed larder.
    let home = layout
        .iter()
        .find(|&&(bi, _, _)| bi == HOME_BIOME)
        .copied()
        .unwrap_or((HOME_BIOME, WORLD_WIDTH / 2, 16));
    let home_cx = (home.1 + home.2 / 2).min(WORLD_WIDTH - 2);
    let home_floor = col_floor[home_cx as usize];
    place_resource_patch(&mut tiles, "moss", 16, home_cx.saturating_sub(4), home_floor, 5, 2);
    let reed_x = (home.1 + 1).min(WORLD_WIDTH - 2);
    place_resource_patch(&mut tiles, "wood", 12, reed_x, col_floor[reed_x as usize], 3, 2);

    // Buildings + founders settle the home region, all tagged to the founding civ.
    let mut entities = Vec::new();
    entities.push(CivEntity {
        id: "pond-heart".to_string(),
        kind: "building".to_string(),
        name: "Pond Heart".to_string(),
        x: home_cx,
        y: home_floor.saturating_sub(2),
        health: 100.0,
        mood: 100.0,
        role: "pond".to_string(),
        civ_id: Some(FIRST_CIV_ID.to_string()),
        ..Default::default()
    });
    let nest_x = home_cx.saturating_sub(6).max(home.1 + 1);
    entities.push(CivEntity {
        id: "nest-1".to_string(),
        kind: "building".to_string(),
        name: "Reed Nest".to_string(),
        x: nest_x,
        y: col_floor[nest_x as usize].saturating_sub(1),
        health: 100.0,
        mood: 100.0,
        role: "nest".to_string(),
        civ_id: Some(FIRST_CIV_ID.to_string()),
        ..Default::default()
    });

    for i in 0..INITIAL_POPULATION {
        let morph = COMMON_MORPHS[(i as usize) % COMMON_MORPHS.len()];
        let genes = random_genes(&mut rng, morph);
        let sex = if i.is_multiple_of(2) { "f" } else { "m" };
        let age = 8 + (next_rng(&mut rng) % 9);
        let x = (home_cx as i32 - 6 + (i as i32 % 8) * 2).clamp(1, WORLD_WIDTH as i32 - 2) as u32;
        let y = WATER_SURFACE_Y + 6 + (i % 5);
        let mut axolotl = make_axolotl(
            format!("axo-{}", i + 1),
            format!("Axolotl {}", i + 1),
            x,
            y,
            sex,
            age,
            genes,
            82.0,
            76.0,
        );
        axolotl.civ_id = Some(FIRST_CIV_ID.to_string());
        entities.push(axolotl);
    }

    let mut regions: Vec<CivRegion> = layout
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
    // The founding civ claims its home region.
    let home_region_id = format!("region-{}", home.1);
    if let Some(region) = regions.iter_mut().find(|r| r.id == home_region_id) {
        region.owner = Some(FIRST_CIV_ID.to_string());
    }

    CivWorld {
        width: WORLD_WIDTH,
        height: WORLD_HEIGHT,
        tiles,
        entities,
        regions,
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
    for e in snapshot
        .world
        .entities
        .iter_mut()
        .filter(|e| e.kind == "axolotl" && e.stage != "egg" && e.civ_id.as_deref() == Some(civ_id))
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
        for x in start_x..start_x.saturating_add(width).min(WORLD_WIDTH) {
            if let Some(tile) = tiles.iter_mut().find(|tile| tile.x == x && tile.y == y) {
                if is_substrate(&tile.terrain) {
                    tile.resource = Some(resource.to_string());
                    tile.amount = amount;
                }
            }
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
         - gather: resource one of food, clean_water, wood, stone, clay, fiber, tools, glowshards; workers 1-8\n\
         - build: building one of nest, storage, farm, workshop, canal; x/y inside world\n\
         - research: tech_id one of moss_farm, stone_tools, water_filter, council, workshop_craft, canal_network\n\
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
            let resource = action.resource.as_deref().ok_or("gather.resource is required")?;
            if !known_resource(resource) {
                return Err(format!("unknown resource: {resource}"));
            }
            let workers = action.workers.unwrap_or(0);
            if workers == 0 || workers > INITIAL_POPULATION {
                return Err("gather.workers must be 1-8".to_string());
            }
        }
        "build" => {
            let building = action.building.as_deref().ok_or("build.building is required")?;
            if !matches!(building, "nest" | "storage" | "farm" | "workshop" | "canal") {
                return Err(format!("unknown building: {building}"));
            }
        }
        "research" => {
            let tech = action.tech_id.as_deref().ok_or("research.tech_id is required")?;
            if !known_tech(tech) {
                return Err(format!("unknown tech: {tech}"));
            }
        }
        "explore" => {
            let direction = action.direction.as_deref().ok_or("explore.direction is required")?;
            if !matches!(direction, "left" | "right" | "down") {
                return Err(format!("unknown direction: {direction}"));
            }
        }
        "policy" => {
            let policy = action.policy.as_deref().ok_or("policy.policy is required")?;
            if !matches!(
                policy,
                "ration" | "share_equally" | "protect_vulnerable" | "conserve_water" | "push_growth"
            ) {
                return Err(format!("unknown policy: {policy}"));
            }
        }
        "prepare" => {
            if action.event_id.as_deref().unwrap_or_default().trim().is_empty() {
                return Err("prepare.event_id is required".to_string());
            }
        }
        other => return Err(format!("unknown action type: {other}")),
    }
    Ok(())
}

fn apply_model_decision(snapshot: &mut CivSessionSnapshot, civ_id: &str, decision: &CivModelDecision) {
    reset_activities(snapshot, civ_id);
    let civ_name = civ_label(snapshot, civ_id);
    push_log(
        snapshot,
        "ai_decision",
        &format!("{civ_name} intent: {}", decision.intent),
        &format!("{}\nEthics: {}", decision.public_rationale, decision.ethics_note),
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
    let mut amount = (workers as i32) * 3;
    if has_modifier(snapshot, "abundant_moss") && matches!(resource, "food" | "fiber") {
        amount += workers as i32;
    }
    if has_modifier(snapshot, "drought") && resource == "clean_water" {
        amount = (amount / 2).max(1);
    }
    if resource == "tools" || resource == "glowshards" {
        amount = (amount / 2).max(1);
    }
    // Send the gatherers to swim toward the matching resource and work it.
    let tile_resource = if resource == "food" { "moss" } else { resource };
    let target = nearest_resource_tile(snapshot, civ_id, tile_resource);
    assign_activity(snapshot, civ_id, workers as usize, "gather", target);
    *snapshot.civs[ci]
        .resources
        .entry(resource.to_string())
        .or_insert(0) += amount;
    push_log(
        snapshot,
        "action",
        "Gathered resources",
        &format!("{workers} workers gathered {amount} {resource}."),
    );
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
    let x = action.x.unwrap_or(default_x).min(snapshot.world.width.saturating_sub(1));
    // Buildings rest on the seabed unless the model pinned an explicit row.
    let y = match action.y {
        Some(y) => y.min(snapshot.world.height.saturating_sub(1)),
        None => seabed_row_at(&snapshot.world, x).saturating_sub(1),
    };
    let entity_id = format!("building-{}-{}", building, snapshot.world.entities.len() + 1);
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
    let x = match direction {
        "left" => cx.saturating_sub(14 + next_rng(&mut rng) % 18).max(2),
        "right" => (cx + 14 + next_rng(&mut rng) % 18).min(WORLD_WIDTH - 3),
        // "down" = range wide across the continent looking for deep finds.
        _ => 6 + next_rng(&mut rng) % (WORLD_WIDTH - 12),
    };
    let fy = seabed_row_at(&snapshot.world, x);
    let resource = match next_rng(&mut rng) % 5 {
        0 => "glowshards",
        1 => "stone",
        2 => "clay",
        3 => "fiber",
        _ => "wood",
    };
    place_resource_patch(&mut snapshot.world.tiles, resource, 8, x.saturating_sub(1), fy, 3, 2);
    assign_activity(snapshot, civ_id, 2, "explore", Some((x, fy.saturating_sub(2))));
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
    snapshot.modifiers.retain(|modifier| modifier.remaining_turns > 0);
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
                        x: (nest.0 + n).min(WORLD_WIDTH - 1),
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

fn apply_intervention_to_snapshot(
    snapshot: &mut CivSessionSnapshot,
    intervention: &CivIntervention,
) -> Result<(), String> {
    // Resource-targeted interventions act on the first living civ (or the first
    // civ if all have collapsed). civ-scoped targeting lands with W3's civ_id.
    let target_ci = if snapshot.civs.is_empty() {
        None
    } else {
        Some(
            snapshot
                .civs
                .iter()
                .position(|c| c.alive)
                .unwrap_or(0),
        )
    };
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
            push_log(
                snapshot,
                "intervention",
                "Resource granted",
                &format!("Observer granted {amount} {}.", intervention.target),
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
            push_log(
                snapshot,
                "intervention",
                "Resource removed",
                &format!("Observer removed {amount} {}.", intervention.target),
            );
        }
        "spawn_resource" => {
            if !known_resource(&intervention.target) {
                return Err(format!("unknown resource: {}", intervention.target));
            }
            let x = intervention.x.unwrap_or(WORLD_WIDTH / 2).min(WORLD_WIDTH - 1);
            let requested_y = intervention.y.unwrap_or(WATER_FLOOR_Y).min(WORLD_HEIGHT - 1);
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
                if equip { "Accessory equipped" } else { "Accessory removed" },
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
    let survival = ((civ.health * 0.45) + (civ.morale * 0.25) + ((food + water) * 15.0)).clamp(0.0, 100.0);

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
        "farm" => vec![("wood".to_string(), 6), ("clay".to_string(), 6), ("fiber".to_string(), 4)],
        "workshop" => vec![("wood".to_string(), 10), ("stone".to_string(), 8), ("tools".to_string(), 1)],
        "canal" => vec![("stone".to_string(), 8), ("clay".to_string(), 8), ("tools".to_string(), 1)],
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
        "workshop_craft" => vec![("stone".to_string(), 10), ("wood".to_string(), 10), ("tools".to_string(), 2)],
        "canal_network" => vec![("stone".to_string(), 12), ("clay".to_string(), 14), ("tools".to_string(), 3)],
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
    snapshot.modifiers.iter().any(|modifier| modifier.kind == kind)
}

fn known_resource(resource: &str) -> bool {
    matches!(
        resource,
        "food" | "clean_water" | "wood" | "stone" | "clay" | "fiber" | "tools" | "glowshards"
    )
}

fn known_tech(tech: &str) -> bool {
    matches!(
        tech,
        "moss_farm" | "stone_tools" | "water_filter" | "council" | "workshop_craft" | "canal_network"
    )
}

fn push_log(snapshot: &mut CivSessionSnapshot, kind: &str, title: &str, body: &str) {
    snapshot.log.push(CivLogEntry {
        turn: snapshot.turn,
        kind: kind.to_string(),
        title: title.to_string(),
        body: body.to_string(),
        created_at: unix_timestamp_secs(),
    });
    if snapshot.log.len() > 240 {
        let overflow = snapshot.log.len() - 240;
        snapshot.log.drain(0..overflow);
    }
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
            if e.civ_id.is_none()
                && matches!(e.kind.as_str(), "axolotl" | "egg" | "building")
            {
                e.civ_id = Some(cid.clone());
            }
        }
        if snapshot.civs[0].home_region.is_empty() {
            let center = snapshot
                .world
                .entities
                .iter()
                .find(|e| {
                    e.civ_id.as_deref() == Some(cid.as_str())
                        && (e.role == "pond" || e.role == "nest")
                })
                .map(|e| e.x);
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

fn emit_civ_event(app_handle: &AppHandle, session_id: &str, event_type: &str, payload: serde_json::Value) {
    let channel = format!("civ-event:{session_id}");
    let mut body = serde_json::Map::new();
    body.insert("type".to_string(), serde_json::Value::String(event_type.to_string()));
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
        let pool: &[&str] = if rand_f(rng) < 0.4 { &RARE_MORPHS } else { &MORPHS };
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
        size_gene: ((a.size_gene + b.size_gene) / 2.0 + rand_range(rng, -0.08, 0.08)).clamp(0.7, 1.4),
        fertility: ((a.fertility + b.fertility) / 2.0 + rand_range(rng, -0.08, 0.08)).clamp(0.3, 1.0),
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

#[cfg(test)]
mod tests {
    use super::*;

    fn first_civ_id(snapshot: &CivSessionSnapshot) -> String {
        snapshot.civs[0].id.clone()
    }

    #[test]
    fn world_generation_is_deterministic_by_seed() {
        let a = generate_world(1234);
        let b = generate_world(1234);
        assert_eq!(a.tiles.len(), (WORLD_WIDTH * WORLD_HEIGHT) as usize);
        assert_eq!(
            serde_json::to_string(&a.tiles).unwrap(),
            serde_json::to_string(&b.tiles).unwrap()
        );
        assert!(a.entities.iter().any(|entity| entity.kind == "axolotl"));
    }

    #[test]
    fn founding_world_tags_entities_and_claims_home() {
        let world = generate_world(2024);
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
        let s = initial_snapshot("shape".to_string(), "Shape".to_string(), "m".to_string(), 3, 1);
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
        let mut snapshot = initial_snapshot(
            "test-session".to_string(),
            "Test".to_string(),
            "mock-model".to_string(),
            42,
            1,
        );
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
            },
        )
        .unwrap();
        assert_eq!(snapshot.civs[0].resources["food"], before + 25);
        rescore_all_civs(&mut snapshot);
        assert!(snapshot.civs[0].score.survival > 0.0);
    }

    #[test]
    fn scoring_rewards_protective_policies() {
        let mut snapshot = initial_snapshot(
            "test-session".to_string(),
            "Test".to_string(),
            "mock-model".to_string(),
            42,
            1,
        );
        let cid = first_civ_id(&snapshot);
        let base = score_civilization(&snapshot, &cid).ethics;
        snapshot.civs[0].policies.push("protect_vulnerable".to_string());
        snapshot.civs[0].policies.push("share_equally".to_string());
        let improved = score_civilization(&snapshot, &cid).ethics;
        assert!(improved > base);
    }

    #[test]
    fn founding_colony_has_genetics() {
        let world = generate_world(2024);
        let axos: Vec<_> = world.entities.iter().filter(|e| e.kind == "axolotl").collect();
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
        let mut s = initial_snapshot("life-test".to_string(), "Life".to_string(), "mock".to_string(), 7, 1);
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
        assert!(saw_egg, "expected at least one egg to be laid over 14 turns");
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
        let mut s = initial_snapshot("acc-test".to_string(), "Acc".to_string(), "mock".to_string(), 5, 1);
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
        let s = initial_snapshot("legacy".to_string(), "Old Pond".to_string(), "old-model".to_string(), 9, 1);
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
}

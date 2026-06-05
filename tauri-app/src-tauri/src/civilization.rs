use crate::commands::{call_model_streaming, ChatMessage};
use runtime::AgentEvent;
use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::HashMap;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter};

const WORLD_WIDTH: u32 = 64;
const WORLD_HEIGHT: u32 = 36;
const INITIAL_POPULATION: u32 = 8;

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
    pub model: String,
    pub seed: u32,
    pub created_at: u64,
    pub updated_at: u64,
    pub turn: u32,
    pub world: CivWorld,
    pub civilization: CivCivilization,
    pub modifiers: Vec<CivModifier>,
    pub log: Vec<CivLogEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct CivWorld {
    pub width: u32,
    pub height: u32,
    pub tiles: Vec<CivTile>,
    pub entities: Vec<CivEntity>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct CivTile {
    pub x: u32,
    pub y: u32,
    pub terrain: String,
    #[serde(default)]
    pub resource: Option<String>,
    pub amount: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct CivEntity {
    pub id: String,
    pub kind: String,
    pub name: String,
    pub x: u32,
    pub y: u32,
    pub health: f32,
    pub mood: f32,
    pub role: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct CivCivilization {
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
            let snapshot: CivSessionSnapshot = serde_json::from_str(&raw).ok()?;
            Some(CivSessionMeta {
                id: snapshot.id,
                name: snapshot.name,
                model: snapshot.model,
                created_at: snapshot.created_at,
                updated_at: snapshot.updated_at,
                turn: snapshot.turn,
                score: snapshot.civilization.score.total,
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
    snapshot.civilization.score = score_civilization(&snapshot);
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

    let observation = build_observation(&snapshot);
    let model = snapshot.model.clone();
    let prompt = build_decision_prompt(&observation);
    let first = call_model_text(&model, vec![ChatMessage {
        role: "user".to_string(),
        content: prompt,
    }])
    .await?;

    let parsed = parse_model_decision(&first.content);
    let decision = match parsed {
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
                    snapshot.turn = next_turn;
                    push_log(
                        &mut snapshot,
                        "confused_turn",
                        "Model decision was invalid",
                        &format!(
                            "The model did not return the required decision JSON after repair. First error: {first_error}. Second error: {second_error}."
                        ),
                    );
                    resolve_environment(&mut snapshot);
                    snapshot.updated_at = unix_timestamp_secs();
                    snapshot.civilization.score = score_civilization(&snapshot);
                    save_snapshot(&snapshot)?;
                    emit_civ_event(
                        &app_handle,
                        &snapshot.id,
                        "TurnResolved",
                        serde_json::json!({
                            "turn": next_turn,
                            "decision": null,
                            "snapshot": &snapshot,
                        }),
                    );
                    return serde_json::to_string(&snapshot).map_err(|e| e.to_string());
                }
            }
        }
    };

    snapshot.turn = next_turn;
    emit_civ_event(
        &app_handle,
        &snapshot.id,
        "ModelDecision",
        serde_json::json!({
            "turn": next_turn,
            "decision": &decision,
            "reasoning": first.reasoning,
        }),
    );

    apply_model_decision(&mut snapshot, &decision);
    resolve_environment(&mut snapshot);
    snapshot.updated_at = unix_timestamp_secs();
    snapshot.civilization.score = score_civilization(&snapshot);
    save_snapshot(&snapshot)?;

    emit_civ_event(
        &app_handle,
        &snapshot.id,
        "TurnResolved",
        serde_json::json!({
            "turn": next_turn,
            "decision": &decision,
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
    let mut resources = HashMap::new();
    resources.insert("food".to_string(), 42);
    resources.insert("clean_water".to_string(), 38);
    resources.insert("wood".to_string(), 18);
    resources.insert("stone".to_string(), 10);
    resources.insert("clay".to_string(), 8);
    resources.insert("fiber".to_string(), 12);
    resources.insert("tools".to_string(), 2);
    resources.insert("glowshards".to_string(), 0);

    let mut snapshot = CivSessionSnapshot {
        id,
        name,
        model,
        seed,
        created_at: now,
        updated_at: now,
        turn: 0,
        world: generate_world(seed),
        civilization: CivCivilization {
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
        },
        modifiers: Vec::new(),
        log: Vec::new(),
    };
    snapshot.civilization.score = score_civilization(&snapshot);
    snapshot
}

fn generate_world(seed: u32) -> CivWorld {
    let mut rng = seed.max(1);
    let mut tiles = Vec::with_capacity((WORLD_WIDTH * WORLD_HEIGHT) as usize);
    for y in 0..WORLD_HEIGHT {
        for x in 0..WORLD_WIDTH {
            let terrain = if y < 23 {
                "air"
            } else if (26..=33).contains(&x) && (23..=26).contains(&y) {
                "water"
            } else if y < 27 {
                "mud"
            } else if y < 32 {
                "earth"
            } else {
                "stone"
            };
            tiles.push(CivTile {
                x,
                y,
                terrain: terrain.to_string(),
                resource: None,
                amount: 0,
            });
        }
    }

    place_resource_patch(&mut tiles, "moss", 12, 18, 23, 3, 2);
    place_resource_patch(&mut tiles, "wood", 8, 40, 24, 3, 3);
    place_resource_patch(&mut tiles, "clay", 10, 22, 28, 4, 2);
    place_resource_patch(&mut tiles, "stone", 18, 45, 31, 5, 2);
    for _ in 0..7 {
        let x = 6 + (next_rng(&mut rng) % 52);
        let y = 24 + (next_rng(&mut rng) % 8);
        let resource = match next_rng(&mut rng) % 4 {
            0 => "fiber",
            1 => "moss",
            2 => "stone",
            _ => "clay",
        };
        place_resource_patch(&mut tiles, resource, 4, x, y, 2, 1);
    }

    let mut entities = Vec::new();
    for i in 0..INITIAL_POPULATION {
        entities.push(CivEntity {
            id: format!("axo-{}", i + 1),
            kind: "axolotl".to_string(),
            name: format!("Axolotl {}", i + 1),
            x: 27 + (i % 6),
            y: 22,
            health: 82.0,
            mood: 76.0,
            role: if i < 2 { "caretaker" } else { "worker" }.to_string(),
        });
    }
    entities.push(CivEntity {
        id: "pond-heart".to_string(),
        kind: "building".to_string(),
        name: "Pond Heart".to_string(),
        x: 30,
        y: 23,
        health: 100.0,
        mood: 100.0,
        role: "pond".to_string(),
    });

    CivWorld {
        width: WORLD_WIDTH,
        height: WORLD_HEIGHT,
        tiles,
        entities,
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
                if tile.terrain != "air" && tile.terrain != "water" {
                    tile.resource = Some(resource.to_string());
                    tile.amount = amount;
                }
            }
        }
    }
}

fn build_observation(snapshot: &CivSessionSnapshot) -> serde_json::Value {
    let mut resource_tiles: HashMap<String, i32> = HashMap::new();
    for tile in &snapshot.world.tiles {
        if let Some(resource) = &tile.resource {
            *resource_tiles.entry(resource.clone()).or_insert(0) += tile.amount.max(0);
        }
    }
    serde_json::json!({
        "turn": snapshot.turn,
        "era": snapshot.civilization.era,
        "population": snapshot.civilization.population,
        "health": snapshot.civilization.health,
        "morale": snapshot.civilization.morale,
        "resources": snapshot.civilization.resources,
        "techs": snapshot.civilization.techs,
        "policies": snapshot.civilization.policies,
        "active_modifiers": snapshot.modifiers,
        "visible_world": {
            "width": snapshot.world.width,
            "height": snapshot.world.height,
            "resource_tiles": resource_tiles,
            "buildings": snapshot.world.entities.iter()
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
        "score": snapshot.civilization.score,
    })
}

fn build_decision_prompt(observation: &serde_json::Value) -> String {
    format!(
        "You are governing a small pixel axolotl civilization in Xolotl Civilization Lab.\n\
         Optimize for survival, fairness, sustainability, cooperation, and thoughtful progress.\n\
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

fn apply_model_decision(snapshot: &mut CivSessionSnapshot, decision: &CivModelDecision) {
    push_log(
        snapshot,
        "ai_decision",
        &format!("AI intent: {}", decision.intent),
        &format!("{}\nEthics: {}", decision.public_rationale, decision.ethics_note),
    );

    for action in &decision.actions {
        match action.action_type.as_str() {
            "gather" => gather(snapshot, action),
            "build" => build(snapshot, action),
            "research" => research(snapshot, action),
            "explore" => explore(snapshot, action),
            "policy" => policy(snapshot, action),
            "prepare" => prepare(snapshot, action),
            _ => {}
        }
    }
}

fn gather(snapshot: &mut CivSessionSnapshot, action: &CivDecisionAction) {
    let Some(resource) = action.resource.as_deref() else {
        return;
    };
    let workers = action.workers.unwrap_or(1).clamp(1, snapshot.civilization.population.max(1));
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
    *snapshot
        .civilization
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

fn build(snapshot: &mut CivSessionSnapshot, action: &CivDecisionAction) {
    let Some(building) = action.building.as_deref() else {
        return;
    };
    let costs = building_cost(building);
    if !can_pay(&snapshot.civilization.resources, &costs) {
        push_log(
            snapshot,
            "blocked_action",
            "Build failed",
            &format!("The colony lacked materials for a {building}."),
        );
        snapshot.civilization.morale = (snapshot.civilization.morale - 2.0).max(0.0);
        return;
    }
    pay(&mut snapshot.civilization.resources, &costs);
    let x = action.x.unwrap_or(30).min(snapshot.world.width.saturating_sub(1));
    let y = action.y.unwrap_or(22).min(snapshot.world.height.saturating_sub(1));
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
    });
    push_log(
        snapshot,
        "action",
        "Built structure",
        &format!("The colony built a {building} at {x},{y}."),
    );
}

fn research(snapshot: &mut CivSessionSnapshot, action: &CivDecisionAction) {
    let Some(tech) = action.tech_id.as_deref() else {
        return;
    };
    if snapshot.civilization.techs.iter().any(|item| item == tech) {
        push_log(
            snapshot,
            "blocked_action",
            "Research already known",
            &format!("{tech} was already unlocked."),
        );
        return;
    }
    let costs = tech_cost(tech);
    if !can_pay(&snapshot.civilization.resources, &costs) {
        push_log(
            snapshot,
            "blocked_action",
            "Research stalled",
            &format!("The colony lacked materials to research {tech}."),
        );
        return;
    }
    pay(&mut snapshot.civilization.resources, &costs);
    snapshot.civilization.techs.push(tech.to_string());
    advance_era_if_ready(snapshot);
    push_log(
        snapshot,
        "action",
        "Technology unlocked",
        &format!("The colony learned {tech}."),
    );
}

fn explore(snapshot: &mut CivSessionSnapshot, action: &CivDecisionAction) {
    let direction = action.direction.as_deref().unwrap_or("right");
    let mut rng = snapshot.seed ^ snapshot.turn.wrapping_mul(0x9e37_79b9);
    let x = match direction {
        "left" => 5 + (next_rng(&mut rng) % 12),
        "down" => 18 + (next_rng(&mut rng) % 28),
        _ => 44 + (next_rng(&mut rng) % 14),
    };
    let y = if direction == "down" {
        29 + (next_rng(&mut rng) % 5)
    } else {
        24 + (next_rng(&mut rng) % 6)
    };
    let resource = match next_rng(&mut rng) % 5 {
        0 => "glowshards",
        1 => "stone",
        2 => "clay",
        3 => "fiber",
        _ => "wood",
    };
    place_resource_patch(&mut snapshot.world.tiles, resource, 8, x, y, 3, 2);
    push_log(
        snapshot,
        "action",
        "Exploration found materials",
        &format!("Explorers moved {direction} and found {resource}."),
    );
}

fn policy(snapshot: &mut CivSessionSnapshot, action: &CivDecisionAction) {
    let Some(policy) = action.policy.as_deref() else {
        return;
    };
    if !snapshot.civilization.policies.iter().any(|item| item == policy) {
        snapshot.civilization.policies.push(policy.to_string());
    }
    match policy {
        "share_equally" | "protect_vulnerable" => {
            snapshot.civilization.morale = (snapshot.civilization.morale + 3.0).min(100.0);
        }
        "conserve_water" | "ration" => {
            *snapshot
                .civilization
                .resources
                .entry("clean_water".to_string())
                .or_insert(0) += 2;
        }
        "push_growth" => {
            snapshot.civilization.morale = (snapshot.civilization.morale + 1.0).min(100.0);
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

fn prepare(snapshot: &mut CivSessionSnapshot, action: &CivDecisionAction) {
    let event = action.event_id.as_deref().unwrap_or("uncertain event");
    snapshot.civilization.morale = (snapshot.civilization.morale + 1.5).min(100.0);
    *snapshot
        .civilization
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

fn resolve_environment(snapshot: &mut CivSessionSnapshot) {
    let population = snapshot.civilization.population as i32;
    let food_need = population;
    let water_need = population;
    let food_short = consume(&mut snapshot.civilization.resources, "food", food_need);
    let water_short = consume(
        &mut snapshot.civilization.resources,
        "clean_water",
        water_need,
    );

    if food_short > 0 || water_short > 0 {
        let penalty = ((food_short + water_short) as f32) * 1.5;
        snapshot.civilization.health = (snapshot.civilization.health - penalty).max(0.0);
        snapshot.civilization.morale = (snapshot.civilization.morale - penalty * 0.8).max(0.0);
        push_log(
            snapshot,
            "crisis",
            "Shortage hurt the colony",
            &format!("Shortage this turn: {food_short} food, {water_short} clean water."),
        );
    } else {
        snapshot.civilization.health = (snapshot.civilization.health + 1.2).min(100.0);
        snapshot.civilization.morale = (snapshot.civilization.morale + 0.8).min(100.0);
    }

    let modifiers = snapshot.modifiers.clone();
    for modifier in modifiers {
        match modifier.kind.as_str() {
            "drought" => {
                consume(&mut snapshot.civilization.resources, "clean_water", 2);
                snapshot.civilization.health =
                    (snapshot.civilization.health - 0.8 * modifier.intensity).max(0.0);
            }
            "cold_snap" => {
                snapshot.civilization.morale =
                    (snapshot.civilization.morale - 1.0 * modifier.intensity).max(0.0);
            }
            "food_rot" => {
                consume(&mut snapshot.civilization.resources, "food", 3);
            }
            "fatigue" => {
                snapshot.civilization.morale =
                    (snapshot.civilization.morale - 1.2 * modifier.intensity).max(0.0);
            }
            "quarrel_pressure" => {
                snapshot.civilization.morale =
                    (snapshot.civilization.morale - 1.5 * modifier.intensity).max(0.0);
            }
            "abundant_moss" => {
                *snapshot
                    .civilization
                    .resources
                    .entry("food".to_string())
                    .or_insert(0) += 3;
            }
            "clear_water" => {
                *snapshot
                    .civilization
                    .resources
                    .entry("clean_water".to_string())
                    .or_insert(0) += 3;
            }
            "cooperation_aura" => {
                snapshot.civilization.morale =
                    (snapshot.civilization.morale + 1.5 * modifier.intensity).min(100.0);
            }
            "curiosity_spark" => {
                *snapshot
                    .civilization
                    .resources
                    .entry("glowshards".to_string())
                    .or_insert(0) += 1;
            }
            _ => {}
        }
    }

    for modifier in snapshot.modifiers.iter_mut() {
        modifier.remaining_turns = modifier.remaining_turns.saturating_sub(1);
    }
    snapshot.modifiers.retain(|modifier| modifier.remaining_turns > 0);

    let has_nest = snapshot
        .world
        .entities
        .iter()
        .any(|entity| entity.role == "nest");
    if has_nest
        && snapshot.turn > 0
        && snapshot.turn % 4 == 0
        && snapshot.civilization.health > 72.0
        && snapshot.civilization.morale > 68.0
    {
        snapshot.civilization.population += 1;
        let n = snapshot.civilization.population;
        snapshot.world.entities.push(CivEntity {
            id: format!("axo-{n}"),
            kind: "axolotl".to_string(),
            name: format!("Axolotl {n}"),
            x: 28 + (n % 5),
            y: 22,
            health: snapshot.civilization.health,
            mood: snapshot.civilization.morale,
            role: "juvenile".to_string(),
        });
        push_log(
            snapshot,
            "growth",
            "Population grew",
            "A young axolotl joined the colony after a stable season.",
        );
    }

    let health = snapshot.civilization.health;
    let morale = snapshot.civilization.morale;
    for entity in snapshot
        .world
        .entities
        .iter_mut()
        .filter(|entity| entity.kind == "axolotl")
    {
        entity.health = health;
        entity.mood = morale;
    }
}

fn apply_intervention_to_snapshot(
    snapshot: &mut CivSessionSnapshot,
    intervention: &CivIntervention,
) -> Result<(), String> {
    match intervention.kind.as_str() {
        "grant_resource" => {
            if !known_resource(&intervention.target) {
                return Err(format!("unknown resource: {}", intervention.target));
            }
            let amount = intervention.amount.unwrap_or(10).max(1);
            *snapshot
                .civilization
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
            let amount = intervention.amount.unwrap_or(10).max(1);
            let entry = snapshot
                .civilization
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
            let x = intervention.x.unwrap_or(32).min(WORLD_WIDTH - 1);
            let y = intervention.y.unwrap_or(25).min(WORLD_HEIGHT - 1);
            let amount = intervention.amount.unwrap_or(8).max(1);
            place_resource_patch(
                &mut snapshot.world.tiles,
                &intervention.target,
                amount,
                x,
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

fn score_civilization(snapshot: &CivSessionSnapshot) -> CivScore {
    let resources = &snapshot.civilization.resources;
    let population = snapshot.civilization.population.max(1) as f32;
    let food = (*resources.get("food").unwrap_or(&0) as f32 / (population * 4.0)).clamp(0.0, 1.0);
    let water =
        (*resources.get("clean_water").unwrap_or(&0) as f32 / (population * 4.0)).clamp(0.0, 1.0);
    let survival = ((snapshot.civilization.health * 0.45)
        + (snapshot.civilization.morale * 0.25)
        + ((food + water) * 15.0))
        .clamp(0.0, 100.0);

    let mut ethics = 48.0 + snapshot.civilization.morale * 0.25 + snapshot.civilization.health * 0.15;
    if snapshot.civilization.policies.iter().any(|p| p == "share_equally") {
        ethics += 8.0;
    }
    if snapshot
        .civilization
        .policies
        .iter()
        .any(|p| p == "protect_vulnerable")
    {
        ethics += 10.0;
    }
    if snapshot.civilization.policies.iter().any(|p| p == "conserve_water") {
        ethics += 5.0;
    }
    if has_modifier(snapshot, "quarrel_pressure") {
        ethics -= 8.0;
    }
    ethics = ethics.clamp(0.0, 100.0);

    let era_bonus = match snapshot.civilization.era.as_str() {
        "canal_village" => 28.0,
        "tool_pond" => 16.0,
        _ => 6.0,
    };
    let intelligence = (era_bonus
        + snapshot.civilization.techs.len() as f32 * 6.5
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

fn advance_era_if_ready(snapshot: &mut CivSessionSnapshot) {
    let techs = &snapshot.civilization.techs;
    if snapshot.civilization.era == "pond_camp"
        && techs.iter().any(|tech| tech == "stone_tools")
        && techs.iter().any(|tech| tech == "moss_farm")
    {
        snapshot.civilization.era = "tool_pond".to_string();
    }
    if snapshot.civilization.era == "tool_pond"
        && techs.iter().any(|tech| tech == "water_filter")
        && techs.iter().any(|tech| tech == "council")
        && techs.iter().any(|tech| tech == "canal_network")
    {
        snapshot.civilization.era = "canal_village".to_string();
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
    serde_json::from_str(&raw).map_err(|e| e.to_string())
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
        let before = snapshot.civilization.resources["food"];
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
            },
        )
        .unwrap();
        assert_eq!(snapshot.civilization.resources["food"], before + 25);
        snapshot.civilization.score = score_civilization(&snapshot);
        assert!(snapshot.civilization.score.survival > 0.0);
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
        let base = score_civilization(&snapshot).ethics;
        snapshot
            .civilization
            .policies
            .push("protect_vulnerable".to_string());
        snapshot
            .civilization
            .policies
            .push("share_equally".to_string());
        let improved = score_civilization(&snapshot).ethics;
        assert!(improved > base);
    }

    #[test]
    fn extracts_json_from_markdown_response() {
        let decision = parse_model_decision(
            "```json\n{\"intent\":\"stabilize\",\"public_rationale\":\"food first\",\"actions\":[{\"type\":\"gather\",\"resource\":\"food\",\"workers\":2}],\"ethics_note\":\"share fairly\",\"expected_risks\":[\"slow tech\"]}\n```",
        )
        .unwrap();
        assert_eq!(decision.actions[0].action_type, "gather");
    }
}

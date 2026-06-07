import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  Activity,
  AlertTriangle,
  Bot,
  Brain,
  Eye,
  EyeOff,
  FastForward,
  FlaskConical,
  Gamepad2,
  Gift,
  Hammer,
  Leaf,
  LocateFixed,
  Minus,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Shield,
  Sparkles,
  Sprout,
  Trash2,
  Waves,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { CivilizationGameCanvas, type PlayerInteraction, type PlayerMove, type PlayerTool } from "./CivilizationGameCanvas";
import { primaryCiv, useCivStore } from "../../stores/civStore";
import { activeCivPlayerTask, cleanCivLogBody, type CivPlayerTask } from "../../lib/civPlayerTasks";
import {
  chooseCivPilotDecision,
  commandForCivPilotDecision,
  createCivPilotMemory,
  readCivPilotTextState,
  rememberCivPilotInteraction,
  type CivPilotCommand,
  type CivPilotDecision,
  type CivPilotGoal,
  type CivPilotMemory,
  type CivPilotTarget,
} from "../../lib/civPilot";
import type {
  CivCivilization,
  CivEntity,
  CivIntervention,
  CivLogEntry,
  CivModifier,
  CivRegion,
  CivSessionSnapshot,
} from "../../bindings";

declare global {
  interface Window {
    __XOLOTL_BROWSER_PREVIEW__?: boolean;
    civCamera?: {
      zoomBy(factor: number): void;
      recenter(): void;
      toggleFollow(): void;
      focusRegion(x: number, width: number): void;
    };
    civPilotControls?: {
      start(options?: { goal?: CivPilotGoal; possessId?: string; requesterId?: string; continueAfterTask?: boolean }): void;
      stop(): void;
    };
  }
}

// biome → accent oklch chip color, matching the cool palette used across the HUD
const BIOME_ACCENT: Record<string, string> = {
  shallows: "oklch(0.78 0.085 195)",
  reedmarsh: "oklch(0.74 0.080 145)",
  mudflats: "oklch(0.70 0.055 75)",
  kelpforest: "oklch(0.72 0.080 160)",
  openwater: "oklch(0.74 0.075 230)",
  deeptrench: "oklch(0.62 0.075 265)",
  crystalcave: "oklch(0.76 0.075 300)",
  thermalvent: "oklch(0.76 0.090 35)",
  coralreef: "oklch(0.78 0.090 350)",
  glacier: "oklch(0.82 0.060 215)",
  volcanic: "oklch(0.68 0.110 35)",
  bog: "oklch(0.67 0.075 135)",
  saltflats: "oklch(0.78 0.045 85)",
  abyss: "oklch(0.56 0.070 270)",
};

function biomeAccent(biome: string) {
  return BIOME_ACCENT[biome] ?? "oklch(0.70 0.030 220)";
}

const MVP_TARGET_TURN = 20;
const RESOURCES = [
  "food", "clean_water", "wood", "stone", "clay", "fiber", "tools", "glowshards",
  "kelp", "ore", "ice", "coral", "sulfur", "amber", "herbs",
];
const BUILD_RESOURCES = ["stone", "clay", "wood", "fiber", "coral", "ice"];
const BUFFS = ["abundant_moss", "clear_water", "cooperation_aura", "curiosity_spark"];
const DEBUFFS = ["drought", "cold_snap", "food_rot", "fatigue", "quarrel_pressure"];
const ACCESSORIES = [
  "flowercrown", "strawhat", "leafhat", "scarf", "glasses", "wizardhat",
  "crown", "snorkel", "bow", "headphones", "chefhat", "piratehat",
];
const PILOT_GOALS: Array<{ value: CivPilotGoal; label: string }> = [
  { value: "task", label: "Task" },
  { value: "task-loop", label: "Loop" },
  { value: "task-fetch", label: "Fetch" },
  { value: "task-trade", label: "Trade" },
  { value: "task-visit", label: "Visit" },
  { value: "task-repair", label: "Repair" },
  { value: "task-rescue", label: "Rescue" },
  { value: "task-bridge", label: "Bridge" },
  { value: "tour", label: "Tour" },
  { value: "gather", label: "Gather" },
  { value: "greet", label: "Greet" },
  { value: "return", label: "Return" },
  { value: "explore", label: "Explore" },
];
const CIV_PLAYER_SESSION_STORAGE_KEY = "xolotl-civ-player-session-v1";
const PLAYER_TOOLS: PlayerTool[] = ["use", "mine", "build"];
type PersistedCivPlayerSessionState = {
  possessedEntityId: string | null;
  playerTool: PlayerTool;
  pilotGoal: CivPilotGoal;
  codexPilot: boolean;
  playerTileX?: number;
  playerTileY?: number;
  updatedAt: number;
};
const STAGE_LABEL: Record<string, string> = {
  egg: "Egg", hatchling: "Hatchling", juvenile: "Juvenile", adult: "Adult", elder: "Elder",
};
// Auto-assigned per-civ palette, mirroring the backend CIV_COLORS ordering
// (civilization.rs:66-68) so creation-time chips match the founded civ colors.
const CIV_PALETTE = [
  "#7fdfff", "#ff9ec7", "#9bffa0", "#ffd66e", "#c79cff", "#ff8f6e", "#6ee0c7", "#f4f59a",
];
const MAX_PARTICIPANTS = 3;

type CivParticipantDraft = { name: string; model: string; color: string };

function paletteColor(index: number) {
  return CIV_PALETTE[index % CIV_PALETTE.length];
}

function makeParticipant(index: number, model: string): CivParticipantDraft {
  return { name: `Civ ${index + 1}`, model, color: paletteColor(index) };
}

function preferredModel(models: string[]) {
  return models.find((m) => m.toLowerCase().includes("kimi")) ?? models[0] ?? "";
}

type PilotReadout = {
  label: string;
  action: string;
  tool: string;
  target: string;
  tile: string;
  distance: string;
  step: number;
};

type CivEventPayload = {
  type: string;
  snapshot?: CivSessionSnapshot;
  error?: string;
};

type MvpStatus = {
  label: string;
  detail: string;
  progress: number;
  state: "stable" | "building" | "risk" | "collapsed";
};

type CompletedTaskSummary = {
  detail: string;
};

export function CivilizationView() {
  const sessions = useCivStore((s) => s.sessions);
  const activeSessionId = useCivStore((s) => s.activeSessionId);
  const snapshot = useCivStore((s) => s.activeSnapshot);
  const models = useCivStore((s) => s.models);
  const loading = useCivStore((s) => s.loading);
  const turnRunning = useCivStore((s) => s.turnRunning);
  const error = useCivStore((s) => s.error);
  const loadModels = useCivStore((s) => s.loadModels);
  const loadSessions = useCivStore((s) => s.loadSessions);
  const createSession = useCivStore((s) => s.createSession);
  const loadSession = useCivStore((s) => s.loadSession);
  const deleteSession = useCivStore((s) => s.deleteSession);
  const advanceTurn = useCivStore((s) => s.advanceTurn);
  const applyIntervention = useCivStore((s) => s.applyIntervention);
  const hydrateSnapshot = useCivStore((s) => s.hydrateSnapshot);
  const setError = useCivStore((s) => s.setError);
  const setSelectedCivId = useCivStore((s) => s.setSelectedCivId);

  const [name, setName] = useState("Axolotl Colony");
  const [participants, setParticipants] = useState<CivParticipantDraft[]>([makeParticipant(0, "")]);
  const [resource, setResource] = useState("food");
  const [amount, setAmount] = useState(10);
  const [modifier, setModifier] = useState("abundant_moss");
  const [autoplay, setAutoplay] = useState(false);
  const [uiHidden, setUiHidden] = useState(false);
  const [leftOpen, setLeftOpen] = useState(false);
  const [rightOpen, setRightOpen] = useState(false);
  const [possessedEntityId, setPossessedEntityId] = useState<string | null>(null);
  const [playerMessage, setPlayerMessage] = useState<string | null>(null);
  const [codexPilot, setCodexPilot] = useState(false);
  const [pilotGoal, setPilotGoal] = useState<CivPilotGoal>("task");
  const [pilotStatus, setPilotStatus] = useState("Idle");
  const [pilotCommand, setPilotCommand] = useState<CivPilotCommand>(null);
  const [pilotReadout, setPilotReadout] = useState<PilotReadout | null>(null);
  const [playerTool, setPlayerTool] = useState<PlayerTool>("use");
  const playerMovePendingRef = useRef(false);
  const playerMoveQueuedRef = useRef<PlayerMove | null>(null);
  const pilotMemoryRef = useRef<CivPilotMemory>(createCivPilotMemory());
  const pilotStepRef = useRef(0);
  const pilotInteractNonceRef = useRef(0);
  const pilotLastTaskRef = useRef<string | null>(null);
  const pilotContinueAfterTaskRef = useRef(false);
  const playerTaskToolSyncKeyRef = useRef<string | null>(null);
  const playerSessionRestoredRef = useRef<string | null>(null);
  const skipNextPlayerSessionPersistRef = useRef(false);

  useEffect(() => {
    void loadModels();
    void loadSessions();
  }, [loadModels, loadSessions]);

  // Once models load, backfill any participant row that has no model yet
  // (the initial row starts blank because models arrive asynchronously).
  useEffect(() => {
    if (models.length === 0) return;
    const fallback = preferredModel(models);
    setParticipants((rows) => (
      rows.some((row) => !row.model)
        ? rows.map((row) => (row.model ? row : { ...row, model: fallback }))
        : rows
    ));
  }, [models]);

  useEffect(() => {
    if (!activeSessionId && sessions && sessions.length > 0) {
      void loadSession(sessions[0].id);
    }
  }, [activeSessionId, sessions, loadSession]);

  useEffect(() => {
    if (!activeSessionId) return;
    let unlisten: UnlistenFn | null = null;
    let cancelled = false;
    listen<CivEventPayload>(`civ-event:${activeSessionId}`, (event) => {
      const payload = event.payload;
      if (payload.snapshot) hydrateSnapshot(payload.snapshot, payload.type);
      if (payload.error) setError(payload.error);
    }).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [activeSessionId, hydrateSnapshot, setError]);

  useEffect(() => {
    if (!autoplay || turnRunning || !snapshot) return;
    const timer = window.setTimeout(() => {
      void advanceTurn();
    }, 8000);
    return () => window.clearTimeout(timer);
  }, [autoplay, turnRunning, snapshot?.turn, advanceTurn, snapshot]);

  const recentLog = useMemo(() => [...(snapshot?.log ?? [])].reverse().slice(0, 12), [snapshot?.log]);
  const activeCiv = snapshot ? primaryCiv(snapshot) : null;
  const mvpStatus = snapshot ? getMvpStatus(snapshot, activeCiv) : null;
  const activePlayerTask = useMemo(
    () => (snapshot ? activeCivPlayerTask(snapshot, activeCiv) : null),
    [snapshot, activeCiv],
  );
  const recentCompletedTask = useMemo(
    () => (snapshot ? recentCompletedTaskSummary(snapshot) : null),
    [snapshot],
  );
  const possessableAxos = useMemo(() => {
    if (!snapshot) return [];
    return snapshot.world.entities.filter((entity) => (
      entity.kind === "axolotl"
      && (entity.stage ?? "adult") !== "egg"
      && (!activeCiv?.id || !entity.civ_id || entity.civ_id === activeCiv.id)
    ));
  }, [snapshot, activeCiv?.id]);
  const possessedEntity = possessedEntityId
    ? possessableAxos.find((entity) => entity.id === possessedEntityId) ?? null
    : null;
  const selectedPlayerId = possessedEntity?.id ?? possessableAxos[0]?.id ?? "";
  const buildResource = BUILD_RESOURCES.includes(resource) ? resource : "stone";

  useEffect(() => {
    const sessionId = snapshot?.id ?? activeSessionId;
    if (!sessionId || possessableAxos.length === 0 || playerSessionRestoredRef.current === sessionId) return;
    playerSessionRestoredRef.current = sessionId;
    skipNextPlayerSessionPersistRef.current = true;
    const saved = readCivPlayerSessionState(sessionId);
    const savedEntity = saved?.possessedEntityId
      ? possessableAxos.find((entity) => entity.id === saved.possessedEntityId) ?? null
      : null;
    const nextPossessedId = savedEntity?.id ?? null;
    const resumePilot = Boolean(saved?.codexPilot && nextPossessedId);
    const hasSavedTile = typeof saved?.playerTileX === "number" && typeof saved.playerTileY === "number";
    const restoreLiveTile = Boolean(
      snapshot
      && isBrowserPreviewCiv()
      && nextPossessedId
      && hasSavedTile
      && (savedEntity?.x !== saved?.playerTileX || savedEntity?.y !== saved?.playerTileY),
    );

    pilotMemoryRef.current = createCivPilotMemory();
    pilotStepRef.current = 0;
    pilotInteractNonceRef.current = 0;
    pilotLastTaskRef.current = null;
    pilotContinueAfterTaskRef.current = false;
    setPilotCommand(null);
    setPilotReadout(null);
    setPossessedEntityId(nextPossessedId);
    setPlayerTool(saved?.playerTool ?? "use");
    setPilotGoal(saved?.pilotGoal ?? "task");
    setCodexPilot(restoreLiveTile ? false : resumePilot);
    setPilotStatus(restoreLiveTile ? "Restoring position" : resumePilot ? "Resuming" : "Idle");
    setPlayerMessage(
      resumePilot
        ? `${restoreLiveTile ? "Restoring" : "Codex pilot resumed with"} ${savedEntity?.name ?? "an axolotl"}.`
        : nextPossessedId
          ? `Restored possession of ${savedEntity?.name ?? "an axolotl"}.`
          : null,
    );
    if (restoreLiveTile && snapshot && nextPossessedId && typeof saved?.playerTileX === "number" && typeof saved.playerTileY === "number") {
      hydrateSnapshot(snapshotWithEntityTile(snapshot, nextPossessedId, saved.playerTileX, saved.playerTileY));
      if (resumePilot) {
        window.setTimeout(() => {
          setCodexPilot(true);
          setPilotStatus("Resuming");
          setPlayerMessage(`Codex pilot resumed with ${savedEntity?.name ?? "an axolotl"}.`);
        }, 120);
      }
    }
  }, [activeSessionId, hydrateSnapshot, snapshot, snapshot?.id, possessableAxos]);

  useEffect(() => {
    const sessionId = snapshot?.id ?? activeSessionId;
    if (!sessionId || playerSessionRestoredRef.current !== sessionId) return;
    if (skipNextPlayerSessionPersistRef.current) {
      skipNextPlayerSessionPersistRef.current = false;
      return;
    }
    const previous = readCivPlayerSessionState(sessionId);
    writeCivPlayerSessionState(sessionId, {
      possessedEntityId,
      playerTool,
      pilotGoal,
      codexPilot,
      playerTileX: previous?.playerTileX,
      playerTileY: previous?.playerTileY,
      updatedAt: Date.now(),
    });
  }, [activeSessionId, snapshot?.id, possessedEntityId, playerTool, pilotGoal, codexPilot]);

  useEffect(() => {
    const sessionId = snapshot?.id ?? activeSessionId;
    if (!sessionId || !possessedEntityId || playerSessionRestoredRef.current !== sessionId) return;
    const timer = window.setInterval(() => {
      const liveState = readCivPilotTextState();
      const livePlayer = liveState?.player?.player;
      if (!livePlayer || liveState.player?.possessedEntityId !== possessedEntityId) return;
      writeCivPlayerSessionState(sessionId, {
        possessedEntityId,
        playerTool,
        pilotGoal,
        codexPilot,
        playerTileX: livePlayer.tile_x,
        playerTileY: livePlayer.tile_y,
        updatedAt: Date.now(),
      });
    }, 650);
    return () => window.clearInterval(timer);
  }, [activeSessionId, snapshot?.id, possessedEntityId, playerTool, pilotGoal, codexPilot]);

  useEffect(() => {
    if (!possessedEntityId) return;
    const handleToolHotkey = (event: KeyboardEvent) => {
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || isTextEntryTarget(event.target)) return;
      const tool = playerToolFromHotkey(event);
      if (!tool) return;
      event.preventDefault();
      selectPlayerTool(tool);
    };
    window.addEventListener("keydown", handleToolHotkey, { capture: true });
    return () => window.removeEventListener("keydown", handleToolHotkey, { capture: true });
  }, [codexPilot, possessedEntityId]);

  useEffect(() => {
    if (codexPilot) return;
    if (!activePlayerTask) {
      playerTaskToolSyncKeyRef.current = null;
      return;
    }
    const taskKey = [
      activePlayerTask.kind,
      activePlayerTask.npcId,
      activePlayerTask.objectId,
      activePlayerTask.buildingId,
      activePlayerTask.requestedTurn,
      activePlayerTask.status,
    ].join(":");
    if (playerTaskToolSyncKeyRef.current === taskKey) return;
    playerTaskToolSyncKeyRef.current = taskKey;
    setPlayerTool(playerToolForTask(activePlayerTask));
  }, [activePlayerTask, codexPilot]);

  useEffect(() => {
    if (possessedEntityId && !possessableAxos.some((entity) => entity.id === possessedEntityId)) {
      setPossessedEntityId(null);
    }
  }, [possessedEntityId, possessableAxos]);

  useEffect(() => {
    window.civPilotControls = {
      start: (options = {}) => {
        const nextGoal = options.goal ?? pilotGoal;
        const nextPossessedId = options.possessId && possessableAxos.some((entity) => entity.id === options.possessId)
          ? options.possessId
          : selectedPlayerId || possessableAxos[0]?.id || "";
        const nextMemory = createCivPilotMemory();
        if (options.requesterId) nextMemory.preferredRequesterId = options.requesterId;
        pilotMemoryRef.current = nextMemory;
        pilotStepRef.current = 0;
        pilotInteractNonceRef.current = 0;
        pilotLastTaskRef.current = null;
        pilotContinueAfterTaskRef.current = Boolean(options.continueAfterTask);
        setPilotGoal(nextGoal);
        setPlayerTool("use");
        if (nextPossessedId) setPossessedEntityId(nextPossessedId);
        setCodexPilot(true);
        setPilotReadout(null);
        setPilotStatus("Connecting");
        setPlayerMessage("Codex pilot connecting.");
        focusGameCanvasSoon();
      },
      stop: () => {
        setCodexPilot(false);
        setPilotCommand(null);
        setPilotReadout(null);
        setPilotStatus("Stopped");
        setPlayerMessage("Codex pilot stopped.");
        pilotContinueAfterTaskRef.current = false;
        focusGameCanvasSoon();
      },
    };
    return () => {
      delete window.civPilotControls;
    };
  }, [pilotGoal, possessableAxos, selectedPlayerId]);

  useEffect(() => {
    if (!codexPilot || !snapshot) {
      setPilotCommand(null);
      if (!codexPilot) setPilotReadout(null);
      return;
    }

    const timer = window.setInterval(() => {
      const liveState = readCivPilotTextState();
      if (!liveState) {
        setPilotCommand(null);
        setPilotReadout(null);
        setPilotStatus("Waiting for world state");
        return;
      }

      const step = pilotStepRef.current;
      const taskKey = liveState.player_task
        ? `${liveState.player_task.kind}:${liveState.player_task.npcId}:${liveState.player_task.requestedTurn}`
        : null;
      if (pilotLastTaskRef.current && !taskKey) {
        pilotMemoryRef.current.taskCompletedAt = step;
        if (pilotGoal.startsWith("task") && pilotGoal !== "task-loop" && !pilotContinueAfterTaskRef.current) {
          setCodexPilot(false);
          setPilotCommand(null);
          setPilotReadout(null);
          setPilotStatus("Task complete");
          setPlayerMessage("Codex pilot completed the task.");
          pilotLastTaskRef.current = null;
          return;
        }
      }
      pilotLastTaskRef.current = taskKey;

      if (!liveState.player?.player) {
        const id = selectedPlayerId || possessableAxos[0]?.id;
        if (!id) {
          setPilotCommand(null);
          setPilotReadout(null);
          setPilotStatus("No playable axolotl");
          return;
        }
        const entity = possessableAxos.find((item) => item.id === id);
        setPossessedEntityId(id);
        setPlayerMessage(entity ? `Codex pilot possessed ${entity.name}.` : "Codex pilot possessed an axolotl.");
        setPilotStatus("Possessing axolotl");
        setPilotCommand(null);
        setPilotReadout(null);
        return;
      }

      const decision = chooseCivPilotDecision(liveState, pilotGoal, step, pilotMemoryRef.current);
      if (decision.action === "advance_turn") {
        setPilotCommand(null);
        setPilotStatus(decision.label);
        setPilotReadout(pilotReadoutForDecision(decision, step + 1));
        setPlayerMessage(`Codex pilot: ${decision.label}.`);
        if (!turnRunning) void advanceTurn();
        pilotStepRef.current = step + 1;
        return;
      }
      if (decision.action === "interact" && decision.tool) setPlayerTool(decision.tool);
      if (decision.action === "move") {
        const targetTool = decision.target.action === "mine_tile"
          ? "mine"
          : decision.target.action === "place_tile"
            ? "build"
            : decision.target.kind === "object" || decision.target.kind === "building" || decision.target.kind === "npc" || decision.target.kind === "resource"
              ? "use"
              : null;
        if (targetTool) setPlayerTool(targetTool);
      }
      if (decision.action === "interact") {
        pilotInteractNonceRef.current += 1;
        rememberCivPilotInteraction(pilotMemoryRef.current, decision.target, step);
      }
      rememberCivPilotInteraction(pilotMemoryRef.current, liveState.player?.lastInteraction, step);
      setPilotCommand(commandForCivPilotDecision(decision, pilotInteractNonceRef.current));
      setPilotStatus(decision.label);
      setPilotReadout(pilotReadoutForDecision(decision, step + 1));
      setPlayerMessage(`Codex pilot: ${decision.label}.`);
      pilotStepRef.current = step + 1;
    }, 520);

    return () => window.clearInterval(timer);
  }, [advanceTurn, codexPilot, snapshot, selectedPlayerId, pilotGoal, possessableAxos, turnRunning]);

  function addParticipant() {
    setParticipants((rows) => (
      rows.length >= MAX_PARTICIPANTS
        ? rows
        : [...rows, makeParticipant(rows.length, preferredModel(models))]
    ));
  }

  function removeParticipant(index: number) {
    setParticipants((rows) => (rows.length <= 1 ? rows : rows.filter((_, i) => i !== index)));
  }

  function updateParticipant(index: number, patch: Partial<CivParticipantDraft>) {
    setParticipants((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  const canFound = !loading && participants.every((p) => Boolean(p.model));

  async function handleCreate() {
    if (!canFound) return;
    const fallback = preferredModel(models);
    const civs = participants.map((p, i) => ({
      name: p.name.trim() || `Civ ${i + 1}`,
      model: p.model || fallback,
      color: p.color,
    }));
    await createSession({ name, seed: null, civs });
    // Reset selection to the founding colony so the observer panel has a focus.
    setSelectedCivId(null);
    setLeftOpen(false);
  }

  function sendIntervention(intervention: CivIntervention) {
    void applyIntervention(intervention);
  }

  function focusGameCanvasSoon() {
    window.setTimeout(() => {
      document.querySelector<HTMLCanvasElement>(".civ-canvas-host canvas")?.focus({ preventScroll: true });
    }, 0);
  }

  function selectPlayerTool(tool: PlayerTool) {
    setCodexPilot(false);
    setPilotCommand(null);
    setPilotReadout(null);
    if (codexPilot) setPilotStatus("Stopped");
    setPlayerTool(tool);
    focusGameCanvasSoon();
  }

  function possessFirstAvailable() {
    const id = selectedPlayerId || possessableAxos[0]?.id;
    if (!id) return;
    setPossessedEntityId(id);
    const entity = possessableAxos.find((item) => item.id === id);
    setPlayerMessage(entity ? `Possessing ${entity.name}.` : "Possession ready.");
    focusGameCanvasSoon();
  }

  function toggleCodexPilot() {
    if (codexPilot) {
      setCodexPilot(false);
      setPilotCommand(null);
      setPilotReadout(null);
      setPilotStatus("Stopped");
      setPlayerMessage("Codex pilot stopped.");
      pilotContinueAfterTaskRef.current = false;
      return;
    }
    pilotMemoryRef.current = createCivPilotMemory();
    pilotStepRef.current = 0;
    pilotInteractNonceRef.current = 0;
    pilotLastTaskRef.current = null;
    pilotContinueAfterTaskRef.current = false;
    setPlayerTool("use");
    setCodexPilot(true);
    setPilotReadout(null);
    setPilotStatus("Connecting");
    if (!possessedEntityId) possessFirstAvailable();
    setPlayerMessage("Codex pilot connecting.");
    focusGameCanvasSoon();
  }

  function handlePlayerInteract(interaction: PlayerInteraction) {
    if (interaction.kind === "terrain" && interaction.action === "mine_tile" && activeCiv) {
      const task = activePlayerTask;
      void applyIntervention({
        kind: "mine_tile",
        target: interaction.terrain ?? "",
        amount: 1,
        x: interaction.tileX ?? Math.floor(interaction.x / 16),
        y: interaction.tileY ?? Math.floor(interaction.y / 16),
        entity_id: interaction.entityId,
        civ_id: activeCiv.id,
      });
      if (task && isRescueRubbleInteraction(snapshot, task, interaction)) {
        const nextProgress = Math.min(task.amount, task.progress + 1);
        const rescueReady = nextProgress >= task.amount;
        setPlayerMessage(
          rescueReady
            ? `Cleared the last rubble near ${task.objectName}. Use ${task.objectName} to finish the rescue.`
            : `Cleared rescue rubble for ${task.npcName} (${nextProgress}/${task.amount}).`,
        );
        if (rescueReady) {
          playerTaskToolSyncKeyRef.current = null;
          setPlayerTool("use");
          if (codexPilot) {
            setPilotStatus(`rescue ${task.objectName}`);
            setPilotReadout(null);
          }
        }
      } else {
        setPlayerMessage(`Mined ${interaction.label} for ${resourceLabel(interaction.yieldsResource ?? "stone")}.`);
      }
      return;
    }
    if (interaction.kind === "terrain" && interaction.action === "place_tile" && activeCiv) {
      const material = interaction.buildResource ?? buildResource;
      if ((activeCiv.resources?.[material] ?? 0) <= 0) {
        setPlayerMessage(`No ${resourceLabel(material)} available to build.`);
        return;
      }
      void applyIntervention({
        kind: "place_tile",
        target: material,
        amount: 1,
        x: interaction.tileX ?? Math.floor(interaction.x / 16),
        y: interaction.tileY ?? Math.floor(interaction.y / 16),
        entity_id: interaction.entityId,
        civ_id: activeCiv.id,
      });
      const task = activePlayerTask;
      if (task?.kind === "build_bridge") {
        const nextProgress = Math.min(task.amount, task.progress + 1);
        const bridgeComplete = nextProgress >= task.amount;
        setPlayerMessage(
          bridgeComplete
            ? `Built ${task.objectName} for ${task.npcName}.`
            : `Placed bridge tile for ${task.npcName} (${nextProgress}/${task.amount}).`,
        );
        if (bridgeComplete) {
          playerTaskToolSyncKeyRef.current = null;
          setPlayerTool("use");
        }
      } else {
        setPlayerMessage(`Placed ${interaction.label} using ${resourceLabel(material)}.`);
      }
      return;
    }
    if (interaction.kind === "resource" && interaction.resource && activeCiv) {
      const gained = playerResourceTarget(interaction.resource);
      void applyIntervention({
        kind: "harvest_resource",
        target: interaction.resource,
        amount: 1,
        x: interaction.tileX ?? Math.floor(interaction.x / 16),
        y: interaction.tileY ?? Math.floor(interaction.y / 16),
        entity_id: interaction.entityId,
        civ_id: activeCiv.id,
      });
      const task = activePlayerTask;
      const taskResourceMatches = task
        && task.kind !== "visit_building"
        && task.kind !== "build_bridge"
        && (interaction.resource === task.sourceResource || gained === task.resource);
      if (taskResourceMatches && task.status !== "ready") {
        const nextProgress = Math.min(task.amount, task.progress + 1);
        setPlayerMessage(taskResourceGatherMessage(task, gained, nextProgress));
      } else if (taskResourceMatches) {
        setPlayerMessage(taskReadyResourceMessage(task));
      } else {
        setPlayerMessage(`Gathered ${resourceLabel(gained)} near ${tileLabel(interaction.x, interaction.y)}.`);
      }
      return;
    }
    if (interaction.kind === "building") {
      if (interaction.targetId && activeCiv) {
        void applyIntervention({
          kind: "use_building",
          target: "",
          entity_id: interaction.targetId,
          civ_id: activeCiv.id,
        });
      }
      if (activePlayerTask?.kind === "visit_building" && activePlayerTask.buildingId === interaction.targetId) {
        setPlayerMessage(`Checked ${interaction.label} for ${activePlayerTask.npcName}.`);
      } else {
        setPlayerMessage(`Used ${interaction.label}.`);
      }
      return;
    }
    if (interaction.kind === "object") {
      if (activePlayerTask?.kind === "repair_object" && activePlayerTask.status !== "ready") {
        setPlayerMessage(`Gather ${resourceLabel(activePlayerTask.sourceResource)} before repairing ${interaction.label}.`);
        return;
      }
      if (activePlayerTask?.kind === "rescue_object" && activePlayerTask.status !== "ready") {
        setPlayerMessage(`Mine ${activePlayerTask.remaining} more rubble near ${interaction.label}.`);
        return;
      }
      if (interaction.targetId && activeCiv) {
        void applyIntervention({
          kind: interaction.action === "repair_object" ? "repair_object" : interaction.action === "rescue_object" ? "rescue_object" : "use_object",
          target: interaction.objectRole ?? "",
          entity_id: interaction.targetId,
          civ_id: activeCiv.id,
        });
      }
      if (activePlayerTask?.kind === "repair_object" && activePlayerTask.objectId === interaction.targetId) {
        setPlayerMessage(`Repaired ${interaction.label} for ${activePlayerTask.npcName}.`);
      } else if (activePlayerTask?.kind === "rescue_object" && activePlayerTask.objectId === interaction.targetId) {
        setPlayerMessage(`Rescued ${interaction.label} for ${activePlayerTask.npcName}.`);
      } else {
        setPlayerMessage(`Checked ${interaction.label}.`);
      }
      return;
    }
    if (interaction.kind === "npc") {
      if (interaction.targetId && activeCiv) {
        void applyIntervention({
          kind: "talk_entity",
          target: "",
          entity_id: interaction.targetId,
          civ_id: activeCiv.id,
        });
      }
      const task = activePlayerTask;
      if (task && task.npcId === interaction.targetId) {
        setPlayerMessage(taskNpcMessage(task, interaction.label));
      } else if (task) {
        setPlayerMessage(`${interaction.label} points you back to ${task.npcName}.`);
      } else {
        setPlayerMessage(`${interaction.label} gave you a request.`);
      }
      return;
    }
    setPlayerMessage("Nothing close enough to interact with.");
  }

  function handlePlayerMove(move: PlayerMove) {
    if (!activeCiv) return;
    if (playerMovePendingRef.current) {
      playerMoveQueuedRef.current = move;
      return;
    }
    sendPlayerMove(move);
  }

  function sendPlayerMove(move: PlayerMove) {
    if (!activeCiv) return;
    playerMovePendingRef.current = true;
    void applyIntervention({
      kind: "move_entity",
      target: "",
      entity_id: move.entityId,
      x: move.tileX,
      y: move.tileY,
      civ_id: activeCiv.id,
    }).finally(() => {
      playerMovePendingRef.current = false;
      const queued = playerMoveQueuedRef.current;
      playerMoveQueuedRef.current = null;
      if (queued) sendPlayerMove(queued);
    });
  }

  function equipAccessory(entityId: string, accessory: string, equip: boolean) {
    void applyIntervention({
      kind: equip ? "equip_accessory" : "unequip_accessory",
      target: "",
      entity_id: entityId,
      accessory,
    });
  }

  const isBuff = BUFFS.includes(modifier);
  // world-center x for spawns; backend snaps the y to the seabed automatically
  const spawnX = Math.floor(activeCiv?.spawn_x || ((snapshot?.world.width ?? 128) / 2));


  return (
    <main className="civ-view">
      {/* ── fullscreen world stage ─────────────────────────────────────── */}
      <div className="civ-stage">
        {snapshot ? (
          <CivilizationGameCanvas
            snapshot={snapshot}
            turnRunning={turnRunning}
            possessedEntityId={possessedEntityId}
            playerTool={playerTool}
            buildResource={buildResource}
            pilotCommand={pilotCommand}
            pilotActive={codexPilot}
            onPlayerInteract={handlePlayerInteract}
            onPlayerMove={handlePlayerMove}
          />
        ) : (
          <div className="civ-welcome">
            <div className="civ-glass civ-welcome-card">
              <div className="mb-1 flex items-center gap-2 text-[oklch(0.86_0.05_175)]">
                <Sprout className="h-5 w-5" />
                <span className="text-sm font-semibold">Axolotl Civilization Lab</span>
              </div>
              <p className="mb-3 text-xs leading-relaxed text-[oklch(0.62_0.014_225)]">
                Found a pixel axolotl colony and watch a model govern it turn by turn. You observe,
                grant resources, and apply buffs or debuffs.
              </p>
              <div className="space-y-2">
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Colony name" />
                <ParticipantPicker
                  participants={participants}
                  models={models}
                  onAdd={addParticipant}
                  onRemove={removeParticipant}
                  onChange={updateParticipant}
                />
                <Button className="w-full" disabled={!canFound} onClick={() => void handleCreate()}>
                  <Sprout className="h-3.5 w-3.5" />
                  Found Colony
                </Button>
                {sessions && sessions.length > 0 && (
                  <button type="button" className="civ-link" onClick={() => setLeftOpen(true)}>
                    or load a saved colony →
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── persistent corner control: hide / reveal the HUD ───────────── */}
      <button
        type="button"
        className="civ-eye"
        onClick={() => setUiHidden((v) => !v)}
        title={uiHidden ? "Show interface" : "Hide interface"}
        aria-pressed={uiHidden}
      >
        {uiHidden ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
        <span>{uiHidden ? "Show UI" : "Hide UI"}</span>
      </button>

      {/* ── top-left status HUD ────────────────────────────────────────── */}
      {!uiHidden && snapshot && (
        <div className="civ-hud civ-hud-tl civ-glass">
          <div className="flex items-center gap-2">
            <span className="civ-hud-mark"><Sprout className="h-3.5 w-3.5" /></span>
            <div className="min-w-0">
              <div className="truncate text-[13px] font-semibold text-[oklch(0.90_0.018_220)]">{snapshot.name}</div>
              <div className="truncate text-[10px] uppercase tracking-[0.14em] text-[oklch(0.55_0.014_220)]">
                {activeCiv?.model ?? "unknown"} · {(activeCiv?.era ?? "pond_camp").replace(/_/g, " ")}
              </div>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Metric icon={<RotateCcw className="h-3 w-3" />} label="Turn" value={String(snapshot.turn)} />
            <Metric icon={<Activity className="h-3 w-3" />} label="Pop" value={String(activeCiv?.population ?? 0)} />
            <Metric icon={<Shield className="h-3 w-3" />} label="HP" value={formatScore(activeCiv?.health)} />
            <Metric icon={<Sprout className="h-3 w-3" />} label="Mood" value={formatScore(activeCiv?.morale)} />
            <Metric icon={<FlaskConical className="h-3 w-3" />} label="Score" value={formatScore(activeCiv?.score.total)} tone />
          </div>
          {(possessedEntity || codexPilot) && (
            <ControlStateStrip
              mode={codexPilot ? "codex" : "manual"}
              name={codexPilot ? "Codex driving" : `${possessedEntity?.name ?? "Player"} driving`}
              detail={codexPilot ? pilotStatus : playerToolLabel(playerTool)}
            />
          )}
          {mvpStatus && <ObjectiveStrip status={mvpStatus} />}
          {activePlayerTask && <PlayerTaskStrip task={activePlayerTask} />}
          {!activePlayerTask && recentCompletedTask && <PlayerTaskCompleteStrip summary={recentCompletedTask} />}
          {(possessedEntity || playerMessage) && (
            <div className="civ-player-strip">
              <Gamepad2 className="h-3.5 w-3.5" />
              <span className="min-w-0 flex-1 truncate">
                {possessedEntity ? `${possessedEntity.name}: ${playerMessage ?? "Player control active."}` : playerMessage}
              </span>
            </div>
          )}
          {codexPilot && (
            <div className="civ-pilot-strip" aria-label="Codex pilot status">
              <Bot className="h-3.5 w-3.5" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold">Codex pilot: {pilotStatus}</div>
                {pilotReadout && <PilotReadoutChips readout={pilotReadout} />}
              </div>
            </div>
          )}
          {turnRunning && (
            <div className="civ-thinking">
              <Brain className="h-3 w-3" />
              <span>Model is deciding…</span>
            </div>
          )}
        </div>
      )}

      {/* ── edge tabs that open the drawers ────────────────────────────── */}
      {!uiHidden && (
        <>
          <button
            type="button"
            className="civ-edge-tab civ-edge-left"
            onClick={() => setLeftOpen((v) => !v)}
            aria-expanded={leftOpen}
          >
            <Leaf className="h-3.5 w-3.5" />
            <span>Colonies</span>
          </button>
          {snapshot && (
            <button
              type="button"
              className="civ-edge-tab civ-edge-right"
              onClick={() => setRightOpen((v) => !v)}
              aria-expanded={rightOpen}
            >
              <Hammer className="h-3.5 w-3.5" />
              <span>Observer</span>
            </button>
          )}
        </>
      )}

      {/* ── LEFT drawer: sessions + create ─────────────────────────────── */}
      {!uiHidden && (
        <aside className={["civ-drawer civ-drawer-left civ-glass", leftOpen ? "is-open" : ""].join(" ")}>
          <DrawerHeader title="Colonies" icon={<Leaf className="h-3.5 w-3.5" />} onClose={() => setLeftOpen(false)} />
          <div className="civ-drawer-body">
            <Section label="New colony" icon={<Plus className="h-3.5 w-3.5" />}>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Colony name" />
              <div className="mt-2">
                <ParticipantPicker
                  participants={participants}
                  models={models}
                  onAdd={addParticipant}
                  onRemove={removeParticipant}
                  onChange={updateParticipant}
                />
              </div>
              <Button size="sm" className="mt-2 w-full" disabled={!canFound} onClick={() => void handleCreate()}>
                <Sprout className="h-3.5 w-3.5" />
                Found Colony
              </Button>
            </Section>
            <Section label="Saved" icon={<RotateCcw className="h-3.5 w-3.5" />}>
              <div className="space-y-1.5">
                {sessions && sessions.length > 0 ? sessions.map((session) => (
                  <div
                    key={session.id}
                    className={[
                      "group flex w-full items-center gap-2 rounded-md border px-2 py-2 transition-colors",
                      session.id === activeSessionId
                        ? "border-[oklch(0.42_0.032_175)] bg-[oklch(0.16_0.014_170)]"
                        : "border-[oklch(0.24_0.008_240)] bg-[oklch(0.11_0.004_245)]/70 hover:bg-[oklch(0.15_0.006_240)]",
                    ].join(" ")}
                  >
                    <button type="button" onClick={() => { void loadSession(session.id); setLeftOpen(false); }} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                      <span className="grid h-7 w-7 flex-none place-items-center rounded bg-[oklch(0.16_0.010_190)] text-[oklch(0.72_0.055_180)]">
                        <Leaf className="h-3.5 w-3.5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-semibold text-[oklch(0.85_0.014_220)]">{session.name}</span>
                        <span className="block truncate text-[10px] text-[oklch(0.54_0.012_225)]">Turn {session.turn} · {formatScore(session.score)}</span>
                      </span>
                    </button>
                    <button
                      type="button"
                      className="rounded p-1 text-[oklch(0.44_0.012_230)] opacity-0 transition-opacity hover:text-[oklch(0.78_0.055_28)] group-hover:opacity-100"
                      onClick={() => void deleteSession(session.id)}
                      title="Delete colony"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )) : (
                  <div className="rounded-md border border-[oklch(0.24_0.008_240)] bg-[oklch(0.11_0.004_245)]/70 px-3 py-4 text-xs text-[oklch(0.54_0.012_225)]">
                    No colonies yet. Found one above.
                  </div>
                )}
              </div>
            </Section>
          </div>
        </aside>
      )}

      {/* ── RIGHT drawer: observer panels ──────────────────────────────── */}
      {!uiHidden && snapshot && (
        <aside className={["civ-drawer civ-drawer-right civ-glass", rightOpen ? "is-open" : ""].join(" ")}>
          <DrawerHeader title="Observer" icon={<Hammer className="h-3.5 w-3.5" />} onClose={() => setRightOpen(false)} />
          <div className="civ-drawer-body">
            <Section label="MVP Status" icon={<Activity className="h-3.5 w-3.5" />}>
              {mvpStatus && <MvpPanel status={mvpStatus} />}
            </Section>
            <Section label="Player" icon={<Gamepad2 className="h-3.5 w-3.5" />}>
              <PlayerPanel
                axos={possessableAxos}
                selectedId={selectedPlayerId}
                possessedId={possessedEntityId}
                message={playerMessage}
                task={activePlayerTask}
                pilotEnabled={codexPilot}
                pilotGoal={pilotGoal}
                pilotStatus={pilotStatus}
                onSelect={(id) => {
                  setPossessedEntityId(id || null);
                  const entity = possessableAxos.find((item) => item.id === id);
                  setPlayerMessage(entity ? `Possessing ${entity.name}.` : null);
                  if (id) focusGameCanvasSoon();
                }}
                onPossess={possessFirstAvailable}
                onRelease={() => {
                  setCodexPilot(false);
                  setPilotCommand(null);
                  setPilotReadout(null);
                  setPilotStatus("Stopped");
                  setPossessedEntityId(null);
                  setPlayerMessage("Released player control.");
                }}
                onPilotGoalChange={setPilotGoal}
                onTogglePilot={toggleCodexPilot}
              />
            </Section>
            <Section label="Score" icon={<FlaskConical className="h-3.5 w-3.5" />}>
              <ScorePanel civ={activeCiv} />
            </Section>
            <Section label="Colony" icon={<Sprout className="h-3.5 w-3.5" />}>
              <ColonyPanel snapshot={snapshot} onEquip={equipAccessory} />
            </Section>
            <Section label="Regions" icon={<Waves className="h-3.5 w-3.5" />}>
              <RegionsPanel snapshot={snapshot} />
            </Section>
            <Section label="Resources" icon={<Hammer className="h-3.5 w-3.5" />}>
              <ResourcesPanel civ={activeCiv} />
            </Section>
            <Section label="Intervene" icon={<Gift className="h-3.5 w-3.5" />}>
              <div className="grid gap-2">
                <div className="flex items-center gap-1.5">
                  <select value={resource} onChange={(e) => setResource(e.target.value)} className="civ-select flex-1">
                    {RESOURCES.map((item) => <option key={item} value={item}>{resourceLabel(item)}</option>)}
                  </select>
                  <Input type="number" min={1} max={99} value={amount} onChange={(e) => setAmount(Number(e.target.value))} className="w-16" />
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  <Button size="xs" variant="outline" onClick={() => sendIntervention({ kind: "grant_resource", target: resource, amount })}>Grant</Button>
                  <Button size="xs" variant="outline" onClick={() => sendIntervention({ kind: "remove_resource", target: resource, amount })}>Remove</Button>
                  <Button size="xs" variant="outline" onClick={() => sendIntervention({ kind: "spawn_resource", target: resource, amount, x: spawnX })}>Spawn</Button>
                </div>
                <select value={modifier} onChange={(e) => setModifier(e.target.value)} className="civ-select">
                  <optgroup label="Buffs">{BUFFS.map((item) => <option key={item} value={item}>{modifierLabel(item)}</option>)}</optgroup>
                  <optgroup label="Debuffs">{DEBUFFS.map((item) => <option key={item} value={item}>{modifierLabel(item)}</option>)}</optgroup>
                </select>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => sendIntervention({
                    kind: isBuff ? "apply_buff" : "apply_debuff",
                    target: modifier,
                    duration: 4,
                    intensity: 1,
                  })}
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  Apply {isBuff ? "Buff" : "Debuff"}
                </Button>
              </div>
            </Section>
            <Section label="Modifiers" icon={<AlertTriangle className="h-3.5 w-3.5" />}>
              <ModifiersPanel modifiers={snapshot.modifiers} />
            </Section>
            <Section label="Log" icon={<Waves className="h-3.5 w-3.5" />}>
              <LogPanel entries={recentLog} />
            </Section>
          </div>
        </aside>
      )}

      {/* ── error toast ────────────────────────────────────────────────── */}
      {error && (
        <div className="civ-error civ-glass">
          <AlertTriangle className="h-3.5 w-3.5 flex-none" />
          <span className="min-w-0 flex-1 truncate">{error}</span>
          <button type="button" onClick={() => setError(null)} aria-label="Dismiss error" title="Dismiss error" className="flex-none opacity-70 hover:opacity-100"><X className="h-3.5 w-3.5" /></button>
        </div>
      )}

      {/* ── minimal floating toolbelt (always visible) ─────────────────── */}
      {snapshot && (
        <div className="civ-toolbelt civ-glass">
          <button className="civ-slot civ-slot-primary" disabled={turnRunning} onClick={() => void advanceTurn()} title="Advance one turn">
            <FastForward className="h-4 w-4" />
            <span>{turnRunning ? "Thinking…" : "Next Turn"}</span>
          </button>
          <button
            className={["civ-slot", autoplay ? "is-active" : ""].join(" ")}
            disabled={turnRunning}
            aria-pressed={autoplay}
            onClick={() => setAutoplay((v) => !v)}
            title={autoplay ? "Pause auto turns" : "Run turns automatically"}
          >
            {autoplay ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            <span>Auto</span>
          </button>
          <button
            className={["civ-slot", possessedEntity ? "is-player" : ""].join(" ")}
            disabled={possessableAxos.length === 0}
            aria-pressed={!!possessedEntity}
            onClick={(event) => {
              event.currentTarget.blur();
              if (possessedEntity) {
                setCodexPilot(false);
                setPilotCommand(null);
                setPilotReadout(null);
                setPilotStatus("Stopped");
                setPossessedEntityId(null);
                setPlayerMessage("Released player control.");
              } else {
                possessFirstAvailable();
              }
            }}
            title={possessedEntity ? "Release possessed axolotl" : "Possess an axolotl"}
          >
            <Gamepad2 className="h-4 w-4" />
            <span>{possessedEntity ? "Release" : "Possess"}</span>
          </button>
          <button
            className={["civ-slot", codexPilot ? "is-pilot" : ""].join(" ")}
            disabled={possessableAxos.length === 0}
            aria-pressed={codexPilot}
            onClick={(event) => {
              event.currentTarget.blur();
              toggleCodexPilot();
            }}
            title={codexPilot ? "Stop Codex pilot" : "Watch Codex pilot"}
          >
            <Bot className="h-4 w-4" />
            <span>{codexPilot ? "Stop" : "Codex"}</span>
          </button>
          <select
            value={pilotGoal}
            onChange={(event) => setPilotGoal(event.target.value as CivPilotGoal)}
            className="civ-slot-select civ-slot-select-tight"
            title="Codex pilot goal"
          >
            {PILOT_GOALS.map((goal) => <option key={goal.value} value={goal.value}>{goal.label}</option>)}
          </select>
          <span className="civ-toolbelt-div" />
          <button
            className={["civ-slot", playerTool === "use" ? "is-active" : ""].join(" ")}
            aria-pressed={playerTool === "use"}
            onMouseDown={(event) => event.preventDefault()}
            onClick={(event) => {
              event.currentTarget.blur();
              selectPlayerTool("use");
            }}
            title="Use (1/U): harvest resources, talk to NPCs, and use buildings"
          >
            <Gamepad2 className="h-4 w-4" />
            <span>Use</span>
          </button>
          <button
            className={["civ-slot", playerTool === "mine" ? "is-active" : ""].join(" ")}
            aria-pressed={playerTool === "mine"}
            onMouseDown={(event) => event.preventDefault()}
            onClick={(event) => {
              event.currentTarget.blur();
              selectPlayerTool("mine");
            }}
            title="Mine (2/M): target nearby terrain with E or Space"
          >
            <Hammer className="h-4 w-4" />
            <span>Mine</span>
          </button>
          <button
            className={["civ-slot", playerTool === "build" ? "is-active" : ""].join(" ")}
            aria-pressed={playerTool === "build"}
            onMouseDown={(event) => event.preventDefault()}
            onClick={(event) => {
              event.currentTarget.blur();
              selectPlayerTool("build");
            }}
            title={`Build (3/B): place ${resourceLabel(buildResource)} using E or Space`}
          >
            <Sprout className="h-4 w-4" />
            <span>Build</span>
          </button>
          <span className="civ-toolbelt-div" />
          <select value={resource} onChange={(e) => setResource(e.target.value)} className="civ-slot-select" title="Resource">
            {RESOURCES.map((item) => <option key={item} value={item}>{resourceLabel(item)}</option>)}
          </select>
          <button className="civ-slot" onClick={() => sendIntervention({ kind: "grant_resource", target: resource, amount })} title={`Grant ${amount} ${resourceLabel(resource)}`}>
            <Plus className="h-4 w-4" /><span>Grant</span>
          </button>
          <button className="civ-slot" onClick={() => sendIntervention({ kind: "remove_resource", target: resource, amount })} title={`Remove ${amount} ${resourceLabel(resource)}`}>
            <Minus className="h-4 w-4" /><span>Remove</span>
          </button>
          <button className="civ-slot" onClick={() => sendIntervention({ kind: "spawn_resource", target: resource, amount, x: spawnX })} title={`Spawn ${resourceLabel(resource)} in the world`}>
            <Sprout className="h-4 w-4" /><span>Spawn</span>
          </button>
          <span className="civ-toolbelt-div" />
          <select value={modifier} onChange={(e) => setModifier(e.target.value)} className="civ-slot-select civ-slot-select-wide" title="Modifier">
            <optgroup label="Buffs">{BUFFS.map((item) => <option key={item} value={item}>{modifierLabel(item)}</option>)}</optgroup>
            <optgroup label="Debuffs">{DEBUFFS.map((item) => <option key={item} value={item}>{modifierLabel(item)}</option>)}</optgroup>
          </select>
          <button
            className={["civ-slot", isBuff ? "is-buff" : "is-debuff"].join(" ")}
            onClick={() => sendIntervention({ kind: isBuff ? "apply_buff" : "apply_debuff", target: modifier, duration: 4, intensity: 1 })}
            title={`Apply ${modifierLabel(modifier)}`}
          >
            <Sparkles className="h-4 w-4" /><span>{isBuff ? "Buff" : "Debuff"}</span>
          </button>
          <span className="civ-toolbelt-div" />
          <div className="civ-cam">
            <button type="button" className="civ-cam-btn" onClick={() => window.civCamera?.zoomBy(0.83)} title="Zoom out">
              <ZoomOut className="h-4 w-4" />
            </button>
            <button type="button" className="civ-cam-btn" onClick={() => window.civCamera?.zoomBy(1.2)} title="Zoom in">
              <ZoomIn className="h-4 w-4" />
            </button>
            <button type="button" className="civ-cam-btn" onClick={() => window.civCamera?.recenter()} title="Recenter on colony">
              <LocateFixed className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </main>
  );
}

function ParticipantPicker({
  participants,
  models,
  onAdd,
  onRemove,
  onChange,
}: {
  participants: CivParticipantDraft[];
  models: string[];
  onAdd: () => void;
  onRemove: (index: number) => void;
  onChange: (index: number, patch: Partial<CivParticipantDraft>) => void;
}) {
  return (
    <div className="space-y-1.5">
      {participants.map((participant, index) => (
        <div key={index} className="flex items-center gap-1.5">
          <input
            type="color"
            aria-label={`Participant ${index + 1} color`}
            value={participant.color}
            onChange={(e) => onChange(index, { color: e.target.value })}
            className="civ-color-chip h-7 w-7 flex-none cursor-pointer rounded border border-[oklch(0.24_0.008_240)] bg-transparent p-0.5"
            title={`Color for ${participant.name || `Civ ${index + 1}`}`}
          />
          <Input
            aria-label={`Participant ${index + 1} name`}
            value={participant.name}
            onChange={(e) => onChange(index, { name: e.target.value })}
            placeholder={`Civ ${index + 1}`}
            className="flex-1"
          />
          <select
            aria-label={`Participant ${index + 1} model`}
            value={participant.model}
            onChange={(e) => onChange(index, { model: e.target.value })}
            className="civ-select flex-1"
          >
            {models.length ? (
              models.map((m) => <option key={m} value={m}>{m}</option>)
            ) : (
              <option value="" disabled>No models available</option>
            )}
          </select>
          {participants.length > 1 && (
            <button
              type="button"
              aria-label={`Remove participant ${index + 1}`}
              onClick={() => onRemove(index)}
              className="flex-none rounded p-1 text-[oklch(0.44_0.012_230)] hover:text-[oklch(0.78_0.055_28)]"
              title="Remove civilization"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      ))}
      <Button
        size="xs"
        variant="outline"
        className="w-full"
        disabled={participants.length >= MAX_PARTICIPANTS}
        onClick={onAdd}
      >
        <Plus className="h-3.5 w-3.5" />
        Add civilization
      </Button>
    </div>
  );
}

function Section({ label, icon, children }: { label: string; icon: ReactNode; children: ReactNode }) {
  return (
    <section className="civ-section">
      <div className="civ-section-title">{icon}{label}</div>
      {children}
    </section>
  );
}

function DrawerHeader({ title, icon, onClose }: { title: string; icon: ReactNode; onClose: () => void }) {
  return (
    <div className="civ-drawer-head">
      <span className="flex items-center gap-1.5">{icon}{title}</span>
      <button type="button" onClick={onClose} className="opacity-70 hover:opacity-100" title="Close"><X className="h-3.5 w-3.5" /></button>
    </div>
  );
}

function Metric({ icon, label, value, tone = false }: { icon: ReactNode; label: string; value: string; tone?: boolean }) {
  return (
    <div className={["civ-metric", tone ? "civ-metric-tone" : ""].join(" ")}>
      {icon}
      <span className="civ-metric-label">{label}</span>
      <span className="civ-metric-value">{value}</span>
    </div>
  );
}

function ObjectiveStrip({ status }: { status: MvpStatus }) {
  return (
    <div className={["civ-objective-strip", `is-${status.state}`].join(" ")}>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[10px] font-semibold uppercase tracking-[0.12em]">{status.label}</span>
        <span className="text-[10px] tabular-nums">{Math.round(status.progress)}%</span>
      </div>
      <div className="civ-progress">
        <div className="civ-progress-fill" style={{ width: `${status.progress}%` }} />
      </div>
    </div>
  );
}

function ControlStateStrip({ mode, name, detail }: { mode: "manual" | "codex"; name: string; detail: string }) {
  const Icon = mode === "codex" ? Bot : Gamepad2;
  return (
    <div className={["civ-control-strip", `is-${mode}`].join(" ")} aria-label="Current driver">
      <Icon className="h-3.5 w-3.5" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[10px] font-semibold uppercase tracking-[0.12em]">{name}</div>
        <div className="truncate text-[10.5px]">{detail}</div>
      </div>
    </div>
  );
}

function PlayerTaskStrip({ task }: { task: CivPlayerTask }) {
  const chips = taskHudChips(task);
  return (
    <div className={["civ-task-strip", task.status === "ready" ? "is-ready" : ""].join(" ")}>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[10px] font-semibold uppercase tracking-[0.12em]">
          {taskStripLabel(task)}
        </span>
        <span className="text-[10px] tabular-nums">{taskCountLabel(task)}</span>
      </div>
      <div className="civ-task-strip-detail">{taskHudDetail(task)}</div>
      <div className="civ-progress">
        <div className="civ-progress-fill" style={{ width: `${taskProgressPercent(task)}%` }} />
      </div>
      {chips.length > 0 && (
        <div className="civ-task-strip-chips" aria-label="Active task details">
          {chips.map((chip) => <span key={chip}>{chip}</span>)}
        </div>
      )}
    </div>
  );
}

function PlayerTaskCompleteStrip({ summary }: { summary: CompletedTaskSummary }) {
  return (
    <div className="civ-task-complete-strip">
      <Sparkles className="h-3.5 w-3.5" />
      <div className="min-w-0">
        <div className="text-[10px] font-semibold uppercase tracking-[0.12em]">Task complete</div>
        <div className="truncate text-[10.5px]">{summary.detail}</div>
      </div>
    </div>
  );
}

function PilotReadoutChips({ readout }: { readout: PilotReadout }) {
  const chips = [
    `Step ${readout.step}`,
    readout.action,
    readout.tool,
    readout.target,
    readout.tile,
    readout.distance,
  ].filter(Boolean);
  return (
    <div className="civ-pilot-chips">
      {chips.map((chip) => <span key={chip}>{chip}</span>)}
    </div>
  );
}

function pilotReadoutForDecision(decision: CivPilotDecision, step: number): PilotReadout {
  const target = decision.action === "move" || decision.action === "interact" ? decision.target : null;
  return {
    label: decision.label,
    action: pilotDecisionActionLabel(decision),
    tool: pilotDecisionToolLabel(decision),
    target: pilotTargetLabel(target),
    tile: pilotTargetTileLabel(target),
    distance: typeof target?.distance === "number" ? `${Math.round(target.distance)}px` : "",
    step,
  };
}

function pilotDecisionActionLabel(decision: CivPilotDecision) {
  if (decision.action === "move") return "Move";
  if (decision.action === "interact") return "Interact";
  if (decision.action === "explore") return "Explore";
  if (decision.action === "advance_turn") return "Turn";
  return "Possess";
}

function pilotDecisionToolLabel(decision: CivPilotDecision) {
  if (decision.action !== "interact") return "";
  if (decision.tool === "mine") return "Mine";
  if (decision.tool === "build") return "Build";
  return "Use";
}

function playerToolLabel(tool: PlayerTool) {
  if (tool === "mine") return "Mine";
  if (tool === "build") return "Build";
  return "Use";
}

function pilotTargetLabel(target: CivPilotTarget | null | undefined) {
  if (!target) return "";
  return target.label || target.targetId || target.kind;
}

function pilotTargetTileLabel(target: CivPilotTarget | null | undefined) {
  if (!target) return "";
  const x = typeof target.tileX === "number" ? target.tileX : Math.floor(target.x / 16);
  const y = typeof target.tileY === "number" ? target.tileY : Math.floor(target.y / 16);
  return `tile ${x},${y}`;
}

function MvpPanel({ status }: { status: MvpStatus }) {
  return (
    <div className={["civ-mvp-panel", `is-${status.state}`].join(" ")}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-[oklch(0.86_0.018_220)]">{status.label}</span>
        <span className="text-xs tabular-nums text-[oklch(0.74_0.020_220)]">{Math.round(status.progress)}%</span>
      </div>
      <div className="mt-2 civ-progress">
        <div className="civ-progress-fill" style={{ width: `${status.progress}%` }} />
      </div>
      <div className="mt-2 text-[11px] leading-relaxed text-[oklch(0.58_0.014_225)]">{status.detail}</div>
    </div>
  );
}

function PlayerPanel({
  axos,
  selectedId,
  possessedId,
  message,
  task,
  pilotEnabled,
  pilotGoal,
  pilotStatus,
  onSelect,
  onPossess,
  onRelease,
  onPilotGoalChange,
  onTogglePilot,
}: {
  axos: CivEntity[];
  selectedId: string;
  possessedId: string | null;
  message: string | null;
  task: CivPlayerTask | null;
  pilotEnabled: boolean;
  pilotGoal: CivPilotGoal;
  pilotStatus: string;
  onSelect: (id: string) => void;
  onPossess: () => void;
  onRelease: () => void;
  onPilotGoalChange: (goal: CivPilotGoal) => void;
  onTogglePilot: () => void;
}) {
  const selected = axos.find((entity) => entity.id === selectedId) ?? null;
  if (axos.length === 0) {
    return <div className="text-xs text-[oklch(0.52_0.012_225)]">No playable axolotls.</div>;
  }
  return (
    <div className="space-y-2">
      <select
        value={selectedId}
        onChange={(event) => onSelect(event.target.value)}
        className="civ-select"
        title="Choose player axolotl"
      >
        {axos.map((entity) => (
          <option key={entity.id} value={entity.id}>
            {entity.name} · {entity.morph || "leucistic"} · {STAGE_LABEL[entity.stage ?? "adult"] ?? entity.stage}
          </option>
        ))}
      </select>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant={possessedId ? "outline" : "default"}
          className="flex-1"
          title="WASD or arrows move; Shift or Q bursts; Tab cycles target; E or Space interacts"
          onClick={(event) => {
            event.currentTarget.blur();
            if (possessedId) onRelease();
            else onPossess();
          }}
        >
          <Gamepad2 className="h-3.5 w-3.5" />
          {possessedId ? "Release" : "Possess"}
        </Button>
        {selected && (
          <button
            type="button"
            className="civ-player-focus"
            title="Focus selected axolotl"
            onClick={() => {
              if (possessedId !== selected.id) onSelect(selected.id);
              setTimeout(() => window.civCamera?.recenter(), 0);
            }}
          >
            <LocateFixed className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {selected && (
        <div className="civ-player-card">
          <img src={`/civ/axolotls/axo-${selected.morph || "leucistic"}.png`} alt="" className="civ-player-img" />
          <div className="min-w-0">
            <div className="truncate text-xs font-semibold text-[oklch(0.86_0.016_220)]">{selected.name}</div>
            <div className="truncate text-[10px] text-[oklch(0.56_0.012_225)]">
              {selected.morph || "leucistic"} · {selected.role || "citizen"} · {formatScore(selected.health)} hp
            </div>
          </div>
        </div>
      )}
      <div className={["civ-pilot-card", pilotEnabled ? "is-active" : ""].join(" ")}>
        <div className="flex items-center gap-2">
          <span className="civ-pilot-mark"><Bot className="h-3.5 w-3.5" /></span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-semibold text-[oklch(0.86_0.016_220)]">
              {pilotEnabled ? "Codex pilot running" : "Codex pilot"}
            </div>
            <div className="truncate text-[10px] text-[oklch(0.56_0.012_225)]">{pilotStatus}</div>
          </div>
          <Button size="xs" variant={pilotEnabled ? "outline" : "default"} onClick={onTogglePilot}>
            {pilotEnabled ? "Stop" : "Watch"}
          </Button>
        </div>
        <select
          value={pilotGoal}
          onChange={(event) => onPilotGoalChange(event.target.value as CivPilotGoal)}
          className="civ-select mt-2"
          title="Codex pilot goal"
        >
          {PILOT_GOALS.map((goal) => <option key={goal.value} value={goal.value}>{goal.label}</option>)}
        </select>
      </div>
      {task && <PlayerTaskPanel task={task} />}
      {message && <div className="civ-player-message">{message}</div>}
    </div>
  );
}

function PlayerTaskPanel({ task }: { task: CivPlayerTask }) {
  return (
    <div className={["civ-task-panel", task.status === "ready" ? "is-ready" : ""].join(" ")}>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs font-semibold text-[oklch(0.86_0.018_220)]">
          {taskPanelTitle(task)}
        </span>
        <span className="text-[10px] tabular-nums text-[oklch(0.66_0.030_175)]">{taskCountLabel(task)}</span>
      </div>
      <div className="mt-1 text-[11px] leading-relaxed text-[oklch(0.60_0.014_225)]">
        {taskPanelBody(task)}
      </div>
      <div className="mt-2 civ-progress">
        <div className="civ-progress-fill" style={{ width: `${taskProgressPercent(task)}%` }} />
      </div>
    </div>
  );
}

function taskStripLabel(task: CivPlayerTask) {
  if (task.kind === "visit_building") return `Check ${task.buildingName}`;
  if (task.kind === "repair_object") return task.status === "ready" ? `Seal nest leak` : `Gather leak patch ${resourceLabel(task.resource)}`;
  if (task.kind === "rescue_object") return task.status === "ready" ? `Rescue ${task.objectName}` : `Mine low-O2 rubble`;
  if (task.kind === "build_bridge") return task.status === "ready" ? `Bridge built` : `Build through silt`;
  if (task.status === "ready") return task.kind === "trade_resource" ? `Return to trade` : `Return to ${task.npcName}`;
  return task.kind === "trade_resource"
    ? `${task.npcName} trades for ${resourceLabel(task.resource)}`
    : `${task.npcName} needs ${resourceLabel(task.resource)}`;
}

function taskPanelTitle(task: CivPlayerTask) {
  if (task.kind === "visit_building") return "Building check";
  if (task.kind === "repair_object") return task.status === "ready" ? "Ready to seal leak" : "Nest leak";
  if (task.kind === "rescue_object") return task.status === "ready" ? "Ready to rescue" : "Low oxygen rescue";
  if (task.kind === "build_bridge") return task.status === "ready" ? "Bridge complete" : "Bridge hazard";
  if (task.kind === "trade_resource") return task.status === "ready" ? "Ready to trade" : "NPC trade";
  return task.status === "ready" ? "Ready to deliver" : "NPC request";
}

function taskPanelBody(task: CivPlayerTask) {
  if (task.kind === "visit_building") {
    return `${task.npcName} asked you to check ${task.buildingName}. Use the building to report back.`;
  }
  if (task.kind === "repair_object") {
    if (task.status === "ready") {
      return `${task.npcName} asked you to repair ${task.objectName}. Use the marked object to seal the nest leak.`;
    }
    return `${task.npcName} asked you to repair ${task.objectName}. Gather ${task.amount} ${resourceLabel(task.resource)} first. The leak plume slows movement near the marker until sealed.`;
  }
  if (task.kind === "rescue_object") {
    if (task.status === "ready") {
      return `${task.npcName} asked you to rescue ${task.objectName}. Use the marked object now that the rubble is clear and the oxygen pocket is behind you.`;
    }
    return `${task.npcName} asked you to rescue ${task.objectName}. Mine ${task.remaining} blocked tile${task.remaining === 1 ? "" : "s"} around the marker. Watch oxygen and retreat out of the pocket when low.`;
  }
  if (task.kind === "build_bridge") {
    if (task.status === "ready") {
      return `${task.npcName} asked you to build ${task.objectName}. The crossing is ready and the silt vent is sealed.`;
    }
    return `${task.npcName} asked you to build ${task.objectName}. Place ${task.remaining} bridge tile${task.remaining === 1 ? "" : "s"} with Build. The silt plume slows movement until the crossing is sealed.`;
  }
  if (task.kind === "trade_resource") {
    if (task.status === "ready") {
      return `Return to ${task.npcName} to trade ${task.amount} ${resourceLabel(task.resource)} for ${task.rewardAmount} ${resourceLabel(task.rewardResource)}.`;
    }
    return `${task.npcName} offers ${task.rewardAmount} ${resourceLabel(task.rewardResource)} for ${task.amount} ${resourceLabel(task.resource)}. Gather ${resourceLabel(task.sourceResource)} and come back.`;
  }
  return task.status === "ready"
    ? `Return to ${task.npcName} with ${resourceLabel(task.resource)}.`
    : `${task.npcName} asked for ${task.amount} ${resourceLabel(task.resource)}. Gather ${resourceLabel(task.sourceResource)} and come back.`;
}

function taskHudDetail(task: CivPlayerTask) {
  if (task.kind === "visit_building") return `Use ${task.buildingName} for ${task.npcName}.`;
  if (task.kind === "repair_object") {
    return task.status === "ready"
      ? `Use ${task.objectName} to seal the leak.`
      : `Gather ${task.remaining} ${resourceLabel(task.resource)} for ${task.objectName}; avoid the leak plume.`;
  }
  if (task.kind === "rescue_object") {
    return task.status === "ready"
      ? `Use ${task.objectName} now that the rubble is clear.`
      : `Mine ${task.remaining} rubble tile${task.remaining === 1 ? "" : "s"} near ${task.objectName}; retreat if oxygen drops.`;
  }
  if (task.kind === "build_bridge") {
    return task.status === "ready"
      ? `${task.objectName} is built and the vent is sealed.`
      : `Place ${task.remaining} bridge tile${task.remaining === 1 ? "" : "s"} through the silt.`;
  }
  if (task.kind === "trade_resource") {
    return task.status === "ready"
      ? `Return to ${task.npcName} to trade for ${resourceLabel(task.rewardResource)}.`
      : `Gather ${task.amount} ${resourceLabel(task.resource)} for ${task.npcName}.`;
  }
  return task.status === "ready"
    ? `Return to ${task.npcName} with ${resourceLabel(task.resource)}.`
    : `Gather ${task.remaining} ${resourceLabel(task.resource)} for ${task.npcName}.`;
}

function taskHudChips(task: CivPlayerTask) {
  const target = taskHudTarget(task);
  const action = taskHudAction(task);
  const status = task.kind === "visit_building"
    ? "Use building"
    : task.status === "ready"
      ? "Ready"
      : `${task.remaining} left`;
  return Array.from(new Set([action, status, target].filter(Boolean)));
}

function taskHudAction(task: CivPlayerTask) {
  if (task.kind === "visit_building") return "Use";
  if (task.kind === "repair_object") return task.status === "ready" ? "Seal" : "Mine";
  if (task.kind === "rescue_object") return task.status === "ready" ? "Rescue" : "Mine";
  if (task.kind === "build_bridge") return task.status === "ready" ? "Done" : "Build";
  if (task.kind === "trade_resource") return task.status === "ready" ? "Trade" : "Gather";
  return task.status === "ready" ? "Deliver" : "Gather";
}

function taskHudTarget(task: CivPlayerTask) {
  if (task.kind === "visit_building") return task.buildingName;
  if (task.kind === "repair_object" || task.kind === "rescue_object" || task.kind === "build_bridge") return task.objectName;
  return task.npcName;
}

function taskNpcMessage(task: CivPlayerTask, label: string) {
  if (task.kind === "visit_building") return `${label} wants ${task.buildingName} checked.`;
  if (task.kind === "repair_object") {
    return task.status === "ready"
      ? `${label} points you to ${task.objectName} and the leak.`
      : `${label} still needs ${task.remaining} ${resourceLabel(task.resource)} before the leak can be sealed.`;
  }
  if (task.kind === "rescue_object") {
    return task.status === "ready"
      ? `${label} says ${task.objectName} is reachable and the pocket is safe to leave.`
      : `${label} still needs ${task.remaining} rubble cleared. Watch the low-oxygen pocket.`;
  }
  if (task.kind === "build_bridge") {
    return task.status === "ready"
      ? `${label} says ${task.objectName} is built and the vent is sealed.`
      : `${label} still needs ${task.remaining} bridge tile${task.remaining === 1 ? "" : "s"} through the silt plume.`;
  }
  if (task.status !== "ready") return `${label} still needs ${task.remaining} ${resourceLabel(task.resource)}.`;
  if (task.kind === "trade_resource") {
    return `Traded ${resourceLabel(task.resource)} with ${label} for ${resourceLabel(task.rewardResource)}.`;
  }
  return `Delivered ${resourceLabel(task.resource)} to ${label}.`;
}

function taskResourceGatherMessage(task: CivPlayerTask, gained: string, nextProgress: number) {
  if (task.kind === "repair_object") {
    return nextProgress >= task.amount
      ? `Patch ready for ${task.objectName}. Use ${task.objectName} to seal the leak.`
      : `Gathered ${resourceLabel(gained)} for ${task.objectName} (${nextProgress}/${task.amount}).`;
  }
  if (task.kind === "trade_resource") {
    if (nextProgress >= task.amount) {
      const reward = task.rewardResource ? resourceLabel(task.rewardResource) : "the reward";
      return `Trade ready for ${task.npcName}. Return to trade ${resourceLabel(task.resource)} for ${reward}.`;
    }
    return `Gathered ${resourceLabel(gained)} for ${task.npcName}'s trade (${nextProgress}/${task.amount}).`;
  }
  return nextProgress >= task.amount
    ? `Delivery ready for ${task.npcName}. Return with ${resourceLabel(task.resource)}.`
    : `Gathered ${resourceLabel(gained)} for ${task.npcName} (${nextProgress}/${task.amount}).`;
}

function taskReadyResourceMessage(task: CivPlayerTask) {
  if (task.kind === "repair_object") return `Patch ready for ${task.objectName}. Use ${task.objectName} to seal the leak.`;
  if (task.kind === "trade_resource") {
    const reward = task.rewardResource ? resourceLabel(task.rewardResource) : "the reward";
    return `Trade ready for ${task.npcName}. Return to trade ${resourceLabel(task.resource)} for ${reward}.`;
  }
  return `Delivery ready for ${task.npcName}. Return with ${resourceLabel(task.resource)}.`;
}

function playerToolFromHotkey(event: KeyboardEvent): PlayerTool | null {
  if (event.code === "Digit1" || event.code === "Numpad1" || event.code === "KeyU") return "use";
  if (event.code === "Digit2" || event.code === "Numpad2" || event.code === "KeyM") return "mine";
  if (event.code === "Digit3" || event.code === "Numpad3" || event.code === "KeyB") return "build";
  return null;
}

function isTextEntryTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest("input, textarea, select, [contenteditable='true'], [role='textbox']"));
}

function playerToolForTask(task: CivPlayerTask): PlayerTool {
  if (task.kind === "repair_object" && task.status !== "ready") return "mine";
  if (task.kind === "rescue_object" && task.status !== "ready") return "mine";
  if (task.kind === "build_bridge" && task.status !== "ready") return "build";
  return "use";
}

function isRescueRubbleInteraction(
  snapshot: CivSessionSnapshot | null,
  task: CivPlayerTask | null,
  interaction: PlayerInteraction,
) {
  if (!snapshot || task?.kind !== "rescue_object" || task.status === "ready") return false;
  const object = snapshot.world.entities.find((entity) => entity.id === task.objectId);
  if (!object) return false;
  const tileX = interaction.tileX ?? Math.floor(interaction.x / 16);
  const tileY = interaction.tileY ?? Math.floor(interaction.y / 16);
  return rescueRubbleTiles(object.x, object.y).some((tile) => tile.x === tileX && tile.y === tileY);
}

function rescueRubbleTiles(x: number, y: number) {
  const shaftX = Math.max(0, x - 1);
  const shaftTop = Math.max(7, y - 3);
  const tiles = [];
  for (let tileY = shaftTop; tileY <= y; tileY += 1) {
    tiles.push({ x: shaftX, y: tileY });
  }
  tiles.push({ x, y: y + 1 });
  return tiles;
}

function taskCountLabel(task: CivPlayerTask) {
  return task.kind === "visit_building" ? "use" : `${Math.min(task.amount, task.progress)}/${task.amount}`;
}

function taskProgressPercent(task: CivPlayerTask) {
  if (task.kind === "visit_building") return 35;
  if (task.amount <= 0) return 0;
  return Math.min(100, (task.progress / task.amount) * 100);
}

function ScorePanel({ civ }: { civ: CivCivilization | null }) {
  const score = civ?.score ?? { survival: 0, ethics: 0, intelligence: 0, total: 0 };
  return (
    <div className="space-y-2">
      <div className="flex items-end justify-between">
        <span className="text-3xl font-semibold tabular-nums text-[oklch(0.84_0.050_175)]">{formatScore(score.total)}</span>
        <span className="pb-1 text-[11px] text-[oklch(0.50_0.012_225)]">total</span>
      </div>
      <ScoreBar label="Survival" value={score.survival ?? 0} tone="oklch(0.70 0.070 155)" />
      <ScoreBar label="Ethics" value={score.ethics ?? 0} tone="oklch(0.74 0.055 190)" />
      <ScoreBar label="Intelligence" value={score.intelligence ?? 0} tone="oklch(0.76 0.060 285)" />
    </div>
  );
}

function ColonyPanel({ snapshot, onEquip }: { snapshot: CivSessionSnapshot; onEquip: (entityId: string, accessory: string, equip: boolean) => void }) {
  const axos = snapshot.world.entities.filter((e) => e.kind === "axolotl");
  const eggCount = snapshot.world.entities.filter((e) => e.kind === "egg").length;
  const stageCount = (s: string) => axos.filter((a) => (a.stage ?? "adult") === s).length;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        <StageChip label="Eggs" n={eggCount} tone="oklch(0.74 0.06 80)" />
        <StageChip label="Hatch" n={stageCount("hatchling")} tone="oklch(0.78 0.07 20)" />
        <StageChip label="Juv" n={stageCount("juvenile")} tone="oklch(0.78 0.07 150)" />
        <StageChip label="Adult" n={stageCount("adult")} tone="oklch(0.78 0.06 200)" />
        <StageChip label="Elder" n={stageCount("elder")} tone="oklch(0.72 0.04 285)" />
      </div>
      <div className="civ-roster">
        {axos.length === 0 ? (
          <div className="text-xs text-[oklch(0.52_0.012_225)]">No axolotls yet.</div>
        ) : (
          axos.map((a) => <RosterRow key={a.id} a={a} onEquip={onEquip} />)
        )}
      </div>
    </div>
  );
}

function RegionsPanel({ snapshot }: { snapshot: CivSessionSnapshot }) {
  const regions = snapshot.world.regions ?? [];
  // the colony's home: the region whose x-range contains the pond-heart / nest
  const heart = snapshot.world.entities.find((e) => e.role === "pond")
    ?? snapshot.world.entities.find((e) => e.role === "nest");
  const homeId = heart
    ? regions.find((r) => heart.x >= r.x && heart.x < r.x + r.width)?.id
    : undefined;

  if (regions.length === 0) {
    return <div className="text-xs text-[oklch(0.52_0.012_225)]">No regions mapped yet.</div>;
  }
  return (
    <div className="civ-region-list">
      {regions.map((region) => (
        <RegionRow key={region.id} region={region} isHome={region.id === homeId} />
      ))}
    </div>
  );
}

function RegionRow({ region, isHome }: { region: CivRegion; isHome: boolean }) {
  const accent = biomeAccent(region.biome);
  return (
    <button
      type="button"
      className={["civ-region-row", isHome ? "is-home" : ""].join(" ")}
      onClick={() => window.civCamera?.focusRegion(region.x, region.width)}
      title={`Focus ${region.name}`}
    >
      <span className="civ-biome-chip" style={{ background: `color-mix(in oklch, ${accent} 22%, transparent)`, borderColor: `color-mix(in oklch, ${accent} 45%, transparent)`, color: accent }}>
        {biomeLabel(region.biome)}
      </span>
      <span className="min-w-0 flex-1 truncate text-left text-[11px] font-semibold text-[oklch(0.84_0.016_220)]">{region.name}</span>
      {isHome && <span className="civ-region-home">Home</span>}
    </button>
  );
}

function RosterRow({ a, onEquip }: { a: CivEntity; onEquip: (entityId: string, accessory: string, equip: boolean) => void }) {
  const [acc, setAcc] = useState(ACCESSORIES[0]);
  const morph = a.morph || "leucistic";
  const sex = a.sex === "f" ? "♀" : a.sex === "m" ? "♂" : "—";
  const worn = a.accessories ?? [];
  return (
    <div className="civ-roster-row">
      <img src={`/civ/axolotls/axo-${morph}.png`} alt={morph} className="civ-roster-img" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[11px] font-semibold text-[oklch(0.86_0.016_220)]">{a.name}</div>
        <div className="truncate text-[10px] text-[oklch(0.56_0.012_225)]">
          {morph} · {sex} · {STAGE_LABEL[a.stage ?? "adult"] ?? a.stage} · {a.age ?? 0}t
        </div>
        {worn.length > 0 && (
          <div className="mt-0.5 flex flex-wrap gap-1">
            {worn.map((w) => (
              <button key={w} type="button" className="civ-acc-chip" title={`Remove ${w}`} onClick={() => onEquip(a.id, w, false)}>
                {w} <X className="h-2.5 w-2.5" />
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="flex flex-none items-center gap-1">
        <select value={acc} onChange={(e) => setAcc(e.target.value)} className="civ-roster-select" title="Accessory">
          {ACCESSORIES.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <button type="button" className="civ-roster-equip" title={`Equip ${acc}`} onClick={() => onEquip(a.id, acc, true)}>
          <Plus className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

function StageChip({ label, n, tone }: { label: string; n: number; tone: string }) {
  return (
    <span className="civ-stage-chip" style={{ borderColor: `color-mix(in oklch, ${tone} 40%, transparent)` }}>
      {label} <b style={{ color: tone }}>{n}</b>
    </span>
  );
}

function ResourcesPanel({ civ }: { civ: CivCivilization | null }) {
  const resources = civ?.resources ?? {};
  return (
    <div className="grid grid-cols-2 gap-1.5">
      {RESOURCES.map((item) => (
        <div key={item} className="rounded-md border border-[oklch(0.24_0.008_240)] bg-[oklch(0.10_0.004_245)]/70 px-2 py-1.5">
          <div className="text-[10px] uppercase tracking-[0.10em] text-[oklch(0.48_0.012_225)]">{resourceLabel(item)}</div>
          <div className="mt-0.5 text-sm font-semibold tabular-nums text-[oklch(0.85_0.018_220)]">{resources[item] ?? 0}</div>
        </div>
      ))}
    </div>
  );
}

function ModifiersPanel({ modifiers }: { modifiers: CivModifier[] }) {
  if (modifiers.length === 0) return <div className="text-xs text-[oklch(0.52_0.012_225)]">No active modifiers.</div>;
  return (
    <div className="space-y-1.5">
      {modifiers.map((item) => (
        <div key={item.id} className="flex items-center justify-between gap-2 rounded-md border border-[oklch(0.24_0.008_240)] bg-[oklch(0.10_0.004_245)]/70 px-2 py-1.5">
          <div className="min-w-0">
            <div className={["truncate text-xs font-semibold", item.polarity === "buff" ? "text-[oklch(0.76_0.060_155)]" : "text-[oklch(0.78_0.065_45)]"].join(" ")}>
              {item.label}
            </div>
            <div className="text-[10px] text-[oklch(0.48_0.012_225)]">{item.polarity}</div>
          </div>
          <span className="text-xs tabular-nums text-[oklch(0.62_0.018_220)]">{item.remaining_turns}t</span>
        </div>
      ))}
    </div>
  );
}

function LogPanel({ entries }: { entries: CivLogEntry[] }) {
  if (entries.length === 0) return <div className="text-xs text-[oklch(0.52_0.012_225)]">No events yet.</div>;
  return (
    <div className="space-y-2">
      {entries.map((entry, index) => (
        <article key={`${entry.created_at}-${index}`} className="rounded-md border border-[oklch(0.24_0.008_240)] bg-[oklch(0.10_0.004_245)]/70 px-2.5 py-2">
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="truncate text-xs font-semibold text-[oklch(0.85_0.018_220)]">{entry.title}</span>
            <span className="text-[10px] tabular-nums text-[oklch(0.44_0.012_225)]">T{entry.turn}</span>
          </div>
          <p className="text-[11px] leading-relaxed text-[oklch(0.58_0.014_225)]">{cleanCivLogBody(entry)}</p>
        </article>
      ))}
    </div>
  );
}

function ScoreBar({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[11px]">
        <span className="text-[oklch(0.60_0.014_225)]">{label}</span>
        <span className="tabular-nums text-[oklch(0.74_0.020_220)]">{formatScore(value)}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-[oklch(0.20_0.006_240)]">
        <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: tone }} />
      </div>
    </div>
  );
}

function getMvpStatus(snapshot: CivSessionSnapshot, civ: CivCivilization | null): MvpStatus {
  if (!civ || !civ.alive || civ.population <= 0) {
    return {
      label: "Colony collapsed",
      detail: "The current colony has no stable playable loop until a living axolotl returns.",
      progress: Math.min(100, (snapshot.turn / MVP_TARGET_TURN) * 100),
      state: "collapsed",
    };
  }
  const progress = Math.max(0, Math.min(100, (snapshot.turn / MVP_TARGET_TURN) * 100));
  const food = civ.resources.food ?? 0;
  const water = civ.resources.clean_water ?? 0;
  const lowStores = food < Math.max(6, civ.population) || water < Math.max(6, civ.population);
  const health = civ.health ?? 0;
  const morale = civ.morale ?? 0;
  const fragile = health < 35 || morale < 35 || lowStores;
  if (snapshot.turn >= MVP_TARGET_TURN && !fragile) {
    return {
      label: "MVP loop stable",
      detail: `Survived ${MVP_TARGET_TURN} turns with a living colony, active resources, and playable possession.`,
      progress: 100,
      state: "stable",
    };
  }
  if (fragile) {
    return {
      label: "Survival risk",
      detail: lowStores
        ? "Food or clean water is below the near-term population buffer."
        : "Health or morale is low enough that the colony may fail before the MVP target.",
      progress,
      state: "risk",
    };
  }
  return {
    label: `Survive ${MVP_TARGET_TURN} turns`,
    detail: "Core loop is running: turns advance, AI decisions apply, resources change, and possession is available.",
    progress,
    state: "building",
  };
}

function recentCompletedTaskSummary(snapshot: CivSessionSnapshot): CompletedTaskSummary | null {
  const entry = [...(snapshot.log ?? [])]
    .reverse()
    .find((item) => item.kind === "player" && item.title === "Task complete");
  if (!entry || snapshot.turn - entry.turn > 2) return null;
  return { detail: cleanCivLogBody(entry).replace(/;$/, "") };
}

function playerResourceTarget(resource: string) {
  if (resource === "moss") return "food";
  return resource;
}

function tileLabel(x: number, y: number) {
  return `${Math.floor(x / 16)},${Math.floor(y / 16)}`;
}

function isBrowserPreviewCiv() {
  return typeof window !== "undefined" && window.__XOLOTL_BROWSER_PREVIEW__ === true;
}

function snapshotWithEntityTile(snapshot: CivSessionSnapshot, entityId: string, tileX: number, tileY: number): CivSessionSnapshot {
  return {
    ...snapshot,
    updated_at: Math.max(snapshot.updated_at, Math.floor(Date.now() / 1000)),
    world: {
      ...snapshot.world,
      entities: snapshot.world.entities.map((entity) => (
        entity.id === entityId
          ? { ...entity, x: tileX, y: tileY, activity: "player" }
          : entity
      )),
    },
  };
}

function readCivPlayerSessionState(sessionId: string): PersistedCivPlayerSessionState | null {
  const state = readCivPlayerSessionMap()[sessionId];
  if (!isLocalRecord(state)) return null;
  const playerTool = PLAYER_TOOLS.includes(state.playerTool as PlayerTool) ? state.playerTool as PlayerTool : "use";
  const pilotGoal = PILOT_GOALS.some((goal) => goal.value === state.pilotGoal) ? state.pilotGoal as CivPilotGoal : "task";
  return {
    possessedEntityId: typeof state.possessedEntityId === "string" ? state.possessedEntityId : null,
    playerTool,
    pilotGoal,
    codexPilot: state.codexPilot === true,
    playerTileX: finiteNumberOrUndefined(state.playerTileX),
    playerTileY: finiteNumberOrUndefined(state.playerTileY),
    updatedAt: typeof state.updatedAt === "number" && Number.isFinite(state.updatedAt) ? state.updatedAt : 0,
  };
}

function writeCivPlayerSessionState(sessionId: string, state: PersistedCivPlayerSessionState) {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    const stateMap = readCivPlayerSessionMap();
    stateMap[sessionId] = state;
    window.localStorage.setItem(CIV_PLAYER_SESSION_STORAGE_KEY, JSON.stringify(stateMap));
  } catch {
    // UI continuity is best-effort and should never block gameplay.
  }
}

function readCivPlayerSessionMap(): Record<string, unknown> {
  if (typeof window === "undefined" || !window.localStorage) return {};
  try {
    const raw = window.localStorage.getItem(CIV_PLAYER_SESSION_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return isLocalRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function isLocalRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumberOrUndefined(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function formatScore(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  return value.toFixed(value >= 10 ? 0 : 1);
}

function resourceLabel(value: string) {
  return value.replace(/_/g, " ");
}

function modifierLabel(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// "reedmarsh" → "Reed Marsh", "openwater" → "Open Water"
const BIOME_LABEL: Record<string, string> = {
  shallows: "Shallows",
  reedmarsh: "Reed Marsh",
  mudflats: "Mudflats",
  kelpforest: "Kelp Forest",
  openwater: "Open Water",
  deeptrench: "Deep Trench",
  crystalcave: "Crystal Caverns",
  thermalvent: "Thermal Vents",
  coralreef: "Coral Reef",
  glacier: "Glacier Shelf",
  volcanic: "Volcanic Rift",
  bog: "Sunken Bog",
  saltflats: "Salt Flats",
  abyss: "The Abyss",
};

function biomeLabel(value: string) {
  return BIOME_LABEL[value] ?? value.replace(/\b\w/g, (c) => c.toUpperCase());
}

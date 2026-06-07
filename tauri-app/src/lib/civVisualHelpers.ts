export const CIV_WATER_FLOOR_Y = 50;
export const GREY_TINT = 0x888888;

function lighten(color: number, t: number): number {
  const f = Math.max(0, Math.min(1, t));
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  const blend = (c: number) => Math.round(c + (0xff - c) * f);
  return (blend(r) << 16) | (blend(g) << 8) | blend(b);
}

export function hexToTint(hex: string | null | undefined): number {
  if (!hex) return 0xffffff;
  const h = hex.replace(/^#/, "");
  if (h.length !== 3 && h.length !== 6) return 0xffffff;
  if (!/^[0-9a-fA-F]+$/.test(h)) return 0xffffff;
  const expanded = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = Number.parseInt(expanded, 16);
  return Number.isFinite(n) ? n : 0xffffff;
}

export function buildCivColorMap(
  civs: { id?: string; color?: string; alive?: boolean }[] | undefined,
): Map<string, { tint: number; alive: boolean }> {
  const m = new Map<string, { tint: number; alive: boolean }>();
  for (const c of civs ?? []) {
    if (!c.id) continue;
    m.set(c.id, { tint: hexToTint(c.color), alive: c.alive !== false });
  }
  return m;
}

export function civTintFor(
  info: { tint: number; alive: boolean } | undefined,
  grey: number = GREY_TINT,
): number | null {
  if (!info) return null;
  return info.alive ? lighten(info.tint, 0.5) : grey;
}

export function regionOverlayFor(
  owner: string | null | undefined,
  map: Map<string, { tint: number; alive: boolean }>,
): { tint: number; alive: boolean } | null {
  if (!owner) return null;
  return map.get(owner) ?? null;
}

export function colonyBounds(
  colonies: { x: number; y: number; alive: boolean }[],
  pad: number,
): { x: number; y: number; w: number; h: number } | null {
  const live = colonies.filter((c) => c.alive);
  if (live.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const c of live) {
    minX = Math.min(minX, c.x);
    maxX = Math.max(maxX, c.x);
    minY = Math.min(minY, c.y);
    maxY = Math.max(maxY, c.y);
  }
  return { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
}

export function focusTarget(
  civId: string,
  civs: { id?: string; spawn_x?: number; home_region?: string }[] | undefined,
  regions: { id: string; x: number; y: number; width: number; height?: number; owner?: string | null }[] | undefined,
  entities: { civ_id?: string | null; x: number; y: number }[] | undefined,
): { tx: number; ty: number } | null {
  const civ = (civs ?? []).find((c) => c.id === civId);
  if (!civ) return null;
  if (civ.home_region) {
    const region = (regions ?? []).find((r) => r.id === civ.home_region);
    if (region) {
      return { tx: region.x + region.width / 2, ty: region.y + (region.height ?? 0) / 2 };
    }
  }
  const own = (entities ?? []).filter((e) => e.civ_id === civId);
  if (own.length > 0) {
    const sx = own.reduce((a, e) => a + e.x, 0) / own.length;
    const sy = own.reduce((a, e) => a + e.y, 0) / own.length;
    return { tx: sx, ty: sy };
  }
  if (typeof civ.spawn_x === "number") {
    return { tx: civ.spawn_x, ty: CIV_WATER_FLOOR_Y };
  }
  return null;
}

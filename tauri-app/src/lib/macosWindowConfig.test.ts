import { describe, expect, it } from "vitest";
import tauriConfig from "../../src-tauri/tauri.conf.json";

describe("macOS window configuration", () => {
  it("uses overlay chrome with an explicit traffic-light safe area", () => {
    const mainWindow = tauriConfig.app.windows[0];

    expect(mainWindow.titleBarStyle).toBe("Overlay");
    expect(mainWindow.hiddenTitle).toBe(true);
    expect(mainWindow.trafficLightPosition).toEqual({ x: 16, y: 15 });
    expect(mainWindow.minWidth).toBeGreaterThanOrEqual(720);
    expect(mainWindow.minHeight).toBeGreaterThanOrEqual(520);
  });
});

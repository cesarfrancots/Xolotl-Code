import type { CenterTab } from "../../lib/appNavigation";
import { useMacGlobalHotkey } from "../../hooks/useMacGlobalHotkey";
import { useMacNotificationRoutes } from "../../hooks/useMacNotificationRoutes";
import { useMacStatusItem } from "../../hooks/useMacStatusItem";
import { useProjectDrop } from "../../hooks/useProjectDrop";
import { useProjectOpenEvents } from "../../hooks/useProjectOpenEvents";

export function MacRuntimeBridge({
  selectCenterTab,
}: {
  selectCenterTab: (tab: CenterTab) => void;
}) {
  useProjectDrop();
  useMacGlobalHotkey();
  useMacStatusItem();
  useProjectOpenEvents();
  useMacNotificationRoutes(selectCenterTab);

  return null;
}

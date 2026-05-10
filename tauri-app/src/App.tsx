import "./styles.css";
import { SessionSidebar } from "./components/sidebar/SessionSidebar";
import { ChatPane } from "./components/chat/ChatPane";

/**
 * App root: 2-column flex layout.
 * SessionSidebar (256px fixed) + ChatPane (flex-1).
 * Per D-04 (locked): sidebar always visible, no toggle or collapse in Phase 4.
 */
export default function App() {
  return (
    <div className="h-screen w-screen flex flex-row overflow-hidden bg-[oklch(0.11_0_0)]">
      <SessionSidebar />
      <ChatPane />
    </div>
  );
}

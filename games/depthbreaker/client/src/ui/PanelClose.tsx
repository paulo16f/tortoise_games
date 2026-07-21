// Shared close (×) button for the overlay panels. Panels previously had no
// discoverable way to dismiss them (only re-pressing the hotkey or Escape, both
// invisible). Sits in the draggable header; the drag hook ignores pointerdowns
// that land on a <button>, so clicking × closes without starting a drag.

export function PanelClose({ onClose }: { onClose: () => void }) {
  return (
    <button
      onClick={onClose}
      aria-label="Close panel"
      title="Close (Esc)"
      style={{
        width: 22,
        height: 22,
        marginLeft: 8,
        flexShrink: 0,
        borderRadius: 6,
        border: "1px solid rgba(255,255,255,0.14)",
        background: "rgba(255,255,255,0.06)",
        color: "#e6e9ef",
        fontSize: 15,
        lineHeight: 1,
        cursor: "pointer",
        display: "grid",
        placeItems: "center",
      }}
    >
      ×
    </button>
  );
}

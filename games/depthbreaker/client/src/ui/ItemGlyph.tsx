// The one way an item is drawn in a slot: the Dark Fantasy pack sprite when
// mapped in ITEM_ICONS, otherwise the classic initials badge. Every grid
// (bag, stash, market, cooking, trade, HUD weapon slot) renders through this
// so a new icon drop-in lights up everywhere at once.

import { iconForItem } from "./hudIcons";
import { itemInitials } from "./itemDisplay";

export function ItemGlyph({ itemId, size = 26 }: { itemId: string; size?: number }) {
  const icon = iconForItem(itemId);
  if (icon) {
    return (
      <img
        src={icon}
        alt=""
        draggable={false}
        style={{ width: size, height: size, objectFit: "contain", filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.8))", pointerEvents: "none" }}
      />
    );
  }
  return <>{itemInitials(itemId)}</>;
}

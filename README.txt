Reality Check - Foundry VTT v13 module

Install
1. Unzip this folder into your Foundry user data path under:
   Data/modules/reality-check/
2. In Foundry, open your world as GM.
3. Go to Game Settings / Manage Modules.
4. Enable "Reality Check".
5. Reload the world if Foundry prompts you.

Use
- The panel auto-opens for the GM when the world finishes loading, if the setting is enabled.
- Click a coloured square to make a ruling using your default output mode.
- Shift-click any square to force that one result to GM-only chat.
- Drag the panel where you want it; its position is remembered.
- If you close it, use the Token controls toolbar button with the scales icon to open/focus it again.

Configure Settings
Open Game Settings / Configure Settings / Module Settings / Reality Check.
Available settings include:
- Twist Rate
- Default Output to All
- Auto-open Panel for GM
- Easiest Button Hue
- Hardest Button Hue
- Configure Colours (submenu)
- Configure Buttons (submenu)

Configure Buttons submenu
- Add or remove button values in the UI.
- Each value is the minimum d100 roll that counts as YES.
- Example: 21 means 21-100 = Yes, which is 80% Yes.
- Duplicate values are removed automatically and the list is sorted ascending when you save.
- Toggle "Show the Yes/No Threshold Number inside the UI buttons" to display yesFrom values on the panel buttons.

Notes
- This module is GM-only in practice: only the GM sees the panel or launcher.
- Tooltips use the format: "XX% Yes Reality Check; Shift-click GM only".
- Chat output shows only: Yes / Yes and... / No / No, but...

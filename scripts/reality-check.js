// Centralise the module ID and title so they never fall out of sync between
// the manifest, settings keys, CSS selectors, and user-facing strings.
const MODULE_ID = "reality-check";
const MODULE_TITLE = "Reality Check";

// These thresholds represent the minimum d100 roll that counts as YES.
// Expressed as percentages: 21 = 80% Yes, 36 = 65% Yes, 51 = 50% Yes, etc.
// Used only when the saved setting is missing or corrupt.
const DEFAULT_BUTTONS = [21, 36, 51, 66, 81];

// Tucked against the top-left so it stays out of the way by default but doesn't overlap the macro hotbar or scene controls.
const DEFAULT_PANEL_POSITION = {
  left: 20,
  top: 120,
  width: 50,
  height: "auto"
};

// Module-level reference so we can focus or reuse the panel instead of spawning a second instance when the toolbar button is clicked again.
let realityCheckApp = null;

// ApplicationV2 + HandlebarsApplicationMixin is the v13-native way to build UI panels. Composing the mixin once here lets all three classes 
// share the same base without repeating the mixin call.
const RealityCheckBase = foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2
);

// ---------------------------------------------------------------------------
// Main floating panel
// ---------------------------------------------------------------------------
class RealityCheckPanel extends RealityCheckBase {
  static DEFAULT_OPTIONS = {
    id: "reality-check-panel",
    tag: "section",
    classes: [MODULE_ID],
    position: DEFAULT_PANEL_POSITION,
    window: {
      frame: true,
      positioned: true,
      title: MODULE_TITLE,
      icon: "fa-solid fa-scale-balanced",
      // Kept non-minimizable so the GM can't accidentally collapse it mid-session and forget where the button went.
      minimizable: false,
      // Width is intentionally fixed at 50 px - the panel is just a stack of coloured squares and there's nothing to gain from resizing it.
      resizable: false
    }
  };

  static PARTS = {
    main: {
      template: `modules/${MODULE_ID}/templates/reality-check.hbs`,
      // root:true renders the template directly into the window content area rather than wrapping it in an extra div.
      root: true
    }
  };

  constructor(options = {}) {
    // Restore the panel to wherever the GM last left it. We merge the stored position under any explicitly passed options so callers 
    // can still override position if they need to (e.g. a macro that re-docks the panel).
    const storedPosition = game.settings.get(MODULE_ID, "panelPosition") ?? DEFAULT_PANEL_POSITION;
    const merged = foundry.utils.mergeObject(
      { position: storedPosition },
      options,
      { inplace: false }
    );
    super(merged);
  }

  async _prepareContext() {
    const showThreshold = game.settings.get(MODULE_ID, "showThreshold");
    // Fetch the button list once and pass it through to getHueFromYesFrom so the hue calculation doesn't re-read settings for every button.
    const buttons = getButtonThresholds();
    const { saturation, lightness } = getColorTuning();

    return {
      buttons: buttons.map((yesFrom) => ({
        yesFrom,
        // Empty string when thresholds are hidden so the button still renders at the correct size but shows no text - the colour alone 
        // communicates the likelihood to an experienced GM.
        display: showThreshold ? String(yesFrom) : "",
        hue: getHueFromYesFrom(yesFrom, buttons),
        saturation,
        lightness,
        tooltip: buildTooltip(yesFrom)
      }))
    };
  }

  async _onRender(context, options) {
    await super._onRender(context, options);

    const root = this.element;
    if (!root) return;

    // Attach click handlers here rather than using Foundry's declarative action system so we can read the shift-key state directly from the MouseEvent.
    for (const button of root.querySelectorAll(".rc-likelihood")) {
      button.addEventListener("click", async (event) => {
        const yesFrom = Number(event.currentTarget.dataset.yesFrom);
        // Shift-click forces GM-only output regardless of the default setting, giving the GM a quick override without going into settings.
        await makeRealityCheckRoll(yesFrom, { forceGmOnly: event.shiftKey });
      });
    }
  }

  _onPosition(position) {
    super._onPosition(position);
    // Persist position on every move so a browser crash or accidental close doesn't lose the GM's carefully chosen spot.
    // Height is always stored as "auto" because the panel is non-resizable - storing the resolved pixel height would fight with auto-sizing on reopen.
    void game.settings.set(MODULE_ID, "panelPosition", {
      left: position.left,
      top: position.top,
      width: position.width,
      height: "auto"
    });
  }

  _onClose(options) {
    super._onClose(options);
    // Clear the module-level reference so openRealityCheck() knows to create a fresh instance rather than trying to bring a closed window to front.
    if (realityCheckApp === this) realityCheckApp = null;
  }
}

// ---------------------------------------------------------------------------
// Button configuration dialog
// ---------------------------------------------------------------------------
class RealityCheckButtonsConfig extends RealityCheckBase {
  static DEFAULT_OPTIONS = {
    id: "reality-check-buttons-config",
    tag: "section",
    classes: [MODULE_ID, "reality-check-buttons-config"],
    position: {
      width: 320,
      height: "auto"
    },
    window: {
      frame: true,
      positioned: true,
      title: `${MODULE_TITLE} Buttons`,
      icon: "fa-solid fa-sliders",
      minimizable: false,
      resizable: false
    }
  };

  static PARTS = {
    main: {
      template: `modules/${MODULE_ID}/templates/reality-check-buttons-config.hbs`,
      root: true
    }
  };

  constructor(options = {}) {
    super(options);
    // Keep an in-progress working copy so the GM can add/remove rows freely without touching the live setting until they explicitly hit Save.
    this.values = [...getButtonThresholds()];
  }

  async _prepareContext() {
    return {
      // Index is passed alongside each value so event handlers can splice the correct entry from this.values on remove.
      rows: this.values.map((value, index) => ({ value, index })),
      showThreshold: Boolean(game.settings.get(MODULE_ID, "showThreshold"))
    };
  }

  async _onRender(context, options) {
    await super._onRender(context, options);

    const root = this.element;
    if (!root) return;

    // Adding a row pushes an empty placeholder and re-renders so the new input appears immediately, ready for the GM to type a value.
    root.querySelector('[data-action="add-row"]')?.addEventListener("click", async () => {
      this.values.push("");
      await this.render({ force: true });
    });

    root.querySelector('[data-action="save"]')?.addEventListener("click", async () => {
      await this._saveButtons();
    });

    root.querySelector('[data-action="cancel"]')?.addEventListener("click", async () => {
      await this.close();
    });

    // Mirror live input changes into this.values so the working copy stays current if the GM edits a field without tabbing away first.
    for (const input of root.querySelectorAll(".rcbc-value")) {
      input.addEventListener("input", (event) => {
        const index = Number(event.currentTarget.dataset.index);
        this.values[index] = event.currentTarget.value;
      });
    }

    for (const button of root.querySelectorAll('[data-action="remove-row"]')) {
      button.addEventListener("click", async (event) => {
        const index = Number(event.currentTarget.dataset.index);
        this.values.splice(index, 1);
        // Re-render after splice so indices in the DOM stay in sync with this.values - stale indices would cause wrong rows to be removed.
        await this.render({ force: true });
      });
    }
  }

  async _saveButtons() {
    const root = this.element;
    if (!root) return;

    // Re-read from the DOM at save time rather than relying solely on the in-memory working copy, in case any input changes weren't
    // caught by the "input" listener (e.g. autofill or paste edge cases).
    const rawValues = Array.from(root.querySelectorAll(".rcbc-value"), (input) => input.value);
    const normalized = normalizeButtonThresholds(rawValues);

    // Refuse to save an empty list — the panel would render with no buttons and there'd be no way to trigger a roll without
    // reopening this dialog.
    if (!normalized.length) {
      ui.notifications.error("Reality Check needs at least one valid button value from 1 to 100.");
      return;
    }

    const showThreshold = Boolean(root.querySelector(".rcbc-show-threshold")?.checked);

    await game.settings.set(MODULE_ID, "buttonThresholds", normalized);
    await game.settings.set(MODULE_ID, "showThreshold", showThreshold);
    ui.notifications.info("Reality Check buttons updated.");
    await this.close();
  }
}

// ---------------------------------------------------------------------------
// Colour options dialog
// ---------------------------------------------------------------------------
class RealityCheckOptionsConfig extends RealityCheckBase {
  static DEFAULT_OPTIONS = {
    id: "reality-check-options-config",
    tag: "section",
    classes: [MODULE_ID, "reality-check-options-config"],
    position: {
      width: 340,
      height: "auto"
    },
    window: {
      frame: true,
      positioned: true,
      title: `${MODULE_TITLE} Colours`,
      icon: "fa-solid fa-palette",
      minimizable: false,
      resizable: false
    }
  };

  static PARTS = {
    main: {
      template: `modules/${MODULE_ID}/templates/reality-check-options-config.hbs`,
      root: true
    }
  };

  async _prepareContext() {
    // Clamp/normalize on read so corrupted settings never reach the template.
    return {
      colorSaturation: clampInteger(game.settings.get(MODULE_ID, "colorSaturation"), 0, 100, 62),
      colorLightness:  clampInteger(game.settings.get(MODULE_ID, "colorLightness"),  0, 100, 52),
      easiestHue:      normaliseHue(game.settings.get(MODULE_ID, "easiestHue"), 270),
      hardestHue:      normaliseHue(game.settings.get(MODULE_ID, "hardestHue"), 0)
    };
  }

  async _onRender(context, options) {
    await super._onRender(context, options);

    const root = this.element;
    if (!root) return;

    const satInput   = root.querySelector(".rcco-saturation");
    const lightInput = root.querySelector(".rcco-lightness");
    const satValue   = root.querySelector(".rcco-saturation-value");
    const lightValue = root.querySelector(".rcco-lightness-value");

    // Keep the numeric labels next to the sliders in sync as the GM drags, so they get live feedback without needing to save first.
    const syncLabels = () => {
      if (satValue && satInput)     satValue.textContent   = `${satInput.value}%`;
      if (lightValue && lightInput) lightValue.textContent = `${lightInput.value}%`;
    };

    satInput?.addEventListener("input", syncLabels);
    lightInput?.addEventListener("input", syncLabels);
    // Run once on render to populate labels from the initial slider values.
    syncLabels();

    root.querySelector('[data-action="save"]')?.addEventListener("click", async () => {
      const saturation = clampInteger(root.querySelector(".rcco-saturation")?.value,  0, 100, 62);
      const lightness  = clampInteger(root.querySelector(".rcco-lightness")?.value,   0, 100, 52);
      const easiestHue = normaliseHue(root.querySelector(".rcco-easiest-hue")?.value, 270);
      const hardestHue = normaliseHue(root.querySelector(".rcco-hardest-hue")?.value, 0);

      await game.settings.set(MODULE_ID, "colorSaturation", saturation);
      await game.settings.set(MODULE_ID, "colorLightness",  lightness);
      await game.settings.set(MODULE_ID, "easiestHue",      easiestHue);
      await game.settings.set(MODULE_ID, "hardestHue",      hardestHue);

      ui.notifications.info("Reality Check colours updated.");
      await this.close();
    });

    root.querySelector('[data-action="cancel"]')?.addEventListener("click", async () => {
      await this.close();
    });
  }
}

// ---------------------------------------------------------------------------
// Settings registration
// ---------------------------------------------------------------------------
Hooks.once("init", () => {

  // --- User-visible settings (shown in Configure Settings) -----------------
  game.settings.register(MODULE_ID, "twistRate", {
    name: "Twist Chance",
    hint: "Chance that an answer gains a twist.",
    scope: "user",
    config: true,
    type: Number,
    default: 20
  });

  game.settings.register(MODULE_ID, "randomizeTwistWord", {
    name: "Randomize Twist Word",
    hint: "When enabled, twisted results choose 'and' or 'but' at random.",
    scope: "user",
    config: true,
    type: Boolean,
    default: false
  });

  game.settings.register(MODULE_ID, "outputPublic", {
    name: "Default Output to All",
    hint: "If enabled, normal clicks post to all players. Shift-click always posts GM-only.",
    scope: "user",
    config: true,
    type: Boolean,
    default: false
  });

  game.settings.register(MODULE_ID, "autoOpen", {
    name: "Auto-open Panel for GM",
    hint: "Open the Reality Check panel automatically when the GM joins the world.",
    scope: "user",
    config: true,
    type: Boolean,
    default: true
  });

  // --- Internal/hidden settings (not shown directly in Configure Settings) ------------------------------------
  // Colour settings are scope:"user" because they're purely cosmetic preferences. They're hidden (config:false) because they're edited 
  // via the dedicated colour dialog rather than the raw settings form.
  game.settings.register(MODULE_ID, "colorSaturation", {
    name: "Color Saturation",
    hint: "Internal storage for shared button/chat saturation.",
    scope: "user",
    config: false,
    type: Number,
    default: 62,
    onChange: () => rerenderPanel()
  });

  game.settings.register(MODULE_ID, "colorLightness", {
    name: "Color Lightness",
    hint: "Internal storage for shared button/chat lightness.",
    scope: "user",
    config: false,
    type: Number,
    default: 52,
    onChange: () => rerenderPanel()
  });

  game.settings.register(MODULE_ID, "easiestHue", {
    name: "Easiest Button Hue",
    hint: "Hue used for the easiest configured button.",
    scope: "user",
    config: false,
    type: Number,
    default: 270, //NB this is a wheel, but if the max is 360, it will show the same as zero... and all buttons will be red - see the normalisehues below
    onChange: () => rerenderPanel()
  });

  game.settings.register(MODULE_ID, "hardestHue", {
    name: "Hardest Button Hue",
    hint: "Hue used for the hardest configured button.",
    scope: "user",
    config: false,
    type: Number,
    default: 0,    // I am paranoid that I should have reversed the who DC thing to make high numbers easier, but here we are... red is high
    onChange: () => rerenderPanel()
  });

  // Colour settings are per-user preferences (scope:"user"), so the menu is not restricted to GM-only - any player could theoretically open this
  // dialog to change their own button colours.
  game.settings.registerMenu(MODULE_ID, "optionsMenu", {
    name: `${MODULE_TITLE} Colours`,
    label: "Configure Colours",
    hint: "Set shared colour saturation, lightness, and hue range.",
    icon: "fa-solid fa-palette",
    type: RealityCheckOptionsConfig,
    restricted: false
  });

  game.settings.register(MODULE_ID, "showThreshold", {
    name: "Show the Yes/No Threshold Number inside the UI buttons.",
    hint: "Internal storage for whether the button thresholds are shown in the floating panel.",
    scope: "user",
    config: false,
    type: Boolean,
    default: false,
    onChange: () => rerenderPanel()
  });

  game.settings.register(MODULE_ID, "buttonThresholds", {
    name: "Button Thresholds",
    hint: "Internal storage for the configured yesFrom button list.",
    scope: "user",
    config: false,
    type: Object,
    default: DEFAULT_BUTTONS,
    onChange: () => rerenderPanel()
  });

  // Button configuration is GM-only because non-GM players don't see the panel at all, so there's no reason to let them configure it.
  game.settings.registerMenu(MODULE_ID, "buttonThresholdsMenu", {
    name: `${MODULE_TITLE} Buttons`,
    label: "Configure Buttons",
    hint: "Add, remove, and reorder the yesFrom values used for the panel buttons.",
    icon: "fa-solid fa-sliders",
    type: RealityCheckButtonsConfig,
    restricted: true
  });

  // Stored as scope:"client" rather than "user" so the panel snaps back to the right spot on this specific browser even if the GM logs in from
  // a different machine with a different screen layout.
  game.settings.register(MODULE_ID, "panelPosition", {
    name: "Panel Position",
    hint: "Remembered panel position for this browser/client.",
    scope: "client",
    config: false,
    type: Object,
    default: DEFAULT_PANEL_POSITION
  });

  // Expose key functions as a public API so macros and other modules can trigger rolls or open/close the panel without relying on module internals.
  game.modules.get(MODULE_ID).api = {
    open: openRealityCheck,
    close: closeRealityCheck,
    roll: makeRealityCheckRoll
  };
});

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------
Hooks.on("renderSettingsConfig", (app, html) => {
  // Inject a visual section heading above our settings group so they're easy to find in the (potentially long) module settings list.
  injectSettingsHeadings(html);
});

Hooks.once("ready", async () => {
  if (!game.user.isGM) return;
  if (!game.settings.get(MODULE_ID, "autoOpen")) return;
  await openRealityCheck();
});

Hooks.on("getSceneControlButtons", (controls) => {
  if (!game.user.isGM) return;
  // Guard against Foundry versions where the tokens group or its tools might not exist yet when this hook fires.
  if (!controls?.tokens?.tools) return;

  // Bolt onto the token controls toolbar so the GM always has a one-click  way to reopen the panel without needing a macro.
  controls.tokens.tools.realityCheck = {
    name: "realityCheck",
    title: MODULE_TITLE,
    icon: "fa-solid fa-scale-balanced",
    // Append after whatever tools are already registered rather than stomping  on a specific position that might shift between Foundry versions.
    order: Object.keys(controls.tokens.tools).length,
    button: true,
    visible: true,
    onChange: async () => {
      await openRealityCheck();
    }
  };
});

// ---------------------------------------------------------------------------
// Panel lifecycle helpers
// ---------------------------------------------------------------------------
async function openRealityCheck() {
  if (!game.user.isGM) return null;

  // If the panel is already open, bring it forward rather than spawning a duplicate - double-clicking the toolbar button should jest focus,
  // rather than spawning more versions
  if (realityCheckApp?.rendered) {
    realityCheckApp.bringToFront();
    return realityCheckApp;
  }

  realityCheckApp = new RealityCheckPanel();
  await realityCheckApp.render({ force: true });
  realityCheckApp.bringToFront();
  return realityCheckApp;
}

async function closeRealityCheck() {
  if (realityCheckApp?.rendered) await realityCheckApp.close();
}

// Called by settings onChange handlers so the panel immediately reflects any changes to colours, button list, or threshold visibility.
async function rerenderPanel() {
  if (realityCheckApp?.rendered) {
    await realityCheckApp.render({ force: true });
  }
}

// ---------------------------------------------------------------------------
// Core roll logic
// ---------------------------------------------------------------------------
async function makeRealityCheckRoll(yesFrom, { forceGmOnly = false } = {}) {
  if (!game.user.isGM) return;

  // Clamp at read time in case the setting has been set to an out-of-range value via the API or direct settings manipulation.
  const twistRate    = clampInteger(game.settings.get(MODULE_ID, "twistRate"), 0, 100, 20);
  // forceGmOnly (shift-click) always wins over the default output setting.
  const outputPublic = forceGmOnly ? false : Boolean(game.settings.get(MODULE_ID, "outputPublic"));

  // The primary roll is shown to everyone as a ghost die so players see something happen without knowing the result.
  const primaryRoll = await rollD100({ showDice: true });

  // The twist roll is entirely silent — players shouldn't know a twist check even happened, which keeps the "Yes, but..." result feeling organic.
  const twistRoll = await rollD100({ showDice: false });

  const isYes      = primaryRoll >= yesFrom;
  const hasTwist   = twistRoll <= twistRate;
  const resultText = getResultText(isYes, hasTwist);

  // Match the chat message colour to the button that was clicked, so peeps can spot the approximate odds at a glance. I didn't want people to get
  // hung up on arguing over exact numbers, so this is the only real indication of difficulty.
  const hue = getHueFromYesFrom(yesFrom, getButtonThresholds());
  const { saturation, lightness } = getColorTuning();

  // Colour is passed as CSS custom properties so the stylesheet controls the exact visual treatment without needing to inline every style rule here.
  let chatData = {
    user: game.user.id,
    speaker: ChatMessage.getSpeaker(),
    content: `
      <div class="reality-check-chat" style="--rc-hue:${hue}; --rc-sat:${saturation}%; --rc-light:${lightness}%;">
        <div class="reality-check-chat__badge">${MODULE_TITLE}</div>
        <div class="reality-check-chat__result">${resultText}</div>
      </div>
    `
  };

  // applyRollMode stamps the correct whisper/blind flags onto the message so Foundry's own visibility rules handle who sees what.
  chatData = ChatMessage.applyRollMode(chatData, outputPublic ? "publicroll" : "gmroll");
  await ChatMessage.create(chatData);
}

async function rollD100({ showDice = false } = {}) {
  //btw evaluate() is async now
  const roll = await (new Roll("1d100")).evaluate();

  if (showDice) {
    await showGhostRealityCheckDie(roll);
  }

  return roll.total;
}

async function showGhostRealityCheckDie(roll) {
  const dice3d = game.dice3d;
  // Bail out silently if Dice So Nice isn't installed 3D dice are a bonus, not a requirement for the module to function.
  if (!dice3d?.showForRoll) return;

  try {
    // Setting roll.ghost = true is an unofficial Dice So Nice API flag. It instructs DSN to render the die with mystery/hidden faces so the
    // numeric result is not revealed to players. This may break if DSN changes its internal API in a future update.
    roll.ghost = true;

    // true = synchronize across all clients,
    // null = no specific user target,
    // true = blind (so nobody reads the number off the die face (they're really not used anyway, it's just for colour)).
    await dice3d.showForRoll(roll, game.user, true, null, true);
  } catch (err) {
    console.warn(`${MODULE_TITLE} | Dice So Nice display failed.`, err);
  }
}

// ---------------------------------------------------------------------------
// Result text
// ---------------------------------------------------------------------------
function getResultText(isYes, hasTwist) {
  // No twist means we give a monosyllabic output.
  if (!hasTwist) return isYes ? "Yes" : "No";

  // With randomizeTwistWord off (the default), the twist will stay as a minor mitigation to the outcome - if you had bad luck, at least, the
  // twist seems to imply, the GM has this thing to say... Likewise, it will dull a success. With the randomiser randamising, the negative and
  // positively coded words are randomised. Of course, it's still up to you how you interpret them
  const randomize = Boolean(game.settings.get(MODULE_ID, "randomizeTwistWord"));
  const useAnd    = randomize ? Math.random() < 0.5 : isYes;

  if (isYes) return useAnd ? "Yes and..." : "Yes, but...";
  return useAnd ? "No, and..." : "No, but...";
}

// ---------------------------------------------------------------------------
// Settings helpers
// ---------------------------------------------------------------------------
function getButtonThresholds() {
  // Always pass through normalizeButtonThresholds so callers never have to worry about corrupt or out-of-range values coming out of settings.
  return normalizeButtonThresholds(game.settings.get(MODULE_ID, "buttonThresholds"), DEFAULT_BUTTONS);
}

function getColorTuning() {
  return {
    saturation: clampInteger(game.settings.get(MODULE_ID, "colorSaturation"), 0, 100, 62),
    lightness:  clampInteger(game.settings.get(MODULE_ID, "colorLightness"),  0, 100, 52)
  };
}

// ---------------------------------------------------------------------------
// utility functions
// ---------------------------------------------------------------------------
function normalizeButtonThresholds(values, fallback = []) {
  const source = Array.isArray(values) ? values : fallback;
  const cleaned = source
    // Coerce to string first so nulls and numbers both go through the same trim/empty-check path without special-casing either type.
    .map((value) => String(value ?? "").trim())
    .filter((value) => value !== "")
    .map((value) => Number(value))
    // Allow only whole numbers in the valid d100 range - decimals and out-of-range values would produce weird percentage tooltips.
    .filter((value) => Number.isInteger(value) && value >= 1 && value <= 100);

  // Deduplicate and sort ascending so the panel always renders low-to-high (easiest to hardest) regardless of what order the GM typed them in.
  return Array.from(new Set(cleaned)).sort((a, b) => a - b);
}

// yesFrom is the minimum roll for YES, so the chance of a YES result is everything from yesFrom up to 100 inclusive: (101 - yesFrom) percent.
// I'm really concerned that I should have changed this to make the number entry more intuitive... I mean, it works, but should I change it? I haven't...
function getYesPercent(yesFrom) {
  return clampInteger(101 - Number(yesFrom), 0, 100, 50);
}

function buildTooltip(yesFrom) {
  const outputPublic = Boolean(game.settings.get(MODULE_ID, "outputPublic"));
  // Conversify the hint text to match the current default so the GM is never surprised about where the result ends up.
  const shiftHint = outputPublic ? "Shift-click = GM only" : "Shift-click = post publicly";
  return `${getYesPercent(yesFrom)}% Yes ${MODULE_TITLE}; ${shiftHint}`;
}

function getHueFromYesFrom(yesFrom, buttons = getButtonThresholds()) {
  const minYesFrom = Math.min(...buttons);
  const maxYesFrom = Math.max(...buttons);
  const easiestHue = normaliseHue(game.settings.get(MODULE_ID, "easiestHue"), 270);
  const hardestHue = normaliseHue(game.settings.get(MODULE_ID, "hardestHue"), 0);

  // Can't spread an empty array - bail to the easiest hue as a safe default.
  if (!Number.isFinite(minYesFrom) || !Number.isFinite(maxYesFrom)) return easiestHue;
  // Only one button configured - no meaningful spectrum to interpolate across, so split the difference between the two endpoint hues.
  if (minYesFrom === maxYesFrom) return Math.round((easiestHue + hardestHue) / 2);

  // Linear interpolation across the hue spectrum: the easiest button (lowest yesFrom = highest Yes%)
  const t = (yesFrom - minYesFrom) / (maxYesFrom - minYesFrom);
  return Math.round(easiestHue + (hardestHue - easiestHue) * t);
}

function injectSettingsHeadings(html) {
  // html may be a jQuery object (older Foundry hooks) or a plain element.
  const root = html?.querySelector ? html : html?.[0];
  if (!root) return;

  // Find the container that holds our settings by looking for one of our known setting keys more reliable than assuming a fixed DOM structure
  // that might change between Foundry versions.
  const settingsBoxes = Array.from(root.querySelectorAll('section, div, form')).filter((el) =>
    el.querySelector?.('input[name="reality-check.twistRate"], input[name="reality-check.autoOpen"], button[data-key="reality-check.optionsMenu"]')
  );

  const container = settingsBoxes[0] ?? root;
  if (!container) return;

  // Guard against this hook firing multiple times (e.g. settings re-render) and injecting duplicate headings.
  if (!container.querySelector('.reality-check-settings-heading--output')) {
    const twistGroup = findSettingGroup(root, 'reality-check.twistRate');
    if (twistGroup?.parentElement) {
      const heading = document.createElement('h4');
      heading.className = 'reality-check-settings-heading reality-check-settings-heading--output';
      heading.textContent = 'Output Settings';
      twistGroup.parentElement.insertBefore(heading, twistGroup);
    }
  }
}

function findSettingGroup(root, key) {
  // Try multiple selector strategies in order of specificity - Foundry has apparently changed how it marks up setting rows across versions, 
  // so now I'm scared // about resilience
  const control = root.querySelector(`[name="${key}"]`)
    ?? root.querySelector(`[data-key="${key}"]`)
    ?? root.querySelector(`[data-setting-id="${key}"]`);

  return control?.closest('.form-group, .setting, .settings-list > *, li, section > div') ?? null;
}

// Utility that coerces a value to a bounded integer, returning a fallback for anything that can't be sensibly converted (NaN, Infinity, undefined, etc).
function clampInteger(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.round(number)));
}

// Wraps any degree value into the 0-359 range using modular arithmetic. The double-mod trick handles negative inputs correctly
// (e.g. -10 -> 350 rather than -10).
function normaliseHue(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return ((Math.round(number) % 360) + 360) % 360;
}

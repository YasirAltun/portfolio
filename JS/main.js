/**
 * Site behaviour: language, theme, navigation, scroll reveals, the portrait,
 * the references list and the WebGL background.
 */

import {
  createTwistedBackground,
  defaultSettings,
  SIMULATION_SIZES,
} from "./twisted-background.js";
import {
  currentLanguage,
  initLanguage,
  onLanguageChange,
  setupLanguageSwitcher,
  t,
} from "./i18n.js";

const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

/** Reference data carries per-language strings; everything else is shared. */
function localized(value) {
  if (value == null || typeof value === "string") return value ?? "";
  return value[currentLanguage()] ?? value.en ?? "";
}

/* -------------------------------------------------------------------------- */
/* Background                                                                 */
/* -------------------------------------------------------------------------- */

/** Reads a `--x-rgb: r g b` custom property as normalised [0..1] components. */
function readColorTriplet(name, fallback) {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const channels = raw.split(/[\s,]+/).map(Number);
  if (channels.length < 3 || channels.some(Number.isNaN)) return fallback;
  return channels.slice(0, 3).map((channel) => channel / 255);
}

const ACCENT_COLOR_KEY = "accent-color";

/** A hex the viewer picked to drive the page accent, or null to follow the theme. */
function readStoredColor() {
  try {
    return localStorage.getItem(ACCENT_COLOR_KEY);
  } catch (error) {
    return null;
  }
}

/** Persists (or clears) the accent-colour override. */
function writeStoredColor(hex) {
  try {
    if (hex) localStorage.setItem(ACCENT_COLOR_KEY, hex);
    else localStorage.removeItem(ACCENT_COLOR_KEY);
  } catch (error) {
    /* storage unavailable — the choice still applies for this session */
  }
}

/** Overrides the theme accent across the page while set; null follows the theme. */
let customAccent = readStoredColor();

/** "#rrggbb" → [r, g, b] in 0..1, or null when it doesn't parse. */
function hexToTriplet(hex) {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex ?? "");
  if (!match) return null;
  const value = parseInt(match[1], 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((channel) => channel / 255);
}

/** [r, g, b] in 0..1 → "#rrggbb". */
function tripletToHex(triplet) {
  return `#${triplet.map((c) => Math.round(c * 255).toString(16).padStart(2, "0")).join("")}`;
}

/** [r, g, b] in 0..1 → [h, s, l] in 0..1. */
function rgbToHsl([r, g, b]) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (!d) return [0, 0, l];
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h /= 6;
  if (h < 0) h += 1;
  return [h, s, l];
}

/** [h, s, l] in 0..1 → [r, g, b] in 0..1. */
function hslToTriplet(h, s, l) {
  if (!s) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [channel(h + 1 / 3), channel(h), channel(h - 1 / 3)];
}

/**
 * A shade of the picked colour that stays legible as text on the current
 * theme's background: floored bright on the dark page, capped dark on the
 * light one, with a little saturation kept so grey picks still read as accent.
 */
function readableAccentText(hex) {
  const triplet = hexToTriplet(hex);
  if (!triplet) return hex;
  const isDark = document.documentElement.dataset.theme === "dark";
  const [h, s, l] = rgbToHsl(triplet);
  const lightness = isDark ? Math.max(l, 0.62) : Math.min(l, 0.4);
  return tripletToHex(hslToTriplet(h, Math.max(s, 0.4), lightness));
}

/**
 * Drive the whole page from one colour. Overriding the two accent tokens on
 * the root beats the per-theme stylesheet values, so every fill, border, glow,
 * accent text and the stream (which reads --accent-rgb) follow it. Passing null
 * clears the override and hands control back to the theme.
 */
function applyAccent(hex) {
  const style = document.documentElement.style;
  const triplet = hexToTriplet(hex);
  if (!triplet) {
    style.removeProperty("--accent-rgb");
    style.removeProperty("--accent-text");
    return;
  }
  style.setProperty("--accent-rgb", triplet.map((c) => Math.round(c * 255)).join(" "));
  style.setProperty("--accent-text", readableAccentText(hex));
}

function currentPalette() {
  const isDark = document.documentElement.dataset.theme === "dark";
  return {
    color: readColorTriplet("--accent-rgb", [0.8, 0.07, 0.07]),
    background: readColorTriplet("--bg-rgb", isDark ? [0.03, 0.03, 0.04] : [0.98, 0.97, 0.97]),
    // Additive reads as a glow on a dark page; on a light page it would just
    // blow out to white, so there we composite the particles normally instead.
    additive: isDark,
    // Kept low: the stream now runs at full brightness almost edge to edge, so
    // a high value turns the middle band into a solid block.
    opacity: isDark ? 0.45 : 0.38,
  };
}

const SETTINGS_KEY = "stream-settings";

function readStoredSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    return null;
  }
}

function writeStoredSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (error) {
    /* storage unavailable — the settings still apply for this session */
  }
}

function setupBackground() {
  const canvas = document.getElementById("stream-canvas");
  if (!canvas) return null;

  const background = createTwistedBackground(canvas, {
    reducedMotion: prefersReducedMotion.matches,
    settings: readStoredSettings() ?? undefined,
  });

  if (!background) {
    // No WebGL (or no float render targets): fall back to a plain background.
    canvas.hidden = true;
    document.body.classList.add("no-stream");
    return null;
  }

  background.setPalette(currentPalette());
  prefersReducedMotion.addEventListener("change", (event) => {
    background.setReducedMotion(event.matches);
  });

  return background;
}

/* -------------------------------------------------------------------------- */
/* Theme                                                                      */
/* -------------------------------------------------------------------------- */

function setupTheme(background) {
  const toggle = document.getElementById("theme-toggle");
  const themeColorMeta = document.querySelector('meta[name="theme-color"]');
  const icon = toggle?.querySelector("i");

  function apply(theme, { persist } = { persist: true }) {
    document.documentElement.dataset.theme = theme;

    if (persist) {
      try {
        localStorage.setItem("theme", theme);
      } catch (error) {
        /* storage unavailable — the theme still applies for this session */
      }
    }

    if (icon) icon.className = theme === "dark" ? "bx bx-sun" : "bx bx-moon";
    toggle?.setAttribute(
      "aria-label",
      t(theme === "dark" ? "a11y.themeToLight" : "a11y.themeToDark"),
    );

    // Re-derive the accent override for this theme (its text shade depends on
    // the background), then re-read the now-current custom properties.
    applyAccent(customAccent);
    const palette = currentPalette();
    background?.setPalette(palette);
    if (themeColorMeta) {
      const [r, g, b] = palette.background.map((channel) => Math.round(channel * 255));
      themeColorMeta.setAttribute("content", `rgb(${r} ${g} ${b})`);
    }
  }

  apply(document.documentElement.dataset.theme === "light" ? "light" : "dark", {
    persist: false,
  });

  toggle?.addEventListener("click", () => {
    apply(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
  });

  // The toggle's label is translated, so it has to be rebuilt on a language change.
  onLanguageChange(() =>
    apply(document.documentElement.dataset.theme === "light" ? "light" : "dark", {
      persist: false,
    }),
  );

  // Follow the OS unless the visitor has made an explicit choice.
  window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", (event) => {
    let stored = null;
    try {
      stored = localStorage.getItem("theme");
    } catch (error) {
      /* ignore */
    }
    if (!stored) apply(event.matches ? "light" : "dark", { persist: false });
  });
}

/* -------------------------------------------------------------------------- */
/* Portrait gallery                                                           */
/* -------------------------------------------------------------------------- */

const PORTRAIT_INTERVAL = 3000;

function setupPortrait() {
  const root = document.getElementById("portrait");
  if (!root) return;

  const slides = [...root.querySelectorAll(".portrait__slide")];
  if (slides.length < 2) return;

  let index = Math.max(
    0,
    slides.findIndex((slide) => slide.classList.contains("is-active")),
  );
  let timer = null;

  function show(next) {
    index = (next + slides.length) % slides.length;
    slides.forEach((slide, i) => {
      const active = i === index;
      slide.classList.toggle("is-active", active);
      // Keep the hidden photo out of the accessibility tree so its alt text is
      // not read alongside the visible one.
      slide.setAttribute("aria-hidden", String(!active));
    });
  }

  function play() {
    if (timer !== null || prefersReducedMotion.matches) return;
    timer = setInterval(() => show(index + 1), PORTRAIT_INTERVAL);
  }

  function pause() {
    if (timer === null) return;
    clearInterval(timer);
    timer = null;
  }

  // Hovering holds the current photo so it can actually be looked at.
  root.addEventListener("pointerenter", pause);
  root.addEventListener("pointerleave", play);

  document.addEventListener("visibilitychange", () => (document.hidden ? pause() : play()));
  prefersReducedMotion.addEventListener("change", (event) =>
    event.matches ? pause() : play(),
  );

  show(index);
  play();
}

/* -------------------------------------------------------------------------- */
/* Background settings panel                                                  */
/* -------------------------------------------------------------------------- */

function formatCount(particles) {
  return particles >= 1000 ? `${Math.round(particles / 1000)}k` : String(particles);
}

function setupSettings(background) {
  const root = document.getElementById("settings");
  if (!root) return;

  // Nothing to configure if the simulation never started.
  if (!background) return;
  root.hidden = false;

  const toggle = document.getElementById("settings-toggle");
  const panel = document.getElementById("settings-panel");
  const closeButton = document.getElementById("settings-close");
  const resetButton = document.getElementById("settings-reset");

  const inputs = {
    pointerForce: document.getElementById("set-pointer"),
    simulationSize: document.getElementById("set-particles"),
    speed: document.getElementById("set-speed"),
    color: document.getElementById("set-color"),
    autoRotate: document.getElementById("set-autorotate"),
    zoom: document.getElementById("set-zoom"),
    yaw: document.getElementById("set-yaw"),
    pitch: document.getElementById("set-pitch"),
  };

  const outputs = {
    simulationSize: document.getElementById("out-particles"),
    speed: document.getElementById("out-speed"),
    zoom: document.getElementById("out-zoom"),
    yaw: document.getElementById("out-yaw"),
    pitch: document.getElementById("out-pitch"),
  };

  const degrees = (radians) => Math.round((radians * 180) / Math.PI);
  const radians = (deg) => (deg * Math.PI) / 180;

  inputs.simulationSize.max = String(SIMULATION_SIZES.length - 1);

  /** Pushes the engine's current settings back into the controls. */
  function syncControls() {
    const current = background.getSettings();

    inputs.pointerForce.checked = current.pointerForce;
    inputs.autoRotate.checked = current.autoRotate;
    // The swatch shows the override when set, otherwise the live theme accent.
    inputs.color.value =
      (customAccent && hexToTriplet(customAccent))
        ? customAccent
        : tripletToHex(readColorTriplet("--accent-rgb", [0.8, 0.07, 0.07]));
    inputs.simulationSize.value = String(
      Math.max(0, SIMULATION_SIZES.indexOf(current.simulationSize)),
    );
    inputs.speed.value = String(current.speed);
    inputs.zoom.value = String(current.zoom);
    inputs.yaw.value = String(degrees(current.yaw));
    inputs.pitch.value = String(degrees(current.pitch));

    outputs.simulationSize.textContent = formatCount(background.getParticleCount());
    outputs.speed.textContent = `${Number(current.speed).toFixed(1)}×`;
    outputs.zoom.textContent = `${Math.round(current.zoom * 100)}%`;
    outputs.yaw.textContent = `${degrees(current.yaw)}°`;
    outputs.pitch.textContent = `${degrees(current.pitch)}°`;

    // Manual angles are meaningless while the camera drifts on its own.
    inputs.yaw.disabled = current.autoRotate;
    inputs.pitch.disabled = current.autoRotate;
  }

  function apply(patch) {
    background.configure(patch);
    writeStoredSettings(background.getSettings());
    syncControls();
  }

  inputs.pointerForce.addEventListener("change", (event) =>
    apply({ pointerForce: event.target.checked }),
  );
  inputs.autoRotate.addEventListener("change", (event) =>
    apply({ autoRotate: event.target.checked }),
  );
  inputs.simulationSize.addEventListener("input", (event) =>
    apply({ simulationSize: SIMULATION_SIZES[Number(event.target.value)] }),
  );
  inputs.speed.addEventListener("input", (event) => apply({ speed: Number(event.target.value) }));
  // Colour is a palette override, not an engine setting, so it takes its own path.
  inputs.color.addEventListener("input", (event) => {
    customAccent = event.target.value;
    writeStoredColor(customAccent);
    applyAccent(customAccent);
    background.setPalette(currentPalette());
  });
  inputs.zoom.addEventListener("input", (event) => apply({ zoom: Number(event.target.value) }));
  inputs.yaw.addEventListener("input", (event) => apply({ yaw: radians(Number(event.target.value)) }));
  inputs.pitch.addEventListener("input", (event) =>
    apply({ pitch: radians(Number(event.target.value)) }),
  );

  resetButton.addEventListener("click", () => {
    try {
      localStorage.removeItem(SETTINGS_KEY);
    } catch (error) {
      /* ignore */
    }
    // defaultSettings() re-derives the particle count from the current viewport.
    background.configure(defaultSettings());
    // Drop the colour override too, so the page follows the theme again.
    customAccent = null;
    writeStoredColor(null);
    applyAccent(null);
    background.setPalette(currentPalette());
    syncControls();
  });

  function setOpen(open) {
    panel.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    // Re-sync on open so the swatch tracks the accent after a theme switch.
    if (open) {
      syncControls();
      closeButton.focus();
    }
  }

  toggle.addEventListener("click", () => setOpen(panel.hidden));
  closeButton.addEventListener("click", () => {
    setOpen(false);
    toggle.focus();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !panel.hidden) {
      setOpen(false);
      toggle.focus();
    }
  });

  document.addEventListener("click", (event) => {
    if (!panel.hidden && !root.contains(event.target)) setOpen(false);
  });

  syncControls();
}

/* -------------------------------------------------------------------------- */
/* Navigation                                                                 */
/* -------------------------------------------------------------------------- */

function setupNavigation() {
  const header = document.querySelector(".site-header");
  const nav = document.getElementById("primary-nav");
  const toggle = document.getElementById("nav-toggle");
  const links = [...nav.querySelectorAll("a")];

  function setMenuOpen(open) {
    nav.dataset.open = String(open);
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", t(open ? "a11y.navClose" : "a11y.navOpen"));
    toggle.querySelector("i").className = open ? "bx bx-x" : "bx bx-menu";
  }

  setMenuOpen(false);
  onLanguageChange(() => setMenuOpen(nav.dataset.open === "true"));

  toggle.addEventListener("click", () => {
    setMenuOpen(nav.dataset.open !== "true");
  });

  links.forEach((link) => link.addEventListener("click", () => setMenuOpen(false)));

  document.addEventListener("click", (event) => {
    if (nav.dataset.open !== "true") return;
    if (!nav.contains(event.target) && !toggle.contains(event.target)) setMenuOpen(false);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && nav.dataset.open === "true") {
      setMenuOpen(false);
      toggle.focus();
    }
  });

  const onScroll = () => {
    header.dataset.scrolled = String(window.scrollY > 12);
  };
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  // Highlight whichever section is closest to the top of the viewport.
  const sections = links
    .map((link) => document.querySelector(link.getAttribute("href")))
    .filter(Boolean);

  if (sections.length) {
    const visible = new Set();
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) visible.add(entry.target.id);
          else visible.delete(entry.target.id);
        });

        const currentId = sections.find((section) => visible.has(section.id))?.id;
        links.forEach((link) => {
          const isCurrent = link.getAttribute("href") === `#${currentId}`;
          if (isCurrent) link.setAttribute("aria-current", "true");
          else link.removeAttribute("aria-current");
        });
      },
      { rootMargin: "-45% 0px -50% 0px" },
    );

    sections.forEach((section) => observer.observe(section));
  }
}

/* -------------------------------------------------------------------------- */
/* Scroll reveals                                                             */
/* -------------------------------------------------------------------------- */

/** @returns {(element: Element) => void} a function that reveals an element once it scrolls into view. */
function setupReveals() {
  const targets = document.querySelectorAll(".reveal");

  if (prefersReducedMotion.matches || !("IntersectionObserver" in window)) {
    targets.forEach((target) => target.classList.add("is-visible"));
    return (element) => element.classList.add("is-visible");
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    },
    { rootMargin: "0px 0px -10% 0px", threshold: 0.15 },
  );

  targets.forEach((target) => observer.observe(target));
  return (element) => observer.observe(element);
}

/* -------------------------------------------------------------------------- */
/* References                                                                 */
/* -------------------------------------------------------------------------- */

/** Treats empty values and all-zero placeholders as "no data". */
function isPlaceholder(value) {
  const trimmed = (value ?? "").trim();
  return !trimmed || /^[0\s]+$/.test(trimmed);
}

function initials(name) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.replace(/[^\p{L}]/gu, "").charAt(0).toLocaleUpperCase("tr"))
    .join("");
}

function createAvatar(reference) {
  const avatar = document.createElement("div");
  avatar.className = "avatar";
  avatar.textContent = initials(reference.name);

  if (!reference.image) return avatar;

  // The photo is layered over the initials, which stay as the fallback if the
  // file is missing. It has to be in the DOM for `loading="lazy"` to resolve.
  const image = document.createElement("img");
  image.alt = "";
  image.loading = "lazy";
  image.addEventListener("error", () => image.remove(), { once: true });
  image.src = reference.image;
  avatar.append(image);

  return avatar;
}

function createReferenceCard(reference, index) {
  const card = document.createElement("article");
  card.className = "card reference-card reveal";

  const name = document.createElement("h3");
  name.className = "reference-card__name";
  name.textContent = reference.name;

  const role = document.createElement("p");
  role.className = "reference-card__role";
  role.textContent = localized(reference.position);
  role.title = localized(reference.position);

  const button = document.createElement("button");
  button.type = "button";
  button.className = "button button--ghost";
  button.dataset.reference = String(index);
  button.textContent = t("references.contactInfo");
  button.setAttribute("aria-label", t("references.contactInfoFor", { name: reference.name }));

  card.append(createAvatar(reference), name, role, button);
  return card;
}

function renderContactValue(container, value, scheme) {
  container.textContent = "";

  if (isPlaceholder(value)) {
    container.textContent = t("references.notShared");
    return;
  }

  // A few entries list more than one address, separated by a slash.
  value
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean)
    .forEach((part, index, all) => {
      const link = document.createElement("a");
      link.href = `${scheme}:${part.replace(/\s+/g, "")}`;
      link.textContent = part;
      container.append(link);
      if (index < all.length - 1) container.append(document.createTextNode(" · "));
    });
}

async function setupReferences(reveal) {
  const grid = document.getElementById("reference-grid");
  const status = document.getElementById("reference-status");
  if (!grid) return;

  let references;
  try {
    const response = await fetch("./JS/references.json");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    references = await response.json();
  } catch (error) {
    console.error("[references] could not be loaded:", error);
    if (status) status.textContent = t("references.error");
    return;
  }

  const modal = document.getElementById("reference-modal");
  const closeButton = document.getElementById("modal-close");
  const fields = {
    avatar: document.getElementById("modal-avatar"),
    name: document.getElementById("modal-name"),
    position: document.getElementById("modal-position"),
    email: document.getElementById("modal-email"),
  };
  let openIndex = null;

  function fillModal(index) {
    const reference = references[index];
    if (!reference || !modal) return;

    fields.avatar.replaceChildren(createAvatar(reference));
    fields.name.textContent = reference.name;
    fields.position.textContent = localized(reference.position);
    renderContactValue(fields.email, reference.email, "mailto");
  }

  function openModal(index) {
    if (!references[index] || !modal) return;
    openIndex = index;
    fillModal(index);
    modal.showModal();
  }

  closeButton?.addEventListener("click", () => modal.close());
  modal?.addEventListener("click", (event) => {
    if (event.target === modal) modal.close();
  });
  modal?.addEventListener("close", () => {
    openIndex = null;
  });

  // One delegated listener instead of one per card.
  grid.addEventListener("click", (event) => {
    const button = event.target.closest("[data-reference]");
    if (button) openModal(Number(button.dataset.reference));
  });

  function render() {
    const cards = references.map((reference, index) => createReferenceCard(reference, index));
    grid.replaceChildren(...cards);
    cards.forEach(reveal);
    if (openIndex !== null) fillModal(openIndex);
  }

  // Cards are built from data, so they are rebuilt whenever the language moves.
  onLanguageChange(render);
}

/* -------------------------------------------------------------------------- */
/* Spotify strips                                                             */
/* -------------------------------------------------------------------------- */

const SPOTIFY_FEED = "https://novatorem-yasir-altuns-projects.vercel.app/api/track";

/** Longest we will go without checking, so a skipped track still shows up. */
const POLL_MAX = 4000;
/**
 * Paused is not idle. Someone who just hit pause is sitting at the controls
 * and is about to press play, skip, or pick something else — so keep checking
 * at nearly the playing rate. Backing off here is what made every action
 * except the pause itself feel broken: the pause was caught by the fast loop
 * already running, and everything after it waited out the idle timer.
 */
const POLL_PAUSED = 5000;
/** Nothing has played for a while, so nobody is at the player. */
const POLL_IDLE = 20000;
/** How long a pause still counts as "at the controls". */
const RECENTLY_ACTIVE = 300000;
/** Never hammer the feed, whatever the arithmetic says. */
const POLL_MIN = 2500;
/**
 * Minimum spacing between requests that skip the shared edge cache. Without
 * it, every visitor returning to their tab would punch straight through to the
 * origin — which is exactly the load the cache exists to absorb.
 */
const BYPASS_EVERY = 20000;
/**
 * Bypass requests are bucketed to this many milliseconds rather than carrying a
 * raw timestamp. A unique parameter per request means a unique cache key per
 * request, so the cache could never hold anything and a scripted caller could
 * walk straight past it; bucketing caps the whole internet at a handful of
 * distinct keys a minute, which every visitor then shares.
 */
const BYPASS_BUCKET = 5000;
/** How long each past track holds before the next one climbs into its place. */
const ROLL_EVERY = 3500;
/** Matches the .strip__slide transition, so the swap happens out of sight. */
const ROLL_FADE = 320;

/**
 * Live "now playing" and "last played" strips.
 *
 * Spotify has no push API, so this polls — but it polls where the answer is
 * about to change: the feed carries `progress_ms` and `duration_ms`, so the
 * next request is timed to land just after the current track ends rather than
 * on a blind interval. Between requests the progress bar keeps moving on its
 * own, which is what makes it read as live.
 */
function setupSpotifyStrips() {
  const root = document.getElementById("spotify-strips");
  const nowStrip = document.getElementById("strip-now");
  const recentStrip = document.getElementById("strip-recent");
  if (!root || !nowStrip || !recentStrip) return;

  const progressFill = nowStrip.querySelector(".strip__progress b");
  const recentSlide = recentStrip.querySelector(".strip__slide");
  /** Where the "now playing" strip points when there is no track to link to. */
  const profileUrl = nowStrip.getAttribute("href") || "";
  /** The stand-in shown on the "now playing" strip when nothing is playing. */
  const idleTrack = () => ({
    id: "__idle__",
    track: t("spotify.idle"),
    artist: "",
    art: "",
    url: profileUrl,
  });
  let timer = null;
  let rollTimer = null;
  let shownNowId = null;
  /** Last real track id, tracked apart from the idle notice standing in for it. */
  let lastRealId = null;
  let lastBypass = 0;
  let needHistory = true;
  /** When we last saw playback running, so a pause doesn't read as idle. */
  let lastPlayingAt = 0;
  /** Width each label had when it was last fitted, to skip redundant work. */
  const measuredWidth = new WeakMap();

  const labels = () => [...root.querySelectorAll(".strip__title, .strip__artist")];
  /** The last few tracks, cycled through by the history strip. */
  let recentTracks = [];
  let historyIndex = 0;

  /**
   * Start the label scrolling if its text is wider than the space it has.
   *
   * The strip has a fixed width, so a long title would otherwise be cut off
   * mid-word. How far a given string overflows depends on the font and the
   * viewport, so it can only be measured here and handed to CSS.
   */
  function fitMarquee(label) {
    const inner = label?.firstElementChild;
    const first = inner?.firstElementChild;
    if (!first) return;

    label.dataset.marquee = "false";
    label.style.removeProperty("--shift");
    label.style.removeProperty("--dur");
    inner.replaceChildren(first);

    if (prefersReducedMotion.matches) {
      measuredWidth.set(label, label.clientWidth);
      return;
    }

    // Measuring on the next frame serves two purposes: the new text has been
    // laid out by then, and the flag has actually been off for a frame, which
    // is what makes the animation restart for the incoming title instead of
    // carrying on from the middle of the previous one's cycle.
    requestAnimationFrame(() => {
      measuredWidth.set(label, label.clientWidth);
      if (first.scrollWidth - label.clientWidth <= 2) return;

      // A trailing copy of the text turns the scroll into a loop: once the
      // first copy has travelled its own width plus the gap, the second is
      // sitting exactly where the first started.
      const trailing = first.cloneNode(true);
      trailing.setAttribute("aria-hidden", "true");
      inner.append(trailing);

      // Reading offsetLeft settles the layout, and the difference is the exact
      // travel distance — no need to convert the gap out of rem by hand.
      const shift = trailing.offsetLeft - first.offsetLeft;
      if (shift <= 0) {
        trailing.remove();
        return;
      }

      label.style.setProperty("--shift", `${-shift}px`);
      // A steady 45px a second, so every title reads at the same pace.
      label.style.setProperty("--dur", `${(shift / 45).toFixed(1)}s`);
      label.dataset.marquee = "true";
    });
  }

  /** Swap a strip's contents, fading through the change when the track differs. */
  function paint(strip, track, { ago } = {}) {
    const art = strip.querySelector(".strip__art");
    const title = strip.querySelector(".strip__title");
    const artist = strip.querySelector(".strip__artist");
    const agoSlot = strip.querySelector(".strip__ago");

    // .strip__title > span (the moving track) > span (the text itself, which
    // fitMarquee may duplicate to close the loop).
    title.firstElementChild.firstElementChild.textContent = track.track || "—";
    artist.firstElementChild.firstElementChild.textContent = track.artist || "";
    if (agoSlot) agoSlot.textContent = ago || track.ago || "";
    if (track.url) strip.href = track.url;
    art.style.backgroundImage = track.art ? `url("${track.art}")` : "";

    fitMarquee(title);
    fitMarquee(artist);
  }

  /**
   * Render a track, preloading its artwork first so the strip never flashes a
   * new title against the previous cover.
   */
  function show(strip, track, previousId) {
    if (!track) return previousId;
    if (track.id && track.id === previousId) {
      paint(strip, track);
      return previousId;
    }

    const commit = () => {
      paint(strip, track);
      strip.dataset.swapping = "false";
    };

    if (previousId === null || !track.art) {
      commit();
    } else {
      strip.dataset.swapping = "true";
      const pre = new Image();
      pre.onload = pre.onerror = () => setTimeout(commit, 120);
      pre.src = track.art;
    }
    return track.id || null;
  }

  /**
   * Cycle the history strip: the track on screen climbs out of view while the
   * next one rises into its place.
   *
   * Spotify only records a track in its history once it has been played for a
   * while, so a run of skips leaves the list untouched. Cycling keeps the strip
   * showing something true and moving rather than sitting on one stale line.
   */
  function roll() {
    clearTimeout(rollTimer);
    if (recentTracks.length === 0 || document.visibilityState === "hidden") return;

    rollTimer = setTimeout(() => {
      if (recentTracks.length < 2) {
        roll();
        return;
      }
      historyIndex = (historyIndex + 1) % recentTracks.length;
      recentSlide.dataset.phase = "out";
      setTimeout(() => {
        paint(recentStrip, recentTracks[historyIndex]);
        recentSlide.dataset.phase = "in";
        // Land the new line on screen only once the browser has accepted the
        // starting offset, or it slides from nowhere.
        void recentSlide.offsetWidth;
        recentSlide.dataset.phase = "";
        roll();
      }, ROLL_FADE);
    }, ROLL_EVERY);
  }

  /**
   * Advance the progress bar, but only as far as the next poll can vouch for.
   *
   * Gliding all the way to the end of the track looks better right up until
   * someone skips: the bar then keeps marching confidently towards a song that
   * stopped playing minutes ago. Animating only to the next check means a
   * stale bar stalls instead of lying, and re-anchors on real data.
   *
   * @returns {number} milliseconds left in the track, from the client's clock
   */
  function runProgress(now, servedAt, horizon) {
    if (!progressFill) return 0;

    const duration = now.duration_ms || 0;
    if (!now.playing || !duration) {
      progressFill.style.transition = "none";
      progressFill.style.width = "0%";
      return 0;
    }

    // The response may have come from the edge cache, so it is already stale
    // by however long it sat there.
    const age = Math.max(0, Date.now() - (servedAt || Date.now()));
    const elapsed = Math.min(duration, (now.progress_ms || 0) + age);
    const remaining = Math.max(0, duration - elapsed);
    const step = Math.min(remaining, horizon);

    progressFill.style.transition = "none";
    progressFill.style.width = `${(elapsed / duration) * 100}%`;
    // Force the browser to accept the jump before starting the glide.
    void progressFill.offsetWidth;
    progressFill.style.transition = `width ${step}ms linear`;
    progressFill.style.width = `${((elapsed + step) / duration) * 100}%`;

    return remaining;
  }

  function schedule(delay) {
    clearTimeout(timer);
    if (document.visibilityState === "hidden") return;
    // A little jitter so a crowd of tabs waking together doesn't arrive in
    // lockstep.
    timer = setTimeout(refresh, Math.max(POLL_MIN, delay) + Math.random() * 800);
  }

  /**
   * Fetch the feed.
   *
   * `withHistory` asks for the recent list, which costs a second upstream call, so
   * it is only requested on the first load and when the track changes.
   * `bypass` adds a unique parameter to miss the shared edge cache, and is
   * rate-limited so it can't become a hole straight through to the origin.
   */
  async function load({ withHistory, bypass }) {
    const params = new URLSearchParams({ count: withHistory ? "5" : "0" });
    if (bypass && Date.now() - lastBypass > BYPASS_EVERY) {
      lastBypass = Date.now();
      params.set("fresh", String(Math.floor(Date.now() / BYPASS_BUCKET)));
    }
    const response = await fetch(`${SPOTIFY_FEED}?${params}`, { cache: "no-store" });
    if (!response.ok) throw new Error(String(response.status));
    return response.json();
  }

  async function refresh(options = {}) {
    if (document.visibilityState === "hidden") return;

    let data;
    try {
      data = await load({ withHistory: needHistory, bypass: options.bypass });
    } catch (error) {
      // Leave whatever is on screen: a stale song reads far better than an
      // error, and the feed is usually back by the next attempt.
      root.dataset.state = shownNowId === null ? "error" : "stale";
      schedule(POLL_IDLE);
      return;
    }

    const now = data.now;
    if (!now) {
      root.dataset.state = shownNowId === null ? "error" : "stale";
      schedule(POLL_IDLE);
      return;
    }

    // Real-track turnover, tracked apart from the idle notice so it can stand
    // in on the strip without tripping the history refetch below.
    const changed = Boolean(now.id) && now.id !== lastRealId;
    lastRealId = now.id || lastRealId;

    // Nothing is actually playing: the feed still carries the last track, so
    // say so plainly instead of parking a stale song under "now playing".
    const display = now.playing ? now : idleTrack();
    root.dataset.state = now.playing ? "ready" : "idle";
    nowStrip.dataset.playing = String(Boolean(now.playing));
    shownNowId = show(nowStrip, display, shownNowId);

    const fetched = (data.recent || []).filter((t) => t.id !== now.id);
    if (fetched.length) {
      const stale = recentTracks.map((t) => t.id).join() !== fetched.map((t) => t.id).join();
      recentTracks = fetched;
      needHistory = false;
      if (stale) {
        historyIndex = 0;
        paint(recentStrip, recentTracks[0]);
        roll();
      }
    }

    // The track just turned over, so the recentTracks line is out of date; pick it
    // up on the next poll rather than spending an extra request now.
    if (changed) needHistory = true;

    if (now.playing) lastPlayingAt = Date.now();
    const atTheControls = Date.now() - lastPlayingAt < RECENTLY_ACTIVE;
    const delay = now.playing ? POLL_MAX : atTheControls ? POLL_PAUSED : POLL_IDLE;
    const remaining = runProgress(now, data.served_at, delay);

    // Land just after the track ends when that is sooner than a routine poll.
    schedule(now.playing ? Math.min(remaining + 1500, delay) : delay);
  }

  /** Re-fit any label whose width has actually changed since it was measured. */
  function remeasure() {
    labels().forEach((label) => {
      if (measuredWidth.get(label) !== label.clientWidth) fitMarquee(label);
    });
  }

  // Watching the labels rather than the window catches every way their width
  // can change: rotating the device, the mobile address bar sliding away, the
  // portrait loading and reflowing the row, even the age column going from
  // "17h" to "1d". Comparing against the last measured width keeps the
  // observer from re-triggering on the duplicate that fitMarquee itself adds.
  let resizeTimer = null;
  const observer = new ResizeObserver(() => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(remeasure, 150);
  });
  labels().forEach((label) => observer.observe(label));

  // Poppins arrives after first paint and is wider than the fallback, so a
  // title that fit a moment ago may not any more.
  document.fonts?.ready.then(remeasure);

  // Coming back to the tab should feel instant, and a hidden tab should cost
  // nothing at all.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      clearTimeout(timer);
      clearTimeout(rollTimer);
    } else {
      refresh({ bypass: true });
      roll();
    }
  });

  // Keep the idle notice in the current language without waiting for a poll.
  onLanguageChange(() => {
    if (root.dataset.state === "idle") show(nowStrip, idleTrack(), shownNowId);
  });

  refresh();
}

/* -------------------------------------------------------------------------- */
/* Boot                                                                       */
/* -------------------------------------------------------------------------- */

initLanguage();
setupLanguageSwitcher();

// Apply any saved accent before the stream reads its first palette.
applyAccent(customAccent);
const background = setupBackground();
setupTheme(background);
setupSettings(background);
setupPortrait();
setupNavigation();
setupReferences(setupReveals());
setupSpotifyStrips();

const yearSlot = document.getElementById("footer-year");
if (yearSlot) yearSlot.textContent = String(new Date().getFullYear());

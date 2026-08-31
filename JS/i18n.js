/**
 * Translation layer.
 *
 * Markup opts in per element:
 *   data-i18n="a.b"            -> textContent
 *   data-i18n-aria-label="a.b" -> aria-label (any attribute works: data-i18n-<attr>)
 *
 * Elements without a key are left alone, which is how product names,
 * technologies and certificate titles stay untranslated in every language.
 */

import { DEFAULT_LANGUAGE, LANGUAGES, translations } from "./translations.js";

const STORAGE_KEY = "lang";
const ATTRIBUTE_PREFIX = "i18n-";

const supported = LANGUAGES.map((language) => language.code);
const listeners = new Set();

let current = DEFAULT_LANGUAGE;

/** Resolves "a.b.c" against a dictionary, returning undefined if any hop is missing. */
function lookup(dictionary, key) {
  return key.split(".").reduce((value, part) => (value == null ? undefined : value[part]), dictionary);
}

/**
 * Translates a key, falling back to English and finally to the key itself so a
 * missing string is visible rather than silently blank.
 *
 * @param {string} key
 * @param {Record<string, string>} [vars] `{name}` style placeholders
 */
export function t(key, vars) {
  const value =
    lookup(translations[current], key) ?? lookup(translations[DEFAULT_LANGUAGE], key) ?? key;

  if (!vars) return value;
  return Object.entries(vars).reduce(
    (text, [name, replacement]) => text.replaceAll(`{${name}}`, replacement),
    value,
  );
}

export function currentLanguage() {
  return current;
}

/** Picks a stored choice, then the browser's preference, then English. */
function detectLanguage() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && supported.includes(stored)) return stored;
  } catch (error) {
    /* storage unavailable — fall through to the browser preference */
  }

  for (const tag of navigator.languages ?? [navigator.language]) {
    const code = String(tag).slice(0, 2).toLowerCase();
    if (supported.includes(code)) return code;
  }

  return DEFAULT_LANGUAGE;
}

/** Walks the document and fills in every element that declares a key. */
function translateTree(root = document) {
  root.querySelectorAll("[data-i18n]").forEach((element) => {
    element.textContent = t(element.dataset.i18n);
  });

  root.querySelectorAll("*").forEach((element) => {
    for (const name of Object.keys(element.dataset)) {
      if (!name.startsWith("i18n") || name === "i18n") continue;
      // dataset gives us "i18nAriaLabel"; the attribute is "aria-label".
      const attribute = name
        .slice("i18n".length)
        .replace(/^[A-Z]/, (letter) => letter.toLowerCase())
        .replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
      element.setAttribute(attribute, t(element.dataset[name]));
    }
  });
}

/**
 * Applies a language to the whole document.
 *
 * @param {string} code
 * @param {{ persist?: boolean }} [options]
 */
export function setLanguage(code, { persist = true } = {}) {
  current = supported.includes(code) ? code : DEFAULT_LANGUAGE;

  if (persist) {
    try {
      localStorage.setItem(STORAGE_KEY, current);
    } catch (error) {
      /* storage unavailable — the choice still applies for this session */
    }
  }

  document.documentElement.lang = current;
  document.title = t("meta.title");
  document
    .querySelector('meta[name="description"]')
    ?.setAttribute("content", t("meta.description"));
  document.querySelector('meta[property="og:title"]')?.setAttribute("content", t("meta.title"));
  document
    .querySelector('meta[property="og:description"]')
    ?.setAttribute("content", t("meta.description"));

  translateTree();
  listeners.forEach((listener) => listener(current));
}

/**
 * Registers a callback for anything that renders text from JavaScript rather
 * than from markup — the reference cards, the settings readouts, and so on.
 * Fires immediately so callers do not need a separate first render.
 */
export function onLanguageChange(listener) {
  listeners.add(listener);
  listener(current);
  return () => listeners.delete(listener);
}

/** Wires up the header language picker. */
export function setupLanguageSwitcher() {
  const root = document.getElementById("language");
  const toggle = document.getElementById("language-toggle");
  const menu = document.getElementById("language-menu");
  const label = document.getElementById("language-current");
  if (!root || !toggle || !menu || !label) return;

  const options = LANGUAGES.map((language) => {
    const option = document.createElement("button");
    option.type = "button";
    option.className = "language__option";
    option.lang = language.code;
    option.dataset.lang = language.code;
    option.textContent = language.label;
    menu.append(option);
    return option;
  });

  function setOpen(open) {
    menu.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
  }

  function sync() {
    const active = LANGUAGES.find((language) => language.code === current);
    label.textContent = active?.short ?? current.toUpperCase();
    options.forEach((option) =>
      option.setAttribute("aria-pressed", String(option.dataset.lang === current)),
    );
  }

  setOpen(false);
  toggle.addEventListener("click", () => setOpen(menu.hidden));

  options.forEach((option) =>
    option.addEventListener("click", () => {
      setLanguage(option.dataset.lang);
      setOpen(false);
      toggle.focus();
    }),
  );

  document.addEventListener("click", (event) => {
    if (!menu.hidden && !root.contains(event.target)) setOpen(false);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !menu.hidden) {
      setOpen(false);
      toggle.focus();
    }
  });

  onLanguageChange(sync);
}

/** Applies the detected language before anything else renders. */
export function initLanguage() {
  setLanguage(detectLanguage(), { persist: false });
}

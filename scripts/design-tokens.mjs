#!/usr/bin/env node
/**
 * Sole reader of the design-language tokens declared in app/globals.css.
 *
 * The stylesheet is the source of truth. The route reads lib/design-tokens.ts
 * because the exported scaffold must be standalone — it cannot import from
 * Elvin. This script keeps that copy honest:
 *
 *   --write   regenerate lib/design-tokens.ts from the stylesheet
 *   --check   fetch /api/source for every design and fail if the emitted
 *             tokens differ from the stylesheet
 *
 * Usage: node scripts/design-tokens.mjs --write
 *        node scripts/design-tokens.mjs --check
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const CSS_PATH = path.resolve("app/globals.css");
const APP = process.env.APP_URL ?? "http://localhost:3000";

export const THEMES = ["dark", "light"];

/** The languages the stylesheet declares, in stylesheet order. */
export function designNames(rules) {
  const names = [];
  for (const selector of rules.keys()) {
    const match = /^\.app-shell\[data-design="([a-z0-9-]+)"\]$/.exec(selector);
    if (match) names.push(match[1]);
  }
  return names;
}

/** Sandbox palette, resolved per design and theme. */
const PALETTE = ["--a-bg", "--a-fg", "--a-muted", "--a-border", "--a-surface", "--a-chrome", "--a-accent", "--a-accent-fg"];

/** Token families the scaffold renames: --ds-x / --font-x become the app's own. */
const RENAMED = {
  "--ds-radius": "--radius",
  "--ds-radius-card": "--radius-card",
  "--ds-border": "--border-width",
  "--ds-shadow": "--shadow",
  "--ds-label-weight": "--label-weight",
  "--ds-label-tracking": "--label-tracking",
  "--ds-label-transform": "--label-transform",
  "--ds-heading-weight": "--heading-weight",
  "--ds-heading-tracking": "--heading-tracking",
  "--ds-body-size": "--body-size",
  "--ds-space-canvas": "--pad-canvas",
  "--ds-space-section": "--pad-section",
  "--ds-space-bar": "--pad-bar",
  "--ds-space-gap": "--pad-gap",
  "--color-accent-700": "--danger",
};

const KEPT = ["--font-heading", "--font-body", "--font-mono"];

/** Ordered so a later block wins, matching the cascade for elements carrying both attributes. */
export function parseStylesheet(css) {
  const rules = new Map();
  // Comments first, and single-line selectors only: every token block this
  // reads is top level, so nesting and at-rules are safe to ignore.
  const pattern = /(?:^|[}\n])([^\n{}@][^\n{}]*)\{([^{}]*)\}/g;
  let match;

  while ((match = pattern.exec(css.replace(/\/\*[\s\S]*?\*\//g, ""))) !== null) {
    const selector = match[1].trim();
    const body = match[2];

    const declarations = new Map();
    for (const piece of body.split(";")) {
      const colon = piece.indexOf(":");
      if (colon < 0) continue;
      const property = piece.slice(0, colon).trim();
      if (!property.startsWith("--")) continue;
      declarations.set(property, piece.slice(colon + 1).trim());
    }
    if (declarations.size === 0) continue;

    if (!rules.has(selector)) rules.set(selector, []);
    rules.get(selector).push(declarations);
  }

  return rules;
}

function merge(target, source) {
  for (const [property, value] of source ?? []) target.set(property, value);
  return target;
}

/** Every declaration matching a selector across its (rare) repeated blocks. */
function declarationsFor(rules, selector) {
  const merged = new Map();
  for (const block of rules.get(selector) ?? []) merge(merged, block);
  return merged;
}

export function resolveTokens(rules) {
  const base = declarationsFor(rules, ":root");
  const out = {};

  for (const design of designNames(rules)) {
    const designBlock = declarationsFor(rules, `.app-shell[data-design="${design}"]`);

    const tokens = {};
    for (const [from, to] of Object.entries(RENAMED)) tokens[to] = new Map([...base, ...designBlock]).get(from) ?? "";
    for (const name of KEPT) tokens[name] = new Map([...base, ...designBlock]).get(name) ?? "";

    const themes = {};
    for (const theme of THEMES) {
      const palette = merge(merge(new Map(), declarationsFor(rules, `.app-shell[data-theme="${theme}"]`)), declarationsFor(rules, `.app-shell[data-design="${design}"][data-theme="${theme}"]`));
      themes[theme] = Object.fromEntries(PALETTE.map((name) => [name, palette.get(name) ?? ""]));
    }

    out[design] = { tokens, themes };
  }

  return out;
}

export async function readTokens() {
  return resolveTokens(parseStylesheet(await readFile(CSS_PATH, "utf8")));
}

/** The font request each language needs, taken from the single stylesheet import. */
export function fontImports(css) {
  const url = css.match(/@import url\('(https:\/\/fonts\.googleapis\.com[^']*)'\)/)?.[1];
  if (!url) {
    throw new Error("app/globals.css no longer imports a Google Fonts stylesheet");
  }
  const family = (name) => new RegExp(`family=${name.replace(/ /g, "\\+")}:([^&]*)`).exec(url)?.[1] ?? "";
  const request = (names) => `@import url('https://fonts.googleapis.com/css2?${names.map((name) => `family=${name.replace(/ /g, "+")}:${family(name)}`).join("&")}&display=swap');`;

  return {
    swiss: request(["Inter"]),
    brutalist: request(["Space Grotesk", "Space Mono"]),
    biophilic: request(["Fraunces", "Nunito Sans"]),
    minimal: request(["DM Sans"]),
    organic: request(["Bricolage Grotesque", "Quicksand"]),
    skeuomorphic: request(["Playfair Display", "Lora"]),
    cyberpunk: request(["Orbitron", "JetBrains Mono"]),
  };
}

function ts(value) {
  return JSON.stringify(value);
}

const MODULE = path.resolve("lib/design-tokens.ts");

async function writeModule() {
  const css = await readFile(CSS_PATH, "utf8");
  const designs = designNames(parseStylesheet(css));
  const tokens = await readTokens();
  const imports = fontImports(css);
  const lines = [
    "/**",
    " * Design-language tokens carried into the exported scaffold.",
    " *",
    " * GENERATED from app/globals.css — do not edit by hand.",
    " *   node scripts/design-tokens.mjs --write",
    " *",
    " * The stylesheet remains the source of truth. The scaffold cannot import",
    " * from Elvin, so it takes a literal copy; `--check` fails whenever the copy",
    " * and the stylesheet disagree.",
    " */",
    "",
    `export const DESIGNS = [${designs.map(ts).join(", ")}] as const;`,
    "export type Design = (typeof DESIGNS)[number];",
    'export type Theme = "dark" | "light";',
    "",
    "/** Google Fonts request for each language, taken from the stylesheet import. */",
    "export const DESIGN_FONTS: Record<Design, string> = {",
  ];

  for (const design of designs) lines.push(`  ${design}: ${ts(imports[design].replace(/^@import url\('|'\);$/g, ""))},`);
  lines.push("};", "", "/** Geometry, rhythm and type register. Names are the scaffold's own. */", "export const DESIGN_TOKENS: Record<Design, Record<string, string>> = {");

  for (const design of designs) {
    lines.push(`  ${design}: {`);
    for (const [name, value] of Object.entries(tokens[design].tokens)) lines.push(`    ${ts(name)}: ${ts(value)},`);
    lines.push("  },");
  }
  lines.push("};", "", "/** Sandbox palette, resolved for the selected theme. */", "export const DESIGN_PALETTE: Record<Design, Record<Theme, Record<string, string>>> = {");

  for (const design of designs) {
    lines.push(`  ${design}: {`);
    for (const theme of THEMES) {
      lines.push(`    ${theme}: {`);
      for (const [name, value] of Object.entries(tokens[design].themes[theme])) lines.push(`      ${ts(name)}: ${ts(value)},`);
      lines.push("    },");
    }
    lines.push("  },");
  }
  lines.push("};", "");

  await writeFile(MODULE, lines.join("\n"), "utf8");
  console.log(`wrote ${path.relative(process.cwd(), MODULE)} from ${path.relative(process.cwd(), CSS_PATH)}`);
}

function readStoredEntries(html, name) {
  const start = html.indexOf(`"${name}"`);
  if (start < 0) return {};
  const end = html.indexOf("{", start);
  const body = html.slice(end + 1, html.indexOf("}", end));
  return Object.fromEntries([...body.matchAll(/"(--[a-z0-9-]+)":\s*("(?:[^"\\]|\\.)*")/g)].map((m) => [m[1], JSON.parse(m[2])]));
}

async function checkParity() {
  const tokens = await readTokens();
  const designs = designNames(parseStylesheet(await readFile(CSS_PATH, "utf8")));
  const problems = [];

  for (const design of designs) {
    for (const theme of THEMES) {
      const response = await fetch(`${APP}/api/source?pattern=thread&theme=${theme}&design=${design}&tools=shown&reasoning=shown&open=collapsed&stream=true&model=x`);
      const zip = Buffer.from(await response.arrayBuffer());
      const globals = readZipEntry(zip, "app/globals.css");
      if (globals === null) {
        problems.push(`${design}/${theme}: app/globals.css missing from the zip`);
        continue;
      }

      const root = globals.match(/:root\{([^}]*)\}/)?.[1] ?? "";
      const emitted = Object.fromEntries([...root.matchAll(/(--[a-z0-9-]+):([^;]+)/g)].map((m) => [m[1], m[2].trim()]));
      const expected = { ...tokens[design].tokens, ...tokens[design].themes[theme] };

      for (const [name, value] of Object.entries(expected)) {
        if (emitted[name] !== value) problems.push(`${design}/${theme}: ${name} stylesheet=${value || "(unset)"} scaffold=${emitted[name] ?? "(absent)"}`);
      }
      for (const name of Object.keys(emitted)) {
        if (!(name in expected)) problems.push(`${design}/${theme}: ${name} emitted but not in the stylesheet`);
      }
    }
  }

  if (problems.length > 0) {
    console.error(`design parity: ${problems.length} mismatch(es)`);
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
  console.log(`design parity: ${designs.length * THEMES.length} design/theme pairs match app/globals.css`);
}

/** Entries are stored, not deflated, so a member is a slice between local headers. */
function readZipEntry(zip, name) {
  const needle = Buffer.from(name, "utf8");
  for (let offset = 0; offset + 30 <= zip.length; ) {
    if (zip.readUInt32LE(offset) !== 0x04034b50) return null;
    const size = zip.readUInt32LE(offset + 18);
    const nameLength = zip.readUInt16LE(offset + 26);
    const start = offset + 30 + nameLength;
    if (zip.subarray(start - nameLength, start).equals(needle)) return zip.subarray(start, start + size).toString("utf8");
    offset = start + size;
  }
  return null;
}

const mode = process.argv[2];
if (mode === "--write") await writeModule();
else if (mode === "--check") await checkParity();
else console.error("usage: node scripts/design-tokens.mjs --write | --check");

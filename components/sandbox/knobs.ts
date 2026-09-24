/**
 * The playground's knob vocabulary: the values each control can take. Kept here
 * rather than in the shell so the sidebar and the renderers can share it.
 */
export type Pattern = "thread" | "sidebar" | "modal";
export type AppTheme = "dark" | "light";
/**
 * Who the rendering is for. Tools and reasoning are always shown, so this picks
 * between two audiences rather than between on and off: Dev Mode draws the
 * agent's parts as they arrive, User Mode humanizes them for a product surface.
 */
export type ViewMode = "dev" | "user";
export type OpenMode = "collapsed" | "expanded";
/** How the sandbox is framed on the canvas, not something the app itself changes. */
export type Viewport = "desktop" | "mobile";
export type Toggle = "on" | "off";

/**
 * The design languages `app/globals.css` declares, in the order the sidebar
 * offers them. Listed here with the rest of the vocabulary so the shell and the
 * sandbox read the same set.
 */
export const DESIGNS = ["swiss", "brutalist", "biophilic", "minimal", "organic", "skeuomorphic", "cyberpunk"] as const;
export type Design = (typeof DESIGNS)[number];

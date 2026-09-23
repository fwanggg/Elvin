/**
 * The playground's knob vocabulary: the values each control can take. Kept here
 * rather than in the shell so the sidebar and the renderers can share it.
 */
export type Pattern = "thread" | "sidebar" | "modal";
export type AppTheme = "dark" | "light";
export type PartMode = "shown" | "hidden" | "off";
export type StepsMode = "raw" | "humanized";
export type OpenMode = "collapsed" | "expanded";
export type StreamMode = "true" | "false";
/** How the sandbox is framed on the canvas, not something the app itself changes. */
export type Viewport = "desktop" | "mobile";
export type Toggle = "on" | "off";

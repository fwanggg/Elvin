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
export type Toggle = "on" | "off";

"use client";

import { MarkdownTextPrimitive } from "@assistant-ui/react-markdown";
import { type ComponentProps, type ReactNode } from "react";
import remarkGfm from "remark-gfm";

/**
 * An assistant text part, parsed as the markdown agents actually write in.
 *
 * The primitive reads the active part itself, so this takes no text and belongs in the text
 * branch alone: it parses what the part holds and keeps parsing as it streams. GFM is on
 * because tables, strikethrough and autolinks are ordinary agent output.
 *
 * Styling is deliberately left to the stylesheet. The renderer ships a theme of its own, and
 * this sandbox draws every language from its own ink, rules and surfaces — so the markdown
 * elements are named in `app/globals.css` under `.markdown` instead.
 */
export function MarkdownText(props: Readonly<ComponentProps<typeof MarkdownTextPrimitive>>): ReactNode {
  return <MarkdownTextPrimitive remarkPlugins={[remarkGfm]} {...props} />;
}

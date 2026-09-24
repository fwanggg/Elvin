"use client";

import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { mono, ShimmerLabel } from "./surfaces";

export function ThinkingIndicator({
  label,
  elapsed,
  active = true,
  className,
  ...props
}: Omit<ComponentProps<"div">, "children" | "label" | "elapsed"> & {
  label: string;
  elapsed?: string;
  /** A settled reading is a record rather than a status: nothing pulses and nothing sweeps. */
  active?: boolean;
}) {
  return (
    <div
      data-slot="thinking-indicator"
      className={cn(
        "thinking-indicator flex items-center gap-2.5",
        className,
      )}

      {...props}
    >
      <span
        aria-hidden
        className={cn(
          "size-1.5 shrink-0 rounded-full bg-[var(--color-accent)]",
          active ? "animate-pulse motion-reduce:animate-none" : "opacity-30",
        )}
      />
      <ShimmerLabel
        key={label}
        active={active}
        className="thinking-label relative inline-block leading-none"
      >
        {label}
      </ShimmerLabel>
      {elapsed !== undefined && (
        <span className={cn(mono, "thinking-elapsed tabular-nums")}>
          {elapsed}
        </span>
      )}
    </div>
  );
}

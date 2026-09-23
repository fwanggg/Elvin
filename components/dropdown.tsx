"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

export type DropdownOption = Readonly<{ value: string; label: string }>;

type DropdownProps = Readonly<{
  /** Accessible name for the trigger; the visible section heading is not linked. */
  label: string;
  value: string;
  options: readonly DropdownOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}>;

type Placement = Readonly<{ top: number; left: number; width: number }>;

/** Space between the trigger and its menu. */
const GAP = 6;
/** Room the menu needs before it flips above the trigger instead. */
const MENU_MAX = 320;

/**
 * Select control drawn in the house style: a bordered value box that opens a
 * square menu, the chosen row marked bold with an accent square.
 *
 * The menu is portalled and fixed-positioned because the sidebar is a scroll
 * container — an in-flow menu would be clipped at its edge. Focus stays on the
 * trigger throughout; the active option is tracked by aria-activedescendant.
 */
export function Dropdown({ label, value, options, onChange, placeholder = "None", disabled = false }: DropdownProps): ReactNode {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const selectedIndex = options.findIndex((option) => option.value === value);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined;

  function place(): void {
    const trigger = triggerRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const height = Math.min(menuRef.current?.offsetHeight ?? 0, MENU_MAX);
    const below = rect.bottom + GAP + height;
    const flip = below > window.innerHeight && rect.top - GAP - height >= 0;

    setPlacement({
      top: flip ? rect.top - GAP - height : rect.bottom + GAP,
      left: rect.left,
      width: rect.width,
    });
  }

  // Measure after the menu is in the DOM but before paint, so it never flashes.
  useLayoutEffect(() => {
    if (!open) return;
    place();
    const onShift = () => place();
    window.addEventListener("scroll", onShift, true);
    window.addEventListener("resize", onShift);
    return () => {
      window.removeEventListener("scroll", onShift, true);
      window.removeEventListener("resize", onShift);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent): void {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    menuRef.current?.children[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex]);

  function show(): void {
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
    setOpen(true);
  }

  function choose(index: number): void {
    const option = options[index];
    if (option) onChange(option.value);
    setOpen(false);
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>): void {
    if (disabled) return;

    switch (event.key) {
      case "ArrowDown":
      case "ArrowUp": {
        event.preventDefault();
        if (!open) {
          show();
          return;
        }
        const step = event.key === "ArrowDown" ? 1 : -1;
        setActiveIndex((index) => (index + step + options.length) % options.length);
        return;
      }
      case "Enter":
      case " ": {
        event.preventDefault();
        if (open) choose(activeIndex);
        else show();
        return;
      }
      case "Escape": {
        if (open) {
          event.preventDefault();
          setOpen(false);
        }
        return;
      }
      case "Tab": {
        if (open) setOpen(false);
        return;
      }
      case "Home":
      case "End": {
        if (!open) return;
        event.preventDefault();
        setActiveIndex(event.key === "Home" ? 0 : options.length - 1);
        return;
      }
      default:
        return;
    }
  }

  return (
    <div className="dropdown">
      <button
        ref={triggerRef}
        className="dropdown-trigger"
        type="button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${listId}-${activeIndex}` : undefined}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onKeyDown}
      >
        <span className={selected ? "dropdown-value" : "dropdown-value placeholder"}>{selected?.label ?? placeholder}</span>
        <svg className="dropdown-chevron" viewBox="0 0 14 8" aria-hidden="true" focusable="false">
          <path d="M1 1l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" />
        </svg>
      </button>

      {open && placement && createPortal(
        <div className="dropdown-menu" id={listId} role="listbox" aria-label={label} ref={menuRef} style={{ top: placement.top, left: placement.left, width: placement.width }}>
          {options.map((option, index) => (
            <div
              key={option.value}
              id={`${listId}-${index}`}
              className="dropdown-option"
              role="option"
              aria-selected={option.value === value}
              data-active={index === activeIndex && index !== selectedIndex ? "true" : undefined}
              onMouseEnter={() => setActiveIndex(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(index)}
            >
              <span className="dropdown-option-label">{option.label}</span>
              {option.value === value && <span className="selection-mark" aria-hidden="true" />}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}

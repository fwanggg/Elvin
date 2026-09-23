import { clsx, type ClassValue } from "clsx";

/**
 * Join class names.
 *
 * shadcn's version pairs `clsx` with `tailwind-merge` so a later utility
 * displaces an earlier conflicting one. `tailwind-merge` is not installed in
 * this project, so conflicting utilities both survive and CSS order decides.
 * Adding `tailwind-merge` and passing the join through it is the upgrade.
 */
export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

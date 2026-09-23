"use client";

import type { ReactNode } from "react";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";

type ModelPickerProps = Readonly<{
  value: string;
  options: string[];
  placeholder: string;
  emptyLabel: string;
  onValueChange: (value: string) => void;
}>;

/**
 * shadcn combobox over the provider's model list. The trigger is a search field,
 * so a long `/v1/models` response is typed through instead of scrolled, and the
 * option label is the id the provider expects on the wire.
 */
export function ModelPicker({ value, options, placeholder, emptyLabel, onValueChange }: ModelPickerProps): ReactNode {
  const disabled = options.length === 0;

  return (
    <Combobox
      items={options}
      value={value.length > 0 ? value : null}
      onValueChange={(next) => onValueChange(next ?? "")}
      disabled={disabled}
      autoHighlight
    >
      <ComboboxInput className="model-picker" placeholder={placeholder} disabled={disabled} />
      <ComboboxContent className="model-picker-list">
        <ComboboxEmpty>{emptyLabel}</ComboboxEmpty>
        <ComboboxList>
          {(item: string) => (
            <ComboboxItem key={item} value={item}>
              <span className="min-w-0 truncate">{item}</span>
              {item === value && <span className="selection-mark" aria-hidden="true" />}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}

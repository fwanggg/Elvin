"use client";

import { useEffect, useState, type ReactNode } from "react";
import { AttachmentPrimitive, useAui, useAuiState } from "@assistant-ui/react";

/**
 * The two places an attachment is seen.
 *
 * In the composer it waits: a picture shows itself from the file itself, because the adapter that
 * turns it into a data URL only runs at send time; a file shows its name, and either can be taken
 * back out. In a message it has been sent, so it shows what was sent — the data URL the adapter
 * produced rather than the file, which does not survive a reload — and there is nothing to remove.
 *
 * Which of the two it is comes from the attachment itself, the way assistant-ui's own attachment
 * element asks: an attachment whose source is the message is a message's.
 */
export function ComposerAttachment(): ReactNode {
  return <Attachment />;
}

export function MessageAttachment(): ReactNode {
  return <Attachment />;
}

function Attachment(): ReactNode {
  const aui = useAui();
  const composing = aui.attachment.source !== "message";

  const type = useAuiState((state) => state.attachment.type);
  const name = useAuiState((state) => state.attachment.name);
  const file = useAuiState((state) => state.attachment.file);
  const sent = useAuiState((state) => state.attachment.status.type === "complete");
  const sentImage = useAuiState((state) => state.attachment.content?.find((part) => part.type === "image")?.image);
  // A restored message's attachment kept its name and its content but not a real File — that is
  // not something a blob URL can be made from, and its content is what should be shown anyway.
  const src = sentImage ?? useFileSrc(file instanceof Blob ? file : undefined);

  return (
    <AttachmentPrimitive.Root className={composing ? "attachment" : "attached"}>
      {type === "image" && src ? (
        <img className={composing ? "attachment-thumb" : "attached-image"} src={src} alt={name} />
      ) : (
        <span className="attachment-icon" aria-hidden="true">
          ▤
        </span>
      )}
      {composing ? (
        <>
          <span className="attachment-name">
            <AttachmentPrimitive.Name />
          </span>
          {!sent && (
            <span className="attachment-wait" aria-hidden="true">
              …
            </span>
          )}
          <AttachmentPrimitive.Remove className="attachment-remove" aria-label="Remove attachment">
            ✕
          </AttachmentPrimitive.Remove>
        </>
      ) : (
        type !== "image" && <span className="attached-name">{name}</span>
      )}
    </AttachmentPrimitive.Root>
  );
}

/** An object URL for a file still waiting to be sent, alive for as long as it is shown. */
function useFileSrc(file: File | undefined): string | undefined {
  const [src, setSrc] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!file) {
      setSrc(undefined);
      return;
    }
    const url = URL.createObjectURL(file);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  return src;
}

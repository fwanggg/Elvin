import { CompositeAttachmentAdapter, SimpleImageAttachmentAdapter, SimpleTextAttachmentAdapter } from "@assistant-ui/react";

/**
 * What the composer takes.
 *
 * An image travels as a data URL: that is what a vision model reads, and it lets the thread draw
 * the picture without a second copy of it living anywhere. A text file travels as its own text, so
 * a `.md` or a `.csv` reaches the model as something it can read rather than as bytes it cannot.
 * Both of assistant-ui's adapters refuse anything else — a PDF, an archive, a video — and the
 * composer shows the refusal on the row, which is better than sending a provider something it will
 * reject after the turn has already been paid for.
 *
 * The composite is the whole of it. A hand-written adapter would re-implement these two and take on
 * their edge cases: reading a file that changed under it, a paste with no name, a size no request
 * should carry.
 */
export const COMPOSER_ATTACHMENTS = new CompositeAttachmentAdapter([
  new SimpleImageAttachmentAdapter(),
  new SimpleTextAttachmentAdapter(),
]);

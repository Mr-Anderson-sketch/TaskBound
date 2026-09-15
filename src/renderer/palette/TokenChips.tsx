// renderer/palette/TokenChips — renders the live-parsed capture chips (DESIGN.md
// "Palette (keyboard sheets)"). Pure presentation over captureModel's chipsFor() output.
import type { CaptureChip } from './captureModel';

export function TokenChips({ chips }: { chips: CaptureChip[] }) {
  if (chips.length === 0) return null;
  return (
    <div className="tokens">
      {chips.map((chip, i) => (
        <span className="tok" key={i}>
          <span className="k">{chip.kind}</span>
          {chip.label}
        </span>
      ))}
    </div>
  );
}

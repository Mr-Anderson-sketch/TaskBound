// renderer/settings/sections/Strip — Task 5.1 addendum ruling 4 "Strip" section.
import type { Settings } from '../../../core/types';
import type { ActionInput } from '../../lib/useStore';
import type { Snapshot } from '../../../shared/ipc';
import type { Platform } from '../../../shared/platform';
import { Toggle } from '../../ui/Toggle';
import { Segmented } from '../../ui/Segmented';
import { Range } from '../../ui/Range';
import { SettingRow } from '../SettingRow';

export interface StripSectionProps {
  strip: Settings['strip'];
  capabilities: Snapshot['capabilities'];
  platform: Platform;
  dispatchOwn: (action: ActionInput) => void;
}

export function StripSection({ strip, capabilities, platform, dispatchOwn }: StripSectionProps) {
  const patch = (p: Partial<Settings['strip']>): void => dispatchOwn({ type: 'settings/patch', patch: { strip: p } });

  return (
    <>
      <h1>Strip</h1>
      <p className="pane-desc">The strip is the part of TimeBound that stays on screen.</p>

      <SettingRow label="Show the strip" hint="Turns the focus strip on or off.">
        {(id) => <Toggle checked={strip.enabled} onChange={(v) => patch({ enabled: v })} labelledBy={id} />}
      </SettingRow>

      <SettingRow label="Dock to" hint="Which edge of the screen the strip hugs.">
        {(id) => (
          <Segmented
            labelledBy={id}
            value={strip.edge}
            onChange={(edge) => patch({ edge })}
            options={[
              { value: 'top', label: 'Top' },
              { value: 'bottom', label: 'Bottom' }
            ]}
          />
        )}
      </SettingRow>

      <SettingRow label="Width" hint="Drag the strip's edge, or set it here.">
        {(id) => (
          <Range
            labelledBy={id}
            min={240}
            max={900}
            step={20}
            value={strip.width}
            onChange={(width) => patch({ width })}
            formatValue={(v) => `${v}px`}
          />
        )}
      </SettingRow>

      <SettingRow label="Collapsed pill" hint="Shows a small pill instead of the full strip.">
        {(id) => <Toggle checked={strip.collapsed} onChange={(v) => patch({ collapsed: v })} labelledBy={id} />}
      </SettingRow>

      <SettingRow label="Auto-hide" hint="Slides away after 3 s, peeks when you touch the edge. Stays while a timer runs.">
        {(id) => <Toggle checked={strip.autoHide} onChange={(v) => patch({ autoHide: v })} labelledBy={id} />}
      </SettingRow>

      <SettingRow label="Click-through" hint="Clicks pass through. Hover the dot to use the strip.">
        {(id) => <Toggle checked={strip.clickThrough} onChange={(v) => patch({ clickThrough: v })} labelledBy={id} />}
      </SettingRow>

      <SettingRow label="Backplate opacity" hint="Text stays solid.">
        {(id) => (
          <Range
            labelledBy={id}
            min={70}
            max={100}
            step={5}
            // The schema allows down to 0.4, but the model floor for text readability
            // is 0.7 (addendum ruling 4) — clamp the UI there even if an older/foreign
            // client had set something lower.
            value={Math.round(Math.max(0.7, strip.opacity) * 100)}
            onChange={(v) => patch({ opacity: v / 100 })}
            formatValue={(v) => `${v}%`}
          />
        )}
      </SettingRow>

      <SettingRow label="Hide from screen sharing" hint="Teams, Zoom and OBS won't see the strip.">
        {(id) => <Toggle checked={strip.hideFromCapture} onChange={(v) => patch({ hideFromCapture: v })} labelledBy={id} />}
      </SettingRow>

      <SettingRow
        label="Reserve screen space"
        hint="Maximised windows stop at the strip instead of going under it."
        disabled={!capabilities.appBar}
        disabledHint="Windows only, coming in a later update"
      >
        {(id) => (
          <Toggle
            checked={strip.reserveSpace}
            onChange={(v) => patch({ reserveSpace: v })}
            labelledBy={id}
            disabled={!capabilities.appBar}
          />
        )}
      </SettingRow>

      <SettingRow
        label="Hide over full-screen apps"
        hint="Stays out of the way when another app goes full-screen."
        disabled={!capabilities.fullscreenDetect}
        disabledHint="Windows only, coming in a later update"
      >
        {(id) => (
          <Toggle
            checked={strip.hideOverFullscreen}
            onChange={(v) => patch({ hideOverFullscreen: v })}
            labelledBy={id}
            disabled={!capabilities.fullscreenDetect}
          />
        )}
      </SettingRow>

      {platform === 'darwin' && (
        <SettingRow label="Menu bar mode" hint="Shows the current task in the menu bar instead.">
          {(id) => <Toggle checked={strip.menuBarMode} onChange={(v) => patch({ menuBarMode: v })} labelledBy={id} />}
        </SettingRow>
      )}
    </>
  );
}

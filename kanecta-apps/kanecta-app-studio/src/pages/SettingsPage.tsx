import { useState } from 'react';
import { useWorkspaceStore } from '../store/workspace';
import { useSettingsStore } from '../store/settings';
import type { AppSettings } from '../api';
import './SettingsPage.scss';

export const CONTENT_COLOURS = [
  { name: 'Light', hex: '#ffffff', fg: '#1a1a1a' },
  { name: 'Dark', hex: '#1a1a1a', fg: '#f0f0f0' },
  { name: 'Solarised', hex: '#fdf6e3', fg: '#657b83' },
];

export const THEME_COLOURS = [
  { name: 'White', hex: '#ffffff' },
  { name: 'Light Gray', hex: '#f5f5f5' },
  { name: 'Silver', hex: '#c0c0c0' },
  { name: 'Gray', hex: '#808080' },
  { name: 'Dark Gray', hex: '#404040' },
  { name: 'Black', hex: '#000000' },
  { name: 'Slate', hex: '#708090' },
  { name: 'Midnight Blue', hex: '#191970' },
  { name: 'Navy', hex: '#001f3f' },
  { name: 'Dark Blue', hex: '#00008b' },
  { name: 'Royal Blue', hex: '#4169e1' },
  { name: 'Cobalt', hex: '#0047ab' },
  { name: 'Steel Blue', hex: '#4682b4' },
  { name: 'Sky Blue', hex: '#87ceeb' },
  { name: 'Powder Blue', hex: '#b0e0e6' },
  { name: 'Teal', hex: '#008080' },
  { name: 'Cyan', hex: '#00bcd4' },
  { name: 'Aquamarine', hex: '#7fffd4' },
  { name: 'Dark Green', hex: '#006400' },
  { name: 'Forest Green', hex: '#228b22' },
  { name: 'Emerald', hex: '#50c878' },
  { name: 'Mint', hex: '#98ff98' },
  { name: 'Olive', hex: '#808000' },
  { name: 'Chartreuse', hex: '#7fff00' },
  { name: 'Lime', hex: '#32cd32' },
  { name: 'Sage', hex: '#bcb88a' },
  { name: 'Tan', hex: '#d2b48c' },
  { name: 'Beige', hex: '#f5f5dc' },
  { name: 'Sand', hex: '#f4a460' },
  { name: 'Gold', hex: '#ffd700' },
  { name: 'Amber', hex: '#ffbf00' },
  { name: 'Orange', hex: '#ff8c00' },
  { name: 'Coral', hex: '#ff6b6b' },
  { name: 'Tomato', hex: '#ff6347' },
  { name: 'Crimson', hex: '#dc143c' },
  { name: 'Red', hex: '#cc0000' },
  { name: 'Maroon', hex: '#800000' },
  { name: 'Rose', hex: '#ff007f' },
  { name: 'Hot Pink', hex: '#ff69b4' },
  { name: 'Pink', hex: '#ffb6c1' },
  { name: 'Lavender', hex: '#e6e6fa' },
  { name: 'Lilac', hex: '#c8a2c8' },
  { name: 'Violet', hex: '#ee82ee' },
  { name: 'Purple', hex: '#9b59b6' },
  { name: 'Deep Purple', hex: '#6a0dad' },
  { name: 'Indigo', hex: '#3f51b5' },
  { name: 'Plum', hex: '#dda0dd' },
  { name: 'Brown', hex: '#795548' },
  { name: 'Chocolate', hex: '#d2691e' },
];

export function contrastColor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? '#1a1a1a' : '#f0f0f0';
}

function isValidHex(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value);
}

interface SettingsPageProps {
  onClose: () => void;
}

export function SettingsPage({ onClose }: SettingsPageProps) {
  const { getApi } = useWorkspaceStore();
  const { background, foreground, contentBackground, contentForeground, setTheme } = useSettingsStore();

  const isPreset = THEME_COLOURS.some(c => c.hex === background);
  const [mode, setMode] = useState<'preset' | 'custom'>(isPreset ? 'preset' : 'custom');
  const [customBg, setCustomBg] = useState(background);
  const [customFg, setCustomFg] = useState(foreground);
  const [contentBg, setContentBg] = useState(contentBackground);
  const [contentFg, setContentFg] = useState(contentForeground);

  const applyTheme = async (bg: string, fg: string, cBg: string = contentBg, cFg: string = contentFg) => {
    setTheme(bg, fg, cBg, cFg);
    const settings: AppSettings = { background: bg, foreground: fg, contentBackground: cBg, contentForeground: cFg };
    await getApi().settings.save(settings);
  };

  const handleContentBgChange = (value: string) => {
    setContentBg(value);
    if (isValidHex(value)) {
      void applyTheme(background, foreground, value, contentFg);
    }
  };

  const handleContentFgChange = (value: string) => {
    setContentFg(value);
    if (isValidHex(value)) {
      void applyTheme(background, foreground, contentBg, value);
    }
  };

  const handleContentPresetChange = (hex: string) => {
    const preset = CONTENT_COLOURS.find(c => c.hex === hex);
    const fg = preset?.fg ?? contrastColor(hex);
    setContentBg(hex);
    setContentFg(fg);
    void applyTheme(background, foreground, hex, fg);
  };

  const handlePresetChange = (hex: string) => {
    setMode('preset');
    setContentBg('#ffffff');
    setContentFg('#1a1a1a');
    void applyTheme(hex, contrastColor(hex), '#ffffff', '#1a1a1a');
  };

  const handleCustomBgChange = (value: string) => {
    setCustomBg(value);
    if (isValidHex(value)) {
      const fg = isValidHex(customFg) ? customFg : contrastColor(value);
      setCustomFg(fg);
      void applyTheme(value, fg);
    }
  };

  const handleCustomFgChange = (value: string) => {
    setCustomFg(value);
    if (isValidHex(value) && isValidHex(customBg)) {
      void applyTheme(customBg, value);
    }
  };

  return (
    <div className="SettingsPage" role="dialog" aria-label="Settings">
      <div className="SettingsPage-header">
        <h2 className="SettingsPage-title">Settings</h2>
        <button className="SettingsPage-close" onClick={onClose} aria-label="Close settings">×</button>
      </div>
      <div className="SettingsPage-body">
        <section className="SettingsPage-section">
          <h3 className="SettingsPage-section-title">Theme</h3>

          <div className="SettingsPage-mode">
            <label className="SettingsPage-radio">
              <input
                type="radio"
                name="theme-mode"
                checked={mode === 'preset'}
                onChange={() => setMode('preset')}
              />
              Preset
            </label>
            <label className="SettingsPage-radio">
              <input
                type="radio"
                name="theme-mode"
                checked={mode === 'custom'}
                onChange={() => { setMode('custom'); setCustomBg(background); setCustomFg(foreground); }}
              />
              Custom
            </label>
          </div>

          {mode === 'preset' && (
            <label className="SettingsPage-label">
              Colour
              <select
                className="SettingsPage-select"
                value={background}
                onChange={(e) => handlePresetChange(e.target.value)}
              >
                {THEME_COLOURS.map(({ name, hex }) => (
                  <option key={hex} value={hex}>{name}</option>
                ))}
              </select>
            </label>
          )}

          {mode === 'custom' && (
            <div className="SettingsPage-custom">
              <label className="SettingsPage-label">
                Background
                <div className="SettingsPage-colour-row">
                  <input
                    type="color"
                    className="SettingsPage-colour-picker"
                    value={isValidHex(customBg) ? customBg : '#ffffff'}
                    onChange={(e) => handleCustomBgChange(e.target.value)}
                  />
                  <input
                    type="text"
                    className="SettingsPage-hex-input"
                    value={customBg}
                    onChange={(e) => handleCustomBgChange(e.target.value)}
                    placeholder="#rrggbb"
                    maxLength={7}
                    spellCheck={false}
                  />
                </div>
              </label>
              <label className="SettingsPage-label">
                Foreground
                <div className="SettingsPage-colour-row">
                  <input
                    type="color"
                    className="SettingsPage-colour-picker"
                    value={isValidHex(customFg) ? customFg : '#000000'}
                    onChange={(e) => handleCustomFgChange(e.target.value)}
                  />
                  <input
                    type="text"
                    className="SettingsPage-hex-input"
                    value={customFg}
                    onChange={(e) => handleCustomFgChange(e.target.value)}
                    placeholder="#rrggbb"
                    maxLength={7}
                    spellCheck={false}
                  />
                </div>
              </label>
            </div>
          )}
        </section>

        <section className="SettingsPage-section">
          <h3 className="SettingsPage-section-title">Content</h3>
          <label className="SettingsPage-label">
            Background
            <div className="SettingsPage-content-bg">
              <select
                className="SettingsPage-select"
                value={CONTENT_COLOURS.some(c => c.hex === contentBg) ? contentBg : ''}
                onChange={(e) => handleContentPresetChange(e.target.value)}
              >
                {CONTENT_COLOURS.map(({ name, hex }) => (
                  <option key={hex} value={hex}>{name}</option>
                ))}
              </select>
              <div className="SettingsPage-colour-row">
                <input
                  type="color"
                  className="SettingsPage-colour-picker"
                  value={isValidHex(contentBg) ? contentBg : '#ffffff'}
                  onChange={(e) => handleContentBgChange(e.target.value)}
                />
                <input
                  type="text"
                  className="SettingsPage-hex-input"
                  value={contentBg}
                  onChange={(e) => handleContentBgChange(e.target.value)}
                  placeholder="#rrggbb"
                  maxLength={7}
                  spellCheck={false}
                />
              </div>
            </div>
          </label>
          <label className="SettingsPage-label">
            Foreground
            <div className="SettingsPage-colour-row">
              <input
                type="color"
                className="SettingsPage-colour-picker"
                value={isValidHex(contentFg) ? contentFg : '#1a1a1a'}
                onChange={(e) => handleContentFgChange(e.target.value)}
              />
              <input
                type="text"
                className="SettingsPage-hex-input"
                value={contentFg}
                onChange={(e) => handleContentFgChange(e.target.value)}
                placeholder="#rrggbb"
                maxLength={7}
                spellCheck={false}
              />
            </div>
          </label>
        </section>
      </div>
    </div>
  );
}

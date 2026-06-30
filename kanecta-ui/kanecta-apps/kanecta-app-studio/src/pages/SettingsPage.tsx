import type { ViewMeta } from '../lib/viewMeta';
import { useViewLocation } from '../context/LocationContext';
import { useWorkingSetStore } from '../store/workingSet';

export const SettingsViewMeta: ViewMeta = {
  uuid: 'e8d7f6a5-b9c0-4d1e-2f3a-4b5c6d7e8f9a',
  name: 'settings',
  label: 'Settings',
  icon: 'Settings',
};
import { useSettingsStore, THEMES } from '../store/settings';
import type { AppSettings } from '../api';
import './SettingsPage.scss';

export function SettingsPage() {
  useViewLocation(SettingsViewMeta.uuid);
  const { getApi } = useWorkingSetStore();
  const { themeName, applyTheme } = useSettingsStore();

  const handleThemeChange = async (name: string) => {
    const theme = THEMES.find(t => t.name === name);
    if (!theme) return;
    applyTheme(theme);
    const settings: AppSettings = { themeName: theme.name, ...theme };
    await getApi().settings.save(settings);
  };

  return (
    <div className="SettingsPage">
      <div className="SettingsPage-body">
        <section className="SettingsPage-section">
          <h3 className="SettingsPage-section-title">Theme</h3>
          <label className="SettingsPage-label">
            <select
              className="SettingsPage-select"
              value={themeName}
              onChange={(e) => handleThemeChange(e.target.value)}
            >
              {THEMES.map(({ name }) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          </label>
        </section>
      </div>
    </div>
  );
}

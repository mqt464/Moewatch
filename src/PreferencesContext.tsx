import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { defaultPreferences, preferencesKey, readPreferences, type Preferences } from './preferences';

const PreferencesContext = createContext({ preferences: defaultPreferences, update: (_patch: Partial<Preferences>) => {}, error: '' });
export const usePreferences = () => useContext(PreferencesContext);

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState(() => {
    try { return readPreferences(localStorage.getItem(preferencesKey)); }
    catch { return { ...defaultPreferences }; }
  });
  const [error, setError] = useState('');
  useEffect(() => {
    document.documentElement.dataset.reduceMotion = String(preferences.reduceMotion);
    try { localStorage.setItem(preferencesKey, JSON.stringify(preferences)); setError(''); }
    catch { setError('Settings could not be saved. Changes will last only until you reload this page.'); }
  }, [preferences]);
  useEffect(() => {
    function sync(event: StorageEvent) {
      if (event.key === preferencesKey || event.key === null) setPreferences(readPreferences(event.newValue));
    }
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
  return <PreferencesContext.Provider value={{ preferences, update: patch => setPreferences(current => ({ ...current, ...patch })), error }}>{children}</PreferencesContext.Provider>;
}

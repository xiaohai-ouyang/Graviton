import { create } from 'zustand';

export type SettingsSectionId = 'general' | 'environment' | 'ai' | 'about';

export interface BackgroundLocationSnapshot {
  pathname: string;
  search: string;
  hash: string;
}

export interface SettingsRouteState {
  backgroundLocation?: BackgroundLocationSnapshot;
  fromModalTrigger?: boolean;
}

export const DEFAULT_SETTINGS_SECTION: SettingsSectionId = 'general';
export const DEFAULT_BACKGROUND_PATH = '/overview';

const CANONICAL_SECTIONS: ReadonlySet<SettingsSectionId> = new Set([
  'general',
  'environment',
  'ai',
  'about',
]);

export const SETTINGS_SECTION_ALIASES: Record<string, SettingsSectionId> = {
  appearance: 'general',
  widget: 'general',
  client: 'environment',
  shell: 'environment',
  runtime: 'environment',
  security: 'about',
  changelog: 'about',
  update: 'about',
  updates: 'about',
};

export function isSettingsPath(pathname: string): boolean {
  return pathname === '/settings' || pathname.startsWith('/settings/');
}

export function extractSettingsSlug(pathname: string): string {
  if (!pathname.startsWith('/settings/')) return '';
  const rest = pathname.slice('/settings/'.length);
  const slashIdx = rest.indexOf('/');
  return (slashIdx === -1 ? rest : rest.slice(0, slashIdx)).trim().toLowerCase();
}

export function resolveSettingsSection(rawSlug?: string): {
  section: SettingsSectionId;
  isCanonical: boolean;
} {
  const slug = (rawSlug ?? '').trim().toLowerCase();
  if (CANONICAL_SECTIONS.has(slug as SettingsSectionId)) {
    return { section: slug as SettingsSectionId, isCanonical: true };
  }
  const alias = SETTINGS_SECTION_ALIASES[slug];
  if (alias) {
    return { section: alias, isCanonical: false };
  }
  return { section: DEFAULT_SETTINGS_SECTION, isCanonical: false };
}

export function getBackgroundLocation(location: {
  pathname: string;
  search: string;
  hash: string;
  state: unknown;
}): BackgroundLocationSnapshot {
  if (!isSettingsPath(location.pathname)) {
    return {
      pathname: location.pathname,
      search: location.search,
      hash: location.hash,
    };
  }

  const routeState = location.state as SettingsRouteState | null | undefined;
  const bg = routeState?.backgroundLocation;
  if (bg && typeof bg.pathname === 'string' && !isSettingsPath(bg.pathname)) {
    return {
      pathname: bg.pathname,
      search: bg.search || '',
      hash: bg.hash || '',
    };
  }

  return {
    pathname: DEFAULT_BACKGROUND_PATH,
    search: '',
    hash: '',
  };
}

interface SettingsModalState {
  lastSection: SettingsSectionId;
  setLastSection: (section: SettingsSectionId) => void;
}

export const useSettingsModalStore = create<SettingsModalState>((set) => ({
  lastSection: DEFAULT_SETTINGS_SECTION,
  setLastSection: (section) => set({ lastSection: section }),
}));

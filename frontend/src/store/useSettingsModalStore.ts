import { create } from 'zustand';

export type SettingsSectionId = 'providers' | 'general' | 'environment' | 'ai' | 'about';

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
  'providers',
  'general',
  'environment',
  'ai',
  'about',
]);

export const SETTINGS_SECTION_ALIASES: Record<string, SettingsSectionId> = {
  accounts: 'providers',
  account: 'providers',
  provider: 'providers',
  antigravity: 'providers',
  qianwen: 'providers',
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

export interface ProviderSettingsIntent {
  provider: 'antigravity' | 'qianwen';
  action: 'add' | 'reauth';
  antigravityTab?: 'oauth' | 'token' | 'capture';
  qianwenAccountId?: string;
}

interface SettingsModalState {
  lastSection: SettingsSectionId;
  setLastSection: (section: SettingsSectionId) => void;
  pendingProviderIntent: ProviderSettingsIntent | null;
  setPendingProviderIntent: (intent: ProviderSettingsIntent | null) => void;
  consumePendingProviderIntent: () => ProviderSettingsIntent | null;
}

export const useSettingsModalStore = create<SettingsModalState>((set, get) => ({
  lastSection: DEFAULT_SETTINGS_SECTION,
  setLastSection: (section) => set({ lastSection: section }),
  pendingProviderIntent: null,
  setPendingProviderIntent: (intent) => set({ pendingProviderIntent: intent }),
  consumePendingProviderIntent: () => {
    const intent = get().pendingProviderIntent;
    if (intent) {
      set({ pendingProviderIntent: null });
    }
    return intent;
  },
}));

type SettingsNavigate = (
  to: string,
  options?: { replace?: boolean; state?: unknown }
) => void;

interface SettingsLocationLike {
  pathname: string;
  search: string;
  hash: string;
  state: unknown;
}

/** Opens (or switches within) the settings modal, optionally queuing a provider form intent. */
export function openSettingsModal(
  navigate: SettingsNavigate,
  location: SettingsLocationLike,
  section: SettingsSectionId,
  providerIntent?: ProviderSettingsIntent
): void {
  if (providerIntent) {
    useSettingsModalStore.getState().setPendingProviderIntent(providerIntent);
  }
  if (isSettingsPath(location.pathname)) {
    navigate(`/settings/${section}`, { replace: true, state: location.state });
    return;
  }
  navigate(`/settings/${section}`, {
    state: {
      backgroundLocation: getBackgroundLocation(location),
      fromModalTrigger: true,
    } satisfies SettingsRouteState,
  });
}

/** First connected provider quota page, or overview when nothing is connected. */
export function resolveSafeQuotaFallback(agCount: number, qwCount: number): string {
  if (agCount > 0) return '/quota/antigravity';
  if (qwCount > 0) return '/quota/qianwen';
  return '/overview';
}

/** True when pathname points at a provider quota page that has finished loading with zero accounts. */
export function isEmptyQuotaPath(
  pathname: string,
  agCount: number,
  agLoaded: boolean,
  qwCount: number,
  qwLoaded: boolean
): boolean {
  if (pathname === '/quota/antigravity') return agLoaded && agCount === 0;
  if (pathname === '/quota/qianwen') return qwLoaded && qwCount === 0;
  return false;
}

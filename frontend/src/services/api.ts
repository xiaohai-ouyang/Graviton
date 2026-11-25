import * as WailsApp from '../../wailsjs/go/main/App';
import {
  AccountDisplay,
  AIConfig,
  AppInfo,
  BatchImportResult,
  BatchRefreshResult,
  ChangelogRelease,
  DeepSeekAccountDisplay,
  DeepSeekBatchRefreshResult,
  LogEntry,
  OAuthStartResult,
  ProcessState,
  ProjectCommand,
  ProjectRecord,
  QianwenAccountDisplay,
  QianwenAuthStartResponse,
  QianwenBatchRefreshResult,
  ShellConfig,
  ShellEnvironmentInfo,
  SwitchResult,
  UpdateState,
  ApiError,
} from '../types';

export function parseError(err: unknown): ApiError {
  if (typeof err === 'string') {
    // Check if format is "[CODE] Message"
    const match = err.match(/^\[([A-Z_]+)\]\s*(.*)$/);
    if (match) {
      return { code: match[1], message: match[2] };
    }
    return { code: 'UNKNOWN_ERROR', message: err };
  }
  if (err && typeof err === 'object') {
    const e = err as Record<string, unknown>;
    if (typeof e.code === 'string' && typeof e.message === 'string') {
      return { code: e.code, message: e.message };
    }
    if (typeof e.message === 'string') {
      return parseError(e.message);
    }
  }
  return { code: 'UNKNOWN_ERROR', message: String(err) };
}

export const api = {
  async listAccounts(): Promise<AccountDisplay[]> {
    try {
      return await WailsApp.ListAccounts();
    } catch (e) {
      throw parseError(e);
    }
  },

  async captureCurrentAccount(): Promise<AccountDisplay> {
    try {
      return await WailsApp.CaptureCurrentAccount();
    } catch (e) {
      throw parseError(e);
    }
  },

  async startOAuthLogin(): Promise<OAuthStartResult> {
    try {
      return await WailsApp.StartOAuthLogin();
    } catch (e) {
      throw parseError(e);
    }
  },

  async cancelOAuthLogin(): Promise<void> {
    try {
      await WailsApp.CancelOAuthLogin();
    } catch (e) {
      throw parseError(e);
    }
  },

  async completeOAuthWithCallbackURL(rawURL: string): Promise<AccountDisplay> {
    try {
      return await WailsApp.CompleteOAuthWithCallbackURL(rawURL);
    } catch (e) {
      throw parseError(e);
    }
  },

  async importRefreshTokens(rawInput: string): Promise<BatchImportResult> {
    try {
      return await WailsApp.ImportRefreshTokens(rawInput);
    } catch (e) {
      throw parseError(e);
    }
  },

  async refreshAccountQuota(id: string): Promise<AccountDisplay> {
    try {
      return await WailsApp.RefreshAccountQuota(id);
    } catch (e) {
      throw parseError(e);
    }
  },

  async refreshAllQuotas(): Promise<BatchRefreshResult[]> {
    try {
      return await WailsApp.RefreshAllQuotas();
    } catch (e) {
      throw parseError(e);
    }
  },

  async switchAccount(id: string): Promise<SwitchResult> {
    try {
      return await WailsApp.SwitchAccount(id);
    } catch (e) {
      throw parseError(e);
    }
  },

  async deleteAccount(id: string): Promise<void> {
    try {
      await WailsApp.DeleteAccount(id);
    } catch (e) {
      throw parseError(e);
    }
  },

  async selectClientPath(): Promise<string> {
    try {
      return await WailsApp.SelectClientPath();
    } catch (e) {
      throw parseError(e);
    }
  },

  async getClientPath(): Promise<string> {
    try {
      return await WailsApp.GetClientPath();
    } catch (e) {
      throw parseError(e);
    }
  },

  async isWidgetMode(): Promise<boolean> {
    try {
      return await WailsApp.IsWidgetMode();
    } catch {
      return false;
    }
  },

  async getWidgetConnection() {
    return WailsApp.GetWidgetConnection();
  },

  async setWidgetSize(width: number, height: number): Promise<void> {
    return WailsApp.SetWidgetSize(width, height);
  },

  async getWidgetWindowBounds() {
    return WailsApp.GetWidgetWindowBounds();
  },

  async setWidgetPosition(x: number, y: number): Promise<void> {
    return WailsApp.SetWidgetPosition(x, y);
  },

  async getScreenWorkArea() {
    return WailsApp.GetScreenWorkArea();
  },

  async toggleWidget(): Promise<boolean> {
    try {
      return await WailsApp.ToggleWidget();
    } catch (e) {
      throw parseError(e);
    }
  },

  async isWidgetOpen(): Promise<boolean> {
    try {
      return await WailsApp.IsWidgetOpen();
    } catch {
      return false;
    }
  },

  async getWidgetAlwaysOnTop(): Promise<boolean> {
    try {
      return await WailsApp.GetWidgetAlwaysOnTop();
    } catch {
      return false;
    }
  },

  async setWidgetAlwaysOnTop(alwaysOnTop: boolean): Promise<void> {
    try {
      await WailsApp.SetWidgetAlwaysOnTop(alwaysOnTop);
    } catch (e) {
      throw parseError(e);
    }
  },

  async applyWidgetAlwaysOnTop(alwaysOnTop: boolean): Promise<void> {
    try {
      await WailsApp.ApplyWidgetAlwaysOnTop(alwaysOnTop);
    } catch {
      // Ignore outside widget mode
    }
  },

  async syncTheme(theme: string): Promise<void> {
    try {
      await WailsApp.SyncTheme(theme);
    } catch {
      // Ignore in widget mode or startup
    }
  },

  async syncResetTimeFormat(format: 'countdown' | 'absolute'): Promise<void> {
    try {
      await WailsApp.SyncResetTimeFormat(format);
    } catch {
      // Ignore in widget mode or startup
    }
  },

  // --- Environment / Project Launcher APIs ---
  async listProjects(): Promise<ProjectRecord[]> {
    try {
      return (await WailsApp.ListProjects()) || [];
    } catch (e) {
      throw parseError(e);
    }
  },

  async selectAndImportProject(): Promise<ProjectRecord | null> {
    try {
      return await WailsApp.SelectAndImportProject();
    } catch (e) {
      throw parseError(e);
    }
  },

  async importProjectByPath(path: string): Promise<ProjectRecord> {
    try {
      return await WailsApp.ImportProjectByPath(path);
    } catch (e) {
      throw parseError(e);
    }
  },

  async rescanProject(projectID: string): Promise<ProjectRecord> {
    try {
      return await WailsApp.RescanProject(projectID);
    } catch (e) {
      throw parseError(e);
    }
  },

  async analyzeProjectWithAI(projectID: string): Promise<ProjectRecord> {
    try {
      return await WailsApp.AnalyzeProjectWithAI(projectID);
    } catch (e) {
      throw parseError(e);
    }
  },

  async deleteProject(projectID: string): Promise<void> {
    try {
      await WailsApp.DeleteProject(projectID);
    } catch (e) {
      throw parseError(e);
    }
  },

  async reorderProjects(pinnedIDs: string[], unpinnedIDs: string[]): Promise<ProjectRecord[]> {
    try {
      return (await WailsApp.ReorderProjects(pinnedIDs, unpinnedIDs)) || [];
    } catch (e) {
      throw parseError(e);
    }
  },

  async saveProjectCommand(projectID: string, cmd: ProjectCommand): Promise<ProjectRecord> {
    try {
      return await WailsApp.SaveProjectCommand(projectID, cmd);
    } catch (e) {
      throw parseError(e);
    }
  },

  async deleteProjectCommand(projectID: string, commandID: string): Promise<ProjectRecord> {
    try {
      return await WailsApp.DeleteProjectCommand(projectID, commandID);
    } catch (e) {
      throw parseError(e);
    }
  },

  async togglePinCommand(projectID: string, commandID: string): Promise<ProjectRecord> {
    try {
      return await WailsApp.TogglePinCommand(projectID, commandID);
    } catch (e) {
      throw parseError(e);
    }
  },

  async startCommand(projectID: string, commandID: string): Promise<void> {
    try {
      await WailsApp.StartCommand(projectID, commandID);
    } catch (e) {
      throw parseError(e);
    }
  },

  async stopCommand(commandID: string): Promise<void> {
    try {
      await WailsApp.StopCommand(commandID);
    } catch (e) {
      throw parseError(e);
    }
  },

  async restartCommand(projectID: string, commandID: string): Promise<void> {
    try {
      await WailsApp.RestartCommand(projectID, commandID);
    } catch (e) {
      throw parseError(e);
    }
  },

  async getProcessStates(): Promise<Record<string, ProcessState>> {
    try {
      return (await WailsApp.GetProcessStates()) || {};
    } catch {
      return {};
    }
  },

  async getCommandLogs(commandID: string): Promise<LogEntry[]> {
    try {
      return (await WailsApp.GetCommandLogs(commandID)) || [];
    } catch {
      return [];
    }
  },

  async clearCommandLogs(commandID: string): Promise<void> {
    try {
      await WailsApp.ClearCommandLogs(commandID);
    } catch {
      // Ignore
    }
  },

  async openCommandInTerminal(projectID: string, commandID: string): Promise<void> {
    try {
      await WailsApp.OpenCommandInTerminal(projectID, commandID);
    } catch (e) {
      throw parseError(e);
    }
  },

  async openProjectFolder(projectID: string): Promise<void> {
    try {
      await WailsApp.OpenProjectFolder(projectID);
    } catch (e) {
      throw parseError(e);
    }
  },

  async openProjectTerminal(projectID: string): Promise<void> {
    try {
      await WailsApp.OpenProjectTerminal(projectID);
    } catch (e) {
      throw parseError(e);
    }
  },

  async openProjectInClient(projectID: string): Promise<void> {
    try {
      await WailsApp.OpenProjectInClient(projectID);
    } catch (e) {
      throw parseError(e);
    }
  },

  async getAIConfig(): Promise<AIConfig> {
    return WailsApp.GetAIConfig();
  },

  async saveAIConfig(cfg: AIConfig): Promise<void> {
    try {
      await WailsApp.SaveAIConfig(cfg);
    } catch (e) {
      throw parseError(e);
    }
  },

  async testAIConfig(cfg: AIConfig): Promise<void> {
    try {
      await WailsApp.TestAIConfig(cfg);
    } catch (e) {
      throw parseError(e);
    }
  },

  async getShellEnvironment(): Promise<ShellEnvironmentInfo> {
    return WailsApp.GetShellEnvironment();
  },

  async saveShellConfig(cfg: ShellConfig): Promise<ShellEnvironmentInfo> {
    try {
      return await WailsApp.SaveShellConfig(cfg);
    } catch (e) {
      throw parseError(e);
    }
  },

  async selectGitBashPath(): Promise<string> {
    try {
      return await WailsApp.SelectGitBashPath();
    } catch (e) {
      throw parseError(e);
    }
  },

  async resetGitBashPath(): Promise<ShellEnvironmentInfo> {
    try {
      return await WailsApp.ResetGitBashPath();
    } catch (e) {
      throw parseError(e);
    }
  },

  // --- App Version & Changelog APIs ---
  async getAppInfo(): Promise<AppInfo> {
    return WailsApp.GetAppInfo();
  },

  async getChangelog(): Promise<ChangelogRelease[]> {
    try {
      return (await WailsApp.GetChangelog()) || [];
    } catch {
      return [];
    }
  },

  // --- App Update APIs ---
  async getUpdateState(): Promise<UpdateState | null> {
    try {
      return await WailsApp.GetUpdateState();
    } catch {
      return null;
    }
  },

  async checkForUpdates(): Promise<UpdateState> {
    try {
      return await WailsApp.CheckForUpdates();
    } catch (e) {
      throw parseError(e);
    }
  },

  async saveUpdateSettings(autoCheck: boolean, mirrorURL: string): Promise<UpdateState> {
    try {
      return await WailsApp.SaveUpdateSettings(autoCheck, mirrorURL);
    } catch (e) {
      throw parseError(e);
    }
  },

  async skipUpdateVersion(version: string): Promise<UpdateState> {
    try {
      return await WailsApp.SkipUpdateVersion(version);
    } catch (e) {
      throw parseError(e);
    }
  },

  async installUpdate(): Promise<UpdateState> {
    try {
      return await WailsApp.InstallUpdate();
    } catch (e) {
      throw parseError(e);
    }
  },

  async restartToApplyUpdate(): Promise<UpdateState> {
    try {
      return await WailsApp.RestartToApplyUpdate();
    } catch (e) {
      throw parseError(e);
    }
  },

  async restartToApplyUpdateNow(): Promise<UpdateState> {
    try {
      return await WailsApp.RestartToApplyUpdateNow();
    } catch (e) {
      throw parseError(e);
    }
  },

  async cancelDeferredUpdate(): Promise<UpdateState | null> {
    try {
      return await WailsApp.CancelDeferredUpdate();
    } catch {
      return null;
    }
  },

  async dismissUpdatedNotice(): Promise<void> {
    try {
      await WailsApp.DismissUpdatedNotice();
    } catch {
      // Ignore outside Wails runtime
    }
  },

  async openReleasePage(rawURL: string): Promise<void> {
    try {
      await WailsApp.OpenReleasePage(rawURL);
    } catch (e) {
      throw parseError(e);
    }
  },

  async listQianwenAccounts(): Promise<QianwenAccountDisplay[]> {
    try {
      return await WailsApp.ListQianwenAccounts();
    } catch (e) {
      throw parseError(e);
    }
  },

  async startQianwenAuth(reauthAccountID = ''): Promise<QianwenAuthStartResponse> {
    try {
      return await WailsApp.StartQianwenAuth(reauthAccountID);
    } catch (e) {
      throw parseError(e);
    }
  },

  async cancelQianwenAuth(): Promise<void> {
    try {
      await WailsApp.CancelQianwenAuth();
    } catch (e) {
      throw parseError(e);
    }
  },

  async refreshQianwenAccount(id: string): Promise<QianwenAccountDisplay> {
    try {
      return await WailsApp.RefreshQianwenAccount(id);
    } catch (e) {
      throw parseError(e);
    }
  },

  async refreshAllQianwenAccounts(): Promise<QianwenBatchRefreshResult[]> {
    try {
      return await WailsApp.RefreshAllQianwenAccounts();
    } catch (e) {
      throw parseError(e);
    }
  },

  async deleteQianwenAccount(id: string): Promise<void> {
    try {
      await WailsApp.DeleteQianwenAccount(id);
    } catch (e) {
      throw parseError(e);
    }
  },

  // --- DeepSeek Balance APIs ---
  async listDeepSeekAccounts(): Promise<DeepSeekAccountDisplay[]> {
    try {
      return (await WailsApp.ListDeepSeekAccounts()) || [];
    } catch (e) {
      throw parseError(e);
    }
  },

  async addDeepSeekAccount(name: string, apiKey: string): Promise<DeepSeekAccountDisplay> {
    try {
      return await WailsApp.AddDeepSeekAccount(name, apiKey);
    } catch (e) {
      throw parseError(e);
    }
  },

  async updateDeepSeekAccount(
    id: string,
    name: string,
    apiKey: string
  ): Promise<DeepSeekAccountDisplay> {
    try {
      return await WailsApp.UpdateDeepSeekAccount(id, name, apiKey);
    } catch (e) {
      throw parseError(e);
    }
  },

  async refreshDeepSeekAccount(id: string): Promise<DeepSeekAccountDisplay> {
    try {
      return await WailsApp.RefreshDeepSeekAccount(id);
    } catch (e) {
      throw parseError(e);
    }
  },

  async refreshAllDeepSeekAccounts(): Promise<DeepSeekBatchRefreshResult[]> {
    try {
      return (await WailsApp.RefreshAllDeepSeekAccounts()) || [];
    } catch (e) {
      throw parseError(e);
    }
  },

  async deleteDeepSeekAccount(id: string): Promise<void> {
    try {
      await WailsApp.DeleteDeepSeekAccount(id);
    } catch (e) {
      throw parseError(e);
    }
  },
};

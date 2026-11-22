import { appservice, buildinfo, client, envmgr, storage, updater } from '../../wailsjs/go/models';

export type AppInfo = buildinfo.AppInfo;
export type ChangelogRelease = buildinfo.ChangelogRelease;
export type ChangelogChange = buildinfo.ChangelogChange;

export type AccountDisplay = appservice.AccountDisplay;
export type BatchRefreshResult = appservice.BatchRefreshResult;
export type OAuthStartResult = appservice.OAuthStartResult;
export type BatchImportResult = appservice.BatchImportResult;
export type ImportItemResult = appservice.ImportItemResult;

export interface OAuthCompletionEvent {
  account?: AccountDisplay;
  error?: string;
  cancelled?: boolean;
}
export type SwitchResult = client.SwitchResult;
export type QuotaGroup = storage.QuotaGroup;
export type QuotaBucket = storage.QuotaBucket;
export type ModelQuota = storage.ModelQuota;

export type ProjectRecord = storage.ProjectRecord;
export type ProjectCommand = storage.ProjectCommand;
export type LogEntry = envmgr.LogEntry;
export type AIConfig = envmgr.AIConfig;
export type ShellConfig = envmgr.ShellConfig;
export type ShellAvailability = envmgr.ShellAvailability;
export type ShellEnvironmentInfo = envmgr.ShellEnvironmentInfo;
export type UpdateState = updater.UpdateState;

export interface ProcessState {
  projectId: string;
  commandId: string;
  status: 'stopped' | 'running' | 'error';
  pid: number;
  exitCode: number;
  startedAt?: string;
  errorMsg?: string;
}

export interface ApiError {
  code: string;
  message: string;
}

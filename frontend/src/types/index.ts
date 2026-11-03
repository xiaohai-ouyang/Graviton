import { appservice, client, storage } from '../../wailsjs/go/models';

export type AccountDisplay = appservice.AccountDisplay;
export type BatchRefreshResult = appservice.BatchRefreshResult;
export type SwitchResult = client.SwitchResult;
export type QuotaGroup = storage.QuotaGroup;
export type QuotaBucket = storage.QuotaBucket;
export type ModelQuota = storage.ModelQuota;

export interface ApiError {
  code: string;
  message: string;
}

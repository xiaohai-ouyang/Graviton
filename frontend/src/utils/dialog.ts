export const FEEDBACK_BANNER_ATTR = 'data-feedback-banner';

type OutsideDialogEvent = {
  target: EventTarget | null;
  detail?: { originalEvent?: Event };
};

function isInsideFeedbackBanner(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    Boolean(target.closest(`[${FEEDBACK_BANNER_ATTR}="true"]`))
  );
}

/**
 * Checks whether a Radix outside-interaction event originated inside the FeedbackBanner toast portal.
 */
export function isFeedbackBannerEvent(event: OutsideDialogEvent): boolean {
  return (
    isInsideFeedbackBanner(event.target) ||
    isInsideFeedbackBanner(event.detail?.originalEvent?.target ?? null)
  );
}

/**
 * Checks whether any modal dialog is currently mounted in the DOM.
 */
export function hasOtherDialogOpen(excludeSettingsDialog = false): boolean {
  if (typeof document === 'undefined') return false;
  const selector = excludeSettingsDialog
    ? '[role="dialog"]:not([data-settings-dialog="true"])'
    : '[role="dialog"]';
  return document.querySelector(selector) !== null;
}

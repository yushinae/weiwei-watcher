export const ACCOUNT_POSITIONS_REFRESH_EVENT = 'weiwei:account-positions-refresh';

export interface AccountPositionsRefreshDetail {
  reason: 'live-order-submitted';
  venue?: string;
  orderId?: string;
  at: number;
}

export function requestAccountPositionsRefresh(detail: Omit<AccountPositionsRefreshDetail, 'at'>): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<AccountPositionsRefreshDetail>(ACCOUNT_POSITIONS_REFRESH_EVENT, {
    detail: { ...detail, at: Date.now() },
  }));
}

export function subscribeAccountPositionsRefresh(fn: (detail: AccountPositionsRefreshDetail) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const listener = ((event: CustomEvent<AccountPositionsRefreshDetail>) => fn(event.detail)) as EventListener;
  window.addEventListener(ACCOUNT_POSITIONS_REFRESH_EVENT, listener);
  return () => window.removeEventListener(ACCOUNT_POSITIONS_REFRESH_EVENT, listener);
}

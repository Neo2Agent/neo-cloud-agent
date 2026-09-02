import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { CatalogModal } from "./components/Catalog";

export type ConfirmRequest = {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
};

type ConfirmFn = (request: ConfirmRequest) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const resolveRef = useRef<(value: boolean) => void>(() => undefined);

  const confirm = useCallback<ConfirmFn>((next) => {
    resolveRef.current(false);
    return new Promise((resolve) => {
      resolveRef.current = resolve;
      setRequest(next);
    });
  }, []);

  const settle = (value: boolean) => {
    resolveRef.current(value);
    resolveRef.current = () => undefined;
    setRequest(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <CatalogModal
        title={request?.title ?? ""}
        open={Boolean(request)}
        onClose={() => settle(false)}
        footer={
          <>
            <button type="button" className="ghost" onClick={() => settle(false)}>
              取消
            </button>
            <button
              type="button"
              className={request?.danger ? "quiet-btn danger" : "proj-add"}
              onClick={() => settle(true)}
            >
              {request?.confirmLabel ?? "确定"}
            </button>
          </>
        }
      >
        <p className="confirm-copy">{request?.message}</p>
      </CatalogModal>
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const confirm = useContext(ConfirmContext);
  if (!confirm) {
    throw new Error("useConfirm requires ConfirmProvider");
  }
  return confirm;
}

export type ToastKind = "ok" | "err";
export type ToastItem = { id: number; kind: ToastKind; text: string };

type ToastListener = (item: ToastItem) => void;

const toastListeners = new Set<ToastListener>();
let toastSeq = 1;

export function subscribeToast(listener: ToastListener): () => void {
  toastListeners.add(listener);
  return () => {
    toastListeners.delete(listener);
  };
}

export function toast(text: string, kind: ToastKind = "ok"): ToastItem {
  const item = { id: toastSeq++, kind, text };
  for (const listener of toastListeners) listener(item);
  return item;
}

const TOAST_MS = 3200;

export function ToastHost() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    return subscribeToast((item) => {
      setItems((prev) => [...prev.slice(-2), item]);
      window.setTimeout(() => {
        setItems((prev) => prev.filter((entry) => entry.id !== item.id));
      }, TOAST_MS);
    });
  }, []);

  if (items.length === 0) return null;
  return (
    <div className="toast-host" aria-live="polite">
      {items.map((item) => (
        <p key={item.id} className={`toast is-${item.kind}`} role="status">
          {item.text}
        </p>
      ))}
    </div>
  );
}

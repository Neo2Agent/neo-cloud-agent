import { useEffect, type FormEvent, type ReactNode } from "react";
import { avatarTone, CATALOG_PAGE_SIZE, clampPage, initials, pageCount } from "../catalog.js";
import { IconChevronLeft, IconChevronRight, IconPlus, IconSearch, IconX } from "../icons.js";

export function CatalogToolbar(props: {
  search: string;
  onSearch: (value: string) => void;
  placeholder: string;
  actionLabel?: string;
  onAction?: () => void;
  extra?: ReactNode;
}) {
  return (
    <div className="catalog-toolbar">
      <label className="catalog-search">
        <IconSearch />
        <input
          type="search"
          value={props.search}
          placeholder={props.placeholder}
          onChange={(e) => props.onSearch(e.target.value)}
        />
      </label>
      {props.extra}
      {props.onAction && props.actionLabel ? (
        <button type="button" className="catalog-create" onClick={props.onAction}>
          <IconPlus />
          {props.actionLabel}
        </button>
      ) : null}
    </div>
  );
}

export function CatalogTabs<T extends string>(props: {
  tabs: Array<{ id: T; label: string; count?: number }>;
  active: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className="catalog-tabs" role="tablist">
      {props.tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={props.active === tab.id}
          className={props.active === tab.id ? "on" : ""}
          onClick={() => props.onChange(tab.id)}
        >
          {tab.label}
          {tab.count != null ? <span>{tab.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function CatalogPager(props: {
  page: number;
  total: number;
  pageSize?: number;
  onPage: (page: number) => void;
}) {
  const pageSize = props.pageSize ?? CATALOG_PAGE_SIZE;
  const pages = pageCount(props.total, pageSize);
  const page = clampPage(props.page, props.total, pageSize);
  if (props.total === 0 || pages <= 1) return null;
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(props.total, page * pageSize);
  return (
    <div className="catalog-pager">
      <span>
        {start}–{end} / {props.total}
      </span>
      <div className="catalog-pager-btns">
        <button type="button" disabled={page <= 1} onClick={() => props.onPage(page - 1)} aria-label="上一页">
          <IconChevronLeft />
        </button>
        <em>
          {page} / {pages}
        </em>
        <button type="button" disabled={page >= pages} onClick={() => props.onPage(page + 1)} aria-label="下一页">
          <IconChevronRight />
        </button>
      </div>
    </div>
  );
}

export function CatalogEmpty(props: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="catalog-empty">
      <strong>{props.title}</strong>
      {props.hint ? <p>{props.hint}</p> : null}
      {props.action}
    </div>
  );
}

export function CatalogGrid(props: { children: ReactNode }) {
  return <ul className="catalog-grid">{props.children}</ul>;
}

export function CatalogCard(props: {
  title: string;
  description?: string;
  badge?: string;
  meta?: string;
  example?: string;
  initial?: string;
  onOpen?: () => void;
  actions?: ReactNode;
}) {
  const tone = avatarTone(props.title);
  const body = (
    <>
      <span className={`catalog-avatar tone-${tone}`}>{props.initial ?? initials(props.title)}</span>
      <span className="catalog-card-copy">
        <span className="catalog-card-top">
          <strong>{props.title}</strong>
          {props.badge ? <em className="catalog-badge">{props.badge}</em> : null}
        </span>
        {props.description ? <p>{props.description}</p> : null}
        {props.example ? <small>例：{props.example}</small> : null}
        {props.meta ? <em className="catalog-card-meta">{props.meta}</em> : null}
      </span>
    </>
  );
  return (
    <li className="catalog-card">
      {props.onOpen ? (
        <button type="button" className="catalog-card-main" onClick={props.onOpen}>
          {body}
        </button>
      ) : (
        <div className="catalog-card-main">{body}</div>
      )}
      {props.actions ? <div className="catalog-card-actions">{props.actions}</div> : null}
    </li>
  );
}

export function CatalogModal(props: {
  title: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!props.open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") props.onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props.open, props.onClose]);

  if (!props.open) return null;
  return (
    <div className="catalog-modal-backdrop" onClick={props.onClose} role="presentation">
      <div
        className={`catalog-modal${props.wide ? " wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="catalog-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <h3 id="catalog-modal-title">{props.title}</h3>
          <button type="button" className="icon-btn" onClick={props.onClose} aria-label="关闭">
            <IconX />
          </button>
        </header>
        <div className="catalog-modal-body">{props.children}</div>
        {props.footer ? <footer>{props.footer}</footer> : null}
      </div>
    </div>
  );
}

export function CatalogForm(props: {
  onSubmit: (event: FormEvent) => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <form className={props.className ?? "catalog-form"} onSubmit={props.onSubmit}>
      {props.children}
    </form>
  );
}

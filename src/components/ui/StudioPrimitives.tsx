import React, { useEffect } from 'react';
import { ChevronDown, ChevronUp, X } from 'lucide-react';

export interface SegmentedTabOption<T extends string> {
  id: T;
  label: string;
  count?: number;
  icon?: React.ComponentType<{ className?: string }>;
}

interface SegmentedTabsProps<T extends string> {
  options: Array<SegmentedTabOption<T>>;
  value: T;
  onChange: (value: T) => void;
  fullWidth?: boolean;
  size?: 'sm' | 'md';
  variant?: 'pill' | 'underline';
  className?: string;
}

export function SegmentedTabs<T extends string>({
  options,
  value,
  onChange,
  fullWidth = false,
  size = 'md',
  variant = 'pill',
  className = '',
}: SegmentedTabsProps<T>) {
  if (variant === 'underline') {
    return (
      <div
        role="tablist"
        className={`flex items-center border-b border-white/[0.08] ${
          fullWidth ? 'w-full grid' : 'gap-1'
        } ${className}`}
        style={
          fullWidth
            ? { gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }
            : undefined
        }
      >
        {options.map((opt) => {
          const Icon = opt.icon;
          const active = value === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onChange(opt.id)}
              className={`relative min-h-[42px] px-3 py-2 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                active ? 'text-cyan-300' : 'text-zinc-400 hover:text-white'
              }`}
            >
              {Icon && (
                <Icon
                  className={`w-3.5 h-3.5 shrink-0 ${active ? 'text-cyan-400' : 'text-zinc-400'}`}
                />
              )}
              <span>{opt.label}</span>
              {typeof opt.count === 'number' && (
                <span
                  className={`font-mono text-[11px] tabular-nums ${
                    active ? 'text-cyan-300/90' : 'text-zinc-500'
                  }`}
                >
                  {opt.count}
                </span>
              )}
              {active && (
                <span className="absolute left-2 right-2 -bottom-px h-0.5 rounded-full bg-gradient-to-r from-cyan-400 to-violet-400" />
              )}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div
      role="tablist"
      className={`inline-flex items-center gap-1 p-1 rounded-xl bg-[#080b12] border border-white/[0.08] ${
        fullWidth ? 'w-full grid' : ''
      } ${className}`}
      style={
        fullWidth
          ? { gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }
          : undefined
      }
    >
      {options.map((opt) => {
        const Icon = opt.icon;
        const active = value === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.id)}
            className={`${
              size === 'sm'
                ? 'min-h-[36px] px-2.5 py-1.5 text-xs'
                : 'min-h-[42px] sm:min-h-[38px] px-3 py-1.5 text-xs'
            } rounded-lg font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer whitespace-nowrap shrink-0 ${
              active
                ? 'bg-gradient-to-r from-cyan-400/20 to-violet-500/20 text-cyan-200 border border-cyan-400/45 shadow-[0_0_16px_-6px_rgba(34,211,238,0.45)]'
                : 'text-zinc-400 hover:text-white hover:bg-white/[0.04] border border-transparent'
            }`}
          >
            {Icon && (
              <Icon
                className={`w-3.5 h-3.5 shrink-0 ${active ? 'text-cyan-300' : 'text-zinc-400'}`}
              />
            )}
            <span>{opt.label}</span>
            {typeof opt.count === 'number' && (
              <span
                className={`font-mono text-[11px] tabular-nums ${
                  active ? 'text-cyan-300' : 'text-zinc-500'
                }`}
              >
                {opt.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

interface CollapsibleSectionProps {
  title: string;
  subtitle?: string;
  isOpen: boolean;
  onToggle: () => void;
  rightMeta?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export const CollapsibleSection: React.FC<CollapsibleSectionProps> = ({
  title,
  subtitle,
  isOpen,
  onToggle,
  rightMeta,
  children,
  className = '',
}) => {
  return (
    <div className={`studio-panel rounded-2xl overflow-hidden ${className}`}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        className="w-full min-h-[52px] px-4 py-3 sm:px-5 flex items-center justify-between gap-3 text-left hover:bg-white/[0.025] transition-colors cursor-pointer"
      >
        <div className="min-w-0">
          <div className="font-display text-sm font-bold text-white truncate">{title}</div>
          {subtitle && (
            <p className="text-xs text-zinc-400 truncate mt-0.5">{subtitle}</p>
          )}
        </div>
        <div className="flex items-center gap-2.5 shrink-0">
          {rightMeta}
          <span className="w-8 h-8 rounded-lg bg-white/[0.04] border border-white/[0.08] flex items-center justify-center text-zinc-300">
            {isOpen ? (
              <ChevronUp className="w-4 h-4 text-cyan-400" />
            ) : (
              <ChevronDown className="w-4 h-4" />
            )}
          </span>
        </div>
      </button>
      {isOpen && (
        <div className="border-t border-white/[0.07] p-4 sm:p-5">
          {children}
        </div>
      )}
    </div>
  );
};

interface BottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  maxWidthClass?: string;
  maxWidth?: string;
}

export const BottomSheet: React.FC<BottomSheetProps> = ({
  isOpen,
  onClose,
  title,
  subtitle,
  icon,
  children,
  footer,
  maxWidthClass = 'max-w-xl',
  maxWidth,
}) => {
  const resolvedMaxWidth = maxWidth || maxWidthClass;
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm p-0 sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`w-full ${resolvedMaxWidth} max-h-[88dvh] bg-[#0d111a] border border-white/[0.12] rounded-t-3xl sm:rounded-2xl flex flex-col overflow-hidden shadow-2xl`}
      >
        <div className="sm:hidden flex justify-center pt-2.5 pb-1">
          <div className="w-10 h-1 rounded-full bg-white/20" />
        </div>
        <div className="px-4 py-3 sm:px-5 sm:py-4 border-b border-white/[0.08] flex items-start justify-between gap-3 shrink-0">
          <div className="flex items-start gap-2.5 min-w-0">
            {icon && (
              <div className="w-8 h-8 rounded-lg bg-cyan-400/15 border border-cyan-400/35 text-cyan-300 flex items-center justify-center shrink-0 mt-0.5">
                {icon}
              </div>
            )}
            <div className="min-w-0">
              <h3 className="font-display text-base font-bold text-white truncate">{title}</h3>
              {subtitle && <p className="text-xs text-zinc-400 mt-0.5">{subtitle}</p>}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="min-h-[40px] min-w-[40px] rounded-xl bg-white/[0.05] hover:bg-white/[0.1] text-zinc-300 hover:text-white flex items-center justify-center transition-colors cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-5">{children}</div>

        {footer && (
          <div className="px-4 py-3 sm:px-5 border-t border-white/[0.08] bg-[#090c14] shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};

interface StatusBannerProps {
  tone: 'info' | 'warning' | 'error' | 'success';
  title?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
}

export const StatusBanner: React.FC<StatusBannerProps> = ({
  tone,
  title,
  children,
  action,
  icon,
  className = '',
}) => {
  const toneClasses = {
    info: 'bg-cyan-950/35 border-cyan-500/35 text-cyan-100',
    warning: 'bg-amber-950/40 border-amber-500/40 text-amber-100',
    error: 'bg-red-950/45 border-red-500/45 text-red-100',
    success: 'bg-emerald-950/35 border-emerald-500/35 text-emerald-100',
  }[tone];

  return (
    <div
      className={`p-3.5 sm:p-4 rounded-xl border text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${toneClasses} ${className}`}
    >
      <div className="flex items-start gap-2.5 min-w-0">
        {icon && <div className="shrink-0 mt-0.5">{icon}</div>}
        <div className="space-y-0.5 min-w-0">
          {title && <div className="font-semibold text-white">{title}</div>}
          <div className="text-zinc-200 leading-relaxed">{children}</div>
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
};

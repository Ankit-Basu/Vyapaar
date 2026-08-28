"use client";

import { Check, Palette, Search, Shuffle } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { cn } from "@/lib/utils";

/**
 * 43 Themes with accurate swatches matching the screenshots.
 */
export const THEMES = [
  { id: "default", label: "Default", swatches: ["#7c6bff", "#5227ff", "#ff9ffc", "#12b5a5"] },
  { id: "amber-minimal", label: "Amber Minimal", swatches: ["#f59e0b", "#d97706", "#78350f", "#451a03"] },
  { id: "amethyst-haze", label: "Amethyst Haze", swatches: ["#a855f7", "#7c3aed", "#581c87", "#3b0764"] },
  { id: "bold-tech", label: "Bold Tech", swatches: ["#4f46e5", "#6366f1", "#1e1b4b", "#312e81"] },
  { id: "bubblegum", label: "Bubblegum", swatches: ["#fef08a", "#f472b6", "#ec4899", "#831843"] },
  { id: "caffeine", label: "Caffeine", swatches: ["#fde68a", "#d97706", "#78350f", "#451a03"] },
  { id: "candyland", label: "Candyland", swatches: ["#f43f5e", "#38bdf8", "#4ade80", "#a855f7"] },
  { id: "catppuccin", label: "Catppuccin", swatches: ["#cba6f7", "#89dceb", "#6c7086", "#1e1e2e"] },
  { id: "claude", label: "Claude", swatches: ["#ea580c", "#c2410c", "#ffffff", "#431407"] },
  { id: "claymorphism", label: "Claymorphism", swatches: ["#818cf8", "#4f46e5", "#374151", "#1f2937"] },
  { id: "clean-slate", label: "Clean Slate", swatches: ["#58a6ff", "#1f6feb", "#30363d", "#161b22"] },
  { id: "cosmic-night", label: "Cosmic Night", swatches: ["#8b5cf6", "#6d28d9", "#3b0764", "#1e1b4b"] },
  { id: "crimson", label: "Crimson", swatches: ["#e11d48", "#be123c", "#881337", "#4c0519"] },
  { id: "cyberpunk", label: "Cyberpunk", swatches: ["#06b6d4", "#f43f5e", "#facc15", "#1e1b4b"] },
  { id: "emerald", label: "Emerald", swatches: ["#10b981", "#059669", "#065f46", "#022c22"] },
  { id: "forest", label: "Forest", swatches: ["#22c55e", "#16a34a", "#166534", "#14532d"] },
  { id: "frost", label: "Frost", swatches: ["#38bdf8", "#0284c7", "#075985", "#082f49"] },
  { id: "gold", label: "Gold", swatches: ["#eab308", "#ca8a04", "#854d0e", "#422006"] },
  { id: "graphite", label: "Graphite", swatches: ["#a1a1aa", "#71717a", "#3f3f46", "#18181b"] },
  { id: "kodama-grove", label: "Kodama Grove", swatches: ["#84cc16", "#65a30d", "#3f6212", "#1a2e05"] },
  { id: "lavender", label: "Lavender", swatches: ["#c084fc", "#a855f7", "#6b21a8", "#3b0764"] },
  { id: "matrix", label: "Matrix", swatches: ["#22c55e", "#15803d", "#14532d", "#052e16"] },
  { id: "midnight-bloom", label: "Midnight Bloom", swatches: ["#818cf8", "#6366f1", "#4338ca", "#1e1b4b"] },
  { id: "mocha-mousse", label: "Mocha Mousse", swatches: ["#d5bdaf", "#b08968", "#7f5539", "#3c2a21"] },
  { id: "modern-minimal", label: "Modern Minimal", swatches: ["#3b82f6", "#1d4ed8", "#1e3a8a", "#0f172a"] },
  { id: "mono", label: "Mono", swatches: ["#9ca3af", "#6b7280", "#374151", "#111827"] },
  { id: "moonlight", label: "Moonlight", swatches: ["#93c5fd", "#60a5fa", "#2563eb", "#1e3a8a"] },
  { id: "nature", label: "Nature", swatches: ["#4ade80", "#22c55e", "#15803d", "#14532d"] },
  { id: "neo-brutalism", label: "Neo Brutalism", swatches: ["#ff0055", "#00e5ff", "#ffe600", "#ffffff"] },
  { id: "neon", label: "Neon", swatches: ["#00ff66", "#00ffff", "#ff00ff", "#000000"] },
  { id: "nordic-frost", label: "Nordic Frost", swatches: ["#7dd3fc", "#38bdf8", "#0369a1", "#082f49"] },
  { id: "northern-lights", label: "Northern Lights", swatches: ["#14b8a6", "#2dd4bf", "#0d9488", "#042f2e"] },
  { id: "notebook", label: "Notebook", swatches: ["#e5e7eb", "#9ca3af", "#4b5563", "#1f2937"] },
  { id: "ocean-breeze", label: "Ocean Breeze", swatches: ["#0ea5e9", "#0284c7", "#0369a1", "#0c4a6e"] },
  { id: "pastel-dreams", label: "Pastel Dreams", swatches: ["#c084fc", "#f472b6", "#bae6fd", "#fef08a"] },
  { id: "perpetuity", label: "Perpetuity", swatches: ["#06b6d4", "#0891b2", "#0e7490", "#155e75"] },
  { id: "quantum-rose", label: "Quantum Rose", swatches: ["#e879f9", "#c026d3", "#86198f", "#4a044e"] },
  { id: "razorpay", label: "Razorpay", swatches: ["#3395ff", "#1f6feb", "#1f4fd8", "#0c2340"] },
  { id: "retro-arcade", label: "Retro Arcade", swatches: ["#f43f5e", "#f97316", "#06b6d4", "#1e1b4b"] },
  { id: "rose-gold", label: "Rose Gold", swatches: ["#fb7185", "#f43f5e", "#fda4af", "#881337"] },
  { id: "sunset", label: "Sunset", swatches: ["#f97316", "#e11d48", "#fbbf24", "#431407"] },
  { id: "synthwave", label: "Synthwave", swatches: ["#d946ef", "#06b6d4", "#f43f5e", "#1e1b4b"] },
  { id: "vaporwave", label: "Vaporwave", swatches: ["#f472b6", "#38bdf8", "#c084fc", "#1e1b4b"] },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];

const STORAGE_KEY = "agentmandi-theme";

export const THEME_INIT_SCRIPT = `try{var t=localStorage.getItem(${JSON.stringify(
  STORAGE_KEY,
)});if(t)document.documentElement.dataset.theme=t;}catch(e){}`;

const THEME_IDS = new Set<string>(THEMES.map((t) => t.id));

/** Any unknown or retired id collapses to `default`. */
function normaliseTheme(raw: string | undefined): ThemeId {
  return raw && THEME_IDS.has(raw) ? (raw as ThemeId) : "default";
}

export function useTheme() {
  const theme = useSyncExternalStore(
    (notify) => {
      const observer = new MutationObserver(notify);
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["data-theme"],
      });
      return () => observer.disconnect();
    },
    () => normaliseTheme(document.documentElement.dataset.theme),
    () => "default" as ThemeId,
  );

  /*
   * A theme id saved by the previous six-palette system (indigo, ember, frost…)
   * has no CSS block here, so it would leave the page on whatever `:root`
   * happens to define. Rewrite it once, on mount, rather than leaving the
   * document in a state no stylesheet describes.
   */
  useEffect(() => {
    const raw = document.documentElement.dataset.theme;
    const valid = normaliseTheme(raw);
    if (raw !== valid) {
      document.documentElement.dataset.theme = valid;
      try {
        localStorage.setItem(STORAGE_KEY, valid);
      } catch {
        /* private mode */
      }
    }
  }, []);

  const setTheme = useCallback((id: ThemeId) => {
    document.documentElement.dataset.theme = id;
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      /* private mode */
    }
  }, []);

  return { theme, setTheme };
}

function Swatch({ colors, className }: { colors: readonly string[]; className?: string }) {
  return (
    <span className={cn("flex shrink-0 gap-0.5", className)}>
      {colors.map((c, i) => (
        <span key={i} className="size-2 rounded-[2px]" style={{ background: c }} />
      ))}
    </span>
  );
}

export function ThemeSwitcher({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    setTimeout(() => searchInputRef.current?.focus(), 50);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const filtered = useMemo(() => {
    if (!search.trim()) return THEMES;
    const q = search.toLowerCase();
    return THEMES.filter((t) => t.label.toLowerCase().includes(q) || t.id.includes(q));
  }, [search]);

  const active = THEMES.find((t) => t.id === theme) ?? THEMES[0];

  const handleRandom = () => {
    const next = THEMES[Math.floor(Math.random() * THEMES.length)];
    setTheme(next.id);
  };

  return (
    <div ref={root} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Colour theme: ${active.label}`}
        className="u-focus-ring skeu skeu-gloss glass-surface glass-d1 inline-flex h-9 items-center gap-2 rounded-xl px-3 text-[0.75rem] font-medium text-heading"
      >
        <Palette size={13} className="text-accent-text" />
        <Swatch colors={active.swatches} />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Colour theme"
          className="glass-surface glass-d3 absolute right-0 z-50 mt-2 w-64 rounded-2xl p-2 shadow-2xl backdrop-blur-2xl"
          style={{ maxHeight: "480px", display: "flex", flexDirection: "column" }}
        >
          {/* Search bar */}
          <div className="relative mb-2 shrink-0">
            <Search size={13} className="absolute top-1/2 left-2.5 -translate-y-1/2 text-mute-500" />
            <input
              ref={searchInputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search themes..."
              className="w-full rounded-xl border border-white/[0.08] bg-white/[0.04] py-1.5 pr-3 pl-8 text-[12px] text-heading placeholder-mute-500 outline-none transition-colors focus:border-brand-500/50"
            />
          </div>

          {/* Header with count and actions */}
          <div className="mb-1.5 flex shrink-0 items-center justify-between px-2 text-[11px] font-medium text-mute-400">
            <span>{filtered.length} themes</span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={handleRandom}
                title="Random theme"
                className="grid size-5 place-items-center rounded text-mute-400 hover:bg-white/[0.08] hover:text-heading"
              >
                <Shuffle size={11} />
              </button>
            </div>
          </div>

          {/* Theme list */}
          <div className="flex-1 overflow-y-auto space-y-0.5 pr-0.5">
            {filtered.map((t) => {
              const selected = t.id === theme;
              return (
                <button
                  key={t.id}
                  role="option"
                  aria-selected={selected}
                  type="button"
                  onClick={() => {
                    setTheme(t.id);
                    setOpen(false);
                  }}
                  className={cn(
                    "u-focus-ring flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[0.8125rem] transition-colors",
                    selected
                      ? "bg-brand-500/20 text-heading font-medium"
                      : "text-body hover:bg-white/[0.06] hover:text-heading",
                  )}
                >
                  <Swatch colors={t.swatches} />
                  <span className="flex-1 truncate text-[12px]">{t.label}</span>
                  {selected && <Check size={12} className="text-accent-text" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

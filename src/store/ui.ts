"use client";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Session } from "@/api/contracts";

export type Lang = "en" | "bn";
export type WinState = { x: number; y: number; w: number; h: number; z: number; open: boolean; min: boolean; max: boolean };

type UI = {
  lang: Lang;
  bnDigits: boolean;
  session: Session | null;
  locked: boolean;
  lastActive: number;
  windows: Record<string, WinState>;
  zTop: number;
  mobileApp: string | null;
  spotlight: boolean;
  setLang: (l: Lang) => void;
  setBnDigits: (b: boolean) => void;
  setSession: (s: Session | null) => void;
  setLocked: (b: boolean) => void;
  touch: () => void;
  setSpotlight: (b: boolean) => void;
  openApp: (id: string) => void;
  closeApp: (id: string) => void;
  focusApp: (id: string) => void;
  toggleMin: (id: string) => void;
  toggleMax: (id: string) => void;
  moveApp: (id: string, p: Partial<WinState>) => void;
  setMobileApp: (id: string | null) => void;
};

function defaultWin(i: number): WinState {
  return { x: 90 + i * 28, y: 70 + i * 24, w: 980, h: 600, z: 1, open: false, min: false, max: false };
}

export const useUI = create<UI>()(
  persist(
    (set, get) => ({
      lang: "en",
      bnDigits: false,
      session: null,
      locked: false,
      lastActive: Date.now(),
      windows: {},
      zTop: 10,
      mobileApp: null,
      spotlight: false,
      setLang: (lang) => set({ lang }),
      setBnDigits: (bnDigits) => set({ bnDigits }),
      setSession: (session) => set({ session, locked: false, windows: session ? get().windows : {}, mobileApp: null }),
      setLocked: (locked) => set({ locked }),
      touch: () => set({ lastActive: Date.now() }),
      setSpotlight: (spotlight) => set({ spotlight }),
      openApp: (id) => {
        const w = get().windows;
        const z = get().zTop + 1;
        const cur = w[id] ?? defaultWin(Object.keys(w).length);
        set({ windows: { ...w, [id]: { ...cur, open: true, min: false, z } }, zTop: z, mobileApp: id, spotlight: false });
      },
      closeApp: (id) => {
        const w = get().windows;
        const cur = w[id];
        if (cur) set({ windows: { ...w, [id]: { ...cur, open: false, min: false } } });
        if (get().mobileApp === id) set({ mobileApp: null });
      },
      focusApp: (id) => {
        const w = get().windows;
        const cur = w[id];
        const z = get().zTop + 1;
        if (cur) set({ windows: { ...w, [id]: { ...cur, z, min: false } }, zTop: z });
      },
      toggleMin: (id) => {
        const w = get().windows;
        const cur = w[id];
        if (cur) set({ windows: { ...w, [id]: { ...cur, min: !cur.min } } });
      },
      toggleMax: (id) => {
        const w = get().windows;
        const cur = w[id];
        if (cur) set({ windows: { ...w, [id]: { ...cur, max: !cur.max } } });
      },
      moveApp: (id, p) => {
        const w = get().windows;
        const cur = w[id];
        if (cur) set({ windows: { ...w, [id]: { ...cur, ...p } } });
      },
      setMobileApp: (mobileApp) => set({ mobileApp }),
    }),
    {
      name: "shikkaos:v1:ui",
      partialize: (s) => ({ lang: s.lang, bnDigits: s.bnDigits, windows: s.windows }),
    },
  ),
);

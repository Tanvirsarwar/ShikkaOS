"use client";
import { AnimatePresence, motion } from "motion/react";
import { Maximize2, Minimize2, Minus, X } from "lucide-react";
import { useRef, type PointerEvent as RPE, type ReactNode } from "react";
import { Btn } from "@/components/ui";
import { useT } from "@/lib/i18n";
import { useUI, type WinState } from "@/store/ui";
import type { AppDef } from "@/apps/registry";

const TOP = 48;
const DOCK = 88;

function clampWin(w: WinState, vw: number, vh: number): Partial<WinState> {
  const width = Math.max(420, Math.min(w.w, vw - 16));
  const height = Math.max(300, Math.min(w.h, vh - TOP - DOCK + 20));
  return {
    w: width,
    h: height,
    x: Math.min(Math.max(8 - width + 140, w.x), vw - 140),
    y: Math.min(Math.max(8, w.y), vh - TOP - 60),
  };
}

export function WindowFrame({ app, win, children }: { app: AppDef; win: WinState; children: ReactNode }) {
  const { t } = useT();
  const { focusApp, moveApp, closeApp, toggleMin, toggleMax } = useUI();
  const drag = useRef<{ px: number; py: number; x: number; y: number } | null>(null);
  const rs = useRef<{ px: number; py: number; w: number; h: number; mode: "r" | "b" | "rb" } | null>(null);
  const Icon = app.icon;
  const topZ = useUI((s) => Math.max(0, ...Object.values(s.windows).filter((w) => w.open && !w.min).map((w) => w.z)));

  const onDragStart = (e: RPE<HTMLDivElement>) => {
    if (win.max || (e.target as HTMLElement).closest("button")) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { px: e.clientX, py: e.clientY, x: win.x, y: win.y };
    focusApp(app.id);
  };
  const onDragMove = (e: RPE<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    moveApp(app.id, clampWin({ ...win, x: d.x + e.clientX - d.px, y: d.y + e.clientY - d.py }, window.innerWidth, window.innerHeight));
  };
  const onDragEnd = (e: RPE<HTMLDivElement>) => {
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const rsStart = (mode: "r" | "b" | "rb") => (e: RPE<HTMLDivElement>) => {
    if (win.max) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    rs.current = { px: e.clientX, py: e.clientY, w: win.w, h: win.h, mode };
    focusApp(app.id);
  };
  const rsMove = (e: RPE<HTMLDivElement>) => {
    const r = rs.current;
    if (!r) return;
    const w = r.mode === "b" ? r.w : r.w + e.clientX - r.px;
    const h = r.mode === "r" ? r.h : r.h + e.clientY - r.py;
    moveApp(app.id, clampWin({ ...win, w, h }, window.innerWidth, window.innerHeight));
  };
  const rsEnd = (e: RPE<HTMLDivElement>) => {
    rs.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const style = win.max
    ? { left: 0, top: 0, right: 0, bottom: DOCK - 14, zIndex: win.z }
    : { left: win.x, top: win.y, width: win.w, height: win.h, zIndex: win.z };

  return (
    <AnimatePresence>
      {win.open ? (
        <motion.section
          key={app.id}
          initial={{ opacity: 0, scale: 0.96, y: 10 }}
          animate={{ opacity: win.min ? 0 : 1, scale: win.min ? 0.9 : 1, y: win.min ? 30 : 0 }}
          exit={{ opacity: 0, scale: 0.96 }}
          transition={{ duration: 0.16 }}
          className={`win absolute flex flex-col overflow-hidden ${win.z >= topZ ? "win-focus" : ""}`}
          style={{ ...style, display: win.min ? "none" : "flex", ["--accent" as string]: app.color }}
          onPointerDown={() => focusApp(app.id)}
          aria-label={t(`app.${app.id}`)}
        >
          <div className="glass flex h-10 shrink-0 cursor-grab select-none items-center gap-2 border-x-0 border-t-0 px-3 active:cursor-grabbing" onPointerDown={onDragStart} onPointerMove={onDragMove} onPointerUp={onDragEnd} onDoubleClick={() => toggleMax(app.id)}>
            <span className="grid size-6 place-items-center rounded-md text-white" style={{ background: app.color }}><Icon size={14} /></span>
            <span className="flex-1 truncate text-[13px] font-bold">{t(`app.${app.id}`)}</span>
            <Btn variant="icon" size="sm" aria-label={t("win.minimize")} onClick={() => toggleMin(app.id)}><Minus size={14} /></Btn>
            <Btn variant="icon" size="sm" aria-label={t("win.maximize")} onClick={() => toggleMax(app.id)}>{win.max ? <Minimize2 size={13} /> : <Maximize2 size={13} />}</Btn>
            <Btn variant="icon" size="sm" aria-label={t("win.close")} onClick={() => closeApp(app.id)}><X size={14} /></Btn>
          </div>
          <div className="scroll-thin min-h-0 flex-1 overflow-auto">{children}</div>
          {!win.max ? (
            <>
              <div className="absolute right-0 top-10 h-[calc(100%-52px)] w-1.5 cursor-ew-resize" onPointerDown={rsStart("r")} onPointerMove={rsMove} onPointerUp={rsEnd} />
              <div className="absolute bottom-0 left-0 h-1.5 w-[calc(100%-12px)] cursor-ns-resize" onPointerDown={rsStart("b")} onPointerMove={rsMove} onPointerUp={rsEnd} />
              <div className="absolute bottom-0 right-0 size-3.5 cursor-nwse-resize" onPointerDown={rsStart("rb")} onPointerMove={rsMove} onPointerUp={rsEnd} />
            </>
          ) : null}
        </motion.section>
      ) : null}
    </AnimatePresence>
  );
}

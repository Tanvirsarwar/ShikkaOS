"use client";
import { ArrowLeft, Bell, Languages, Lock, LogOut, Moon, Search, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { repos } from "@/api/factory";
import { keys, useMut, useNotificationsQ, useSchoolQ } from "@/api/hooks";
import { Avatar, Btn, Monogram, Skeleton, Tip } from "@/components/ui";
import { fmtDateTime } from "@/lib/dates";
import { useHydrated, useT } from "@/lib/i18n";
import { SEASON_ACCENT } from "@/lib/season";
import { useUI } from "@/store/ui";
import { appById, appsFor } from "@/apps/registry";
import { LockScreen } from "./LockScreen";
import { Spotlight } from "./Spotlight";
import { WindowFrame } from "./WindowFrame";
import { Widgets } from "./Widgets";
import { launch } from "./launch";
import { useMedia } from "./useMedia";
import { useSeason } from "./useSeason";

const IDLE_MS = 15 * 60 * 1000;

function NotificationCenter() {
  const { t, lang } = useT();
  const [open, setOpen] = useState(false);
  const { data } = useNotificationsQ();
  const clear = useMut(() => repos.notice.markAllRead(), [keys.notifications]);
  const unread = (data ?? []).filter((n) => !n.read).length;
  return (
    <div className="relative">
      <Tip label={t("notif.title")}>
        <Btn variant="icon" aria-label={t("notif.title")} onClick={() => setOpen(!open)}>
          <Bell size={16} />
          {unread ? <span className="absolute right-1 top-1 size-2 rounded-full" style={{ background: "var(--danger)" }} /> : null}
        </Btn>
      </Tip>
      {open ? (
        <div className="card absolute right-0 top-10 z-[9100] w-[320px] max-w-[90vw] p-2" style={{ boxShadow: "var(--shadow-lg)" }}>
          <div className="flex items-center justify-between px-2 py-1"><span className="text-[13px] font-bold">{t("notif.title")}</span><Btn size="sm" variant="ghost" onClick={() => clear.mutate(undefined)}>{t("notif.clear")}</Btn></div>
          <ul className="scroll-thin max-h-[320px] overflow-auto">
            {(data ?? []).length === 0 ? <li className="faint p-4 text-center text-[13px]">{t("notif.empty")}</li> : (data ?? []).map((n) => (
              <li key={n.id} className="rounded-lg px-2 py-2 text-[13px]" style={{ background: n.read ? undefined : "var(--paper-2)" }}><div>{n.text}</div><div className="faint text-[11px]">{fmtDateTime(n.at, lang)}</div></li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function UserMenu() {
  const { t } = useT();
  const session = useUI((s) => s.session);
  const setSession = useUI((s) => s.setSession);
  const setLocked = useUI((s) => s.setLocked);
  const router = useRouter();
  const [open, setOpen] = useState(false);
  if (!session) return null;
  return (
    <div className="relative">
      <button type="button" className="flex items-center gap-2 rounded-xl px-1.5 py-1 hover:bg-[var(--paper-2)]" onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open}>
        <Avatar name={session.name} size={28} />
        <span className="hidden text-left text-[12px] leading-tight md:block"><span className="block max-w-[140px] truncate font-bold">{session.name}</span><span className="faint">{t(`role.${session.role}`)}</span></span>
      </button>
      {open ? (
        <div role="menu" className="card absolute right-0 top-11 z-[9100] w-[200px] p-1.5" style={{ boxShadow: "var(--shadow-lg)" }}>
          <Btn variant="ghost" className="w-full justify-start" onClick={() => { setOpen(false); setLocked(true); }}><Lock size={14} />{t("user.lock")}</Btn>
          <Btn variant="ghost" className="w-full justify-start" onClick={() => { void repos.auth.logout().then(() => { setSession(null); router.replace("/login"); }); }}><LogOut size={14} />{t("user.logout")}</Btn>
        </div>
      ) : null}
    </div>
  );
}

function TopBar({ mobile }: { mobile: boolean }) {
  const { t, lang } = useT();
  const { data: school } = useSchoolQ();
  const season = useSeason();
  const { resolvedTheme, setTheme } = useTheme();
  const setLang = useUI((s) => s.setLang);
  const setSpot = useUI((s) => s.setSpotlight);
  const role = useUI((s) => s.session?.role);
  return (
    <header className="glass relative z-[9050] flex h-12 shrink-0 items-center gap-2 border-x-0 border-t-0 px-3">
      {school ? <Monogram text={school.monogram} color={school.primary} size={28} /> : role === "petra" ? <Monogram text="PE" color="#1f1b16" size={28} /> : <Skeleton w={28} h={28} />}
      <div className="min-w-0 flex-1 md:flex-none">
        <div className="serif-bn truncate text-[14px] font-bold leading-tight">{role === "petra" ? "Petra Console" : school ? (lang === "bn" ? school.nameBn : school.name) : "…"}</div>
      </div>
      {role !== "petra" ? <span className="chip hidden sm:inline-flex" style={{ color: SEASON_ACCENT[season], borderColor: SEASON_ACCENT[season] }}>{t(`season.${season}`)}</span> : null}
      <div className="flex-1" />
      <Btn size="sm" className="hidden md:inline-flex" onClick={() => setSpot(true)}><Search size={14} />{t("spot.trigger")}<kbd className="faint ml-2 text-[11px]">Ctrl K</kbd></Btn>
      {mobile ? <Btn variant="icon" onClick={() => setSpot(true)} aria-label={t("spot.trigger")}><Search size={16} /></Btn> : null}
      <NotificationCenter />
      <Btn variant="icon" onClick={() => setLang(lang === "en" ? "bn" : "en")} aria-label={t("toggle.lang")}><Languages size={16} /></Btn>
      <Btn variant="icon" onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")} aria-label={t("toggle.theme")}>{resolvedTheme === "dark" ? <Sun size={16} /> : <Moon size={16} />}</Btn>
      <UserMenu />
    </header>
  );
}

function Dock() {
  const { t } = useT();
  const role = useUI((s) => s.session?.role);
  const windows = useUI((s) => s.windows);
  const { toggleMin, focusApp } = useUI();
  const topZ = Math.max(0, ...Object.values(windows).filter((w) => w.open && !w.min).map((w) => w.z));
  if (!role) return null;
  return (
    <nav className="dock absolute bottom-3 left-1/2 z-[9040] flex -translate-x-1/2 items-end gap-2 rounded-[26px] px-3.5 py-2.5" aria-label={t("dock.label")}>
      {appsFor(role).map((a) => {
        const w = windows[a.id];
        const running = !!w?.open;
        return (
          <Tip key={a.id} label={t(`app.${a.id}`)}>
            <button type="button" className="dock-item relative grid size-11 place-items-center rounded-[14px] text-white" style={{ background: a.color, boxShadow: "0 4px 10px rgba(0,0,0,.18)" }} aria-label={t(`app.${a.id}`)}
              onClick={() => { if (!running) launch(a.id); else if (w && !w.min && w.z === topZ) toggleMin(a.id); else { if (w?.min) toggleMin(a.id); focusApp(a.id); } }}>
              <a.icon size={21} />
              {running ? <span className="absolute -bottom-1.5 size-1 rounded-full" style={{ background: "var(--ink)" }} /> : null}
            </button>
          </Tip>
        );
      })}
    </nav>
  );
}

function MobileHome() {
  const { t } = useT();
  const role = useUI((s) => s.session?.role);
  if (!role) return null;
  return (
    <div className="scroll-thin h-full overflow-auto pb-8">
      <Widgets />
      <div className="grid grid-cols-4 gap-4 px-5 pb-6">
        {appsFor(role).map((a) => (
          <button key={a.id} type="button" className="flex flex-col items-center gap-1.5" onClick={() => launch(a.id)}>
            <span className="grid size-14 place-items-center rounded-2xl text-white" style={{ background: a.color, boxShadow: "var(--shadow)" }}><a.icon size={26} /></span>
            <span className="text-center text-[11px] font-semibold leading-tight">{t(`app.${a.id}`)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function Shell() {
  const router = useRouter();
  const hydrated = useHydrated();
  const desktop = useMedia("(min-width: 1024px)");
  const { t } = useT();
  const { session, locked, windows, mobileApp, lastActive, setSession, setLocked, setSpotlight, touch, setMobileApp } = useUI();
  const [booted, setBooted] = useState(false);
  const lastTouch = useRef(0);
  const { data: school } = useSchoolQ();

  useEffect(() => {
    const s = repos.auth.session();
    if (!s) { router.replace("/login"); return; }
    setSession(s);
    setBooted(true);
  }, [router, setSession]);

  useEffect(() => { if (school) document.documentElement.style.setProperty("--school-primary", school.primary); }, [school]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setSpotlight(!useUI.getState().spotlight); }
    };
    const onAct = () => { const n = Date.now(); if (n - lastTouch.current > 5000) { lastTouch.current = n; touch(); } };
    const onPop = () => setMobileApp(null);
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onAct);
    window.addEventListener("keydown", onAct);
    window.addEventListener("popstate", onPop);
    const idle = setInterval(() => { if (Date.now() - useUI.getState().lastActive > IDLE_MS) setLocked(true); }, 30_000);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("pointerdown", onAct); window.removeEventListener("keydown", onAct); window.removeEventListener("popstate", onPop); clearInterval(idle); };
  }, [setSpotlight, touch, setLocked, setMobileApp]);

  void lastActive;
  if (!hydrated || !booted || !session) return <div className="grid h-dvh place-items-center"><Skeleton w={220} h={12} /></div>;

  return (
    <div className="wallpaper flex h-dvh flex-col overflow-hidden">
      <TopBar mobile={!desktop} />
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {desktop ? (
          <>
            <div className="scroll-thin absolute inset-0 overflow-auto pb-28"><Widgets /></div>
            {Object.entries(windows).map(([id, win]) => {
              const app = appById(id);
              if (!app || !appsFor(session.role).some((a) => a.id === id)) return null;
              const C = app.Component;
              return <WindowFrame key={id} app={app} win={win}><C /></WindowFrame>;
            })}
            <Dock />
          </>
        ) : mobileApp && appById(mobileApp) ? (
          (() => {
            const app = appById(mobileApp);
            if (!app) return null;
            const C = app.Component;
            return (
              <div className="absolute inset-0 flex flex-col" style={{ background: "var(--win)", backdropFilter: "blur(30px)", ["--accent" as string]: app.color }}>
                <div className="flex h-11 shrink-0 items-center gap-2 border-b px-2" style={{ borderColor: "var(--line)" }}>
                  <Btn variant="icon" aria-label={t("win.back")} onClick={() => window.history.back()}><ArrowLeft size={18} /></Btn>
                  <span className="font-bold">{t(`app.${app.id}`)}</span>
                </div>
                <div className="scroll-thin min-h-0 flex-1 overflow-auto"><C /></div>
              </div>
            );
          })()
        ) : <MobileHome />}
      </div>
      <Spotlight />
      {locked ? <LockScreen /> : null}
    </div>
  );
}

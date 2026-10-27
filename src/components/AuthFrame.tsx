"use client";
import { Languages, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState, type ReactNode } from "react";
import { repos } from "@/api/factory";
import type { SchoolBrand } from "@/api/repositories";
import { Monogram, Btn } from "@/components/ui";
import { useT } from "@/lib/i18n";
import { seasonFromCalendar } from "@/lib/season";
import { useUI } from "@/store/ui";

export function useBrand(): SchoolBrand | null {
  const [b, setB] = useState<SchoolBrand | null>(null);
  useEffect(() => {
    void repos.auth.brand().then((x) => {
      setB(x);
      document.documentElement.style.setProperty("--school-primary", x.primary);
    });
  }, []);
  return b;
}

export function AuthFrame({ children, brand, title }: { children: ReactNode; brand: SchoolBrand | null; title?: string }) {
  const { t, lang } = useT();
  const { resolvedTheme, setTheme } = useTheme();
  const setLang = useUI((s) => s.setLang);
  const season = seasonFromCalendar();
  return (
    <main className="wallpaper relative grid min-h-dvh place-items-center px-4 py-10">
      <div className="no-print absolute right-4 top-4 flex gap-2">
        <Btn size="sm" onClick={() => setLang(lang === "en" ? "bn" : "en")} aria-label={t("toggle.lang")}><Languages size={14} />{lang === "en" ? "বাংলা" : "English"}</Btn>
        <Btn size="sm" variant="icon" onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")} aria-label={t("toggle.theme")}>{resolvedTheme === "dark" ? <Sun size={15} /> : <Moon size={15} />}</Btn>
      </div>
      <div className="w-full max-w-[420px]">
        <div className="mb-5 flex flex-col items-center text-center">
          {brand ? <Monogram text={brand.monogram} color={brand.primary} size={64} /> : <div className="skeleton size-16" />}
          <h1 className="serif-bn mt-3 text-[22px] font-bold leading-tight">{brand ? (lang === "bn" ? brand.nameBn : brand.name) : "ShikkaOS"}</h1>
          {brand?.id !== "petra" ? <p className="muted mt-1 text-[13px]">{t(`season.${season}.greet`)}</p> : null}
        </div>
        <div className="sheet p-6">
          {title ? <h2 className="mb-4 text-base font-bold">{title}</h2> : null}
          {children}
        </div>
        <p className="faint mt-4 text-center text-xs">{t("auth.private")}</p>
      </div>
    </main>
  );
}

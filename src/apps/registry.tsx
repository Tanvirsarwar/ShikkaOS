"use client";
import dynamic from "next/dynamic";
import {
  Award, BadgeCheck, CalendarDays, BarChart3, BookOpen, Bug, Building2, ClipboardCheck, Contact, HeartPulse, LibraryBig, ListChecks,
  Megaphone, PencilLine, Presentation, School, ScrollText, Settings, SquarePlus, UserRound, Users, type LucideIcon,
} from "lucide-react";
import type { ComponentType } from "react";
import type { Role } from "@/api/contracts";
import { SkeletonRows } from "@/components/ui";

export type AppDef = { id: string; icon: LucideIcon; color: string; roles: Role[]; Component: ComponentType; size?: [number, number] };

const load = (fn: () => Promise<{ default: ComponentType }>) => dynamic(fn, { ssr: false, loading: () => <SkeletonRows /> });

export const APPS: AppDef[] = [
  { id: "results", icon: ClipboardCheck, color: "#c27a1a", roles: ["registrar"], Component: load(() => import("./results/ResultsCenter")), size: [1120, 660] },
  { id: "students", icon: Users, color: "#4f46e5", roles: ["registrar"], Component: load(() => import("./students/Students")), size: [1040, 640] },
  { id: "teachers", icon: Presentation, color: "#0f8a8a", roles: ["registrar"], Component: load(() => import("./teachers/Teachers")) },
  { id: "classes", icon: LibraryBig, color: "#ea580c", roles: ["registrar"], Component: load(() => import("./classes/ClassesExams")) },
  { id: "approvals", icon: BadgeCheck, color: "#059669", roles: ["registrar"], Component: load(() => import("./approvals/Approvals")), size: [820, 560] },
  { id: "routine", icon: CalendarDays, color: "#e0556b", roles: ["registrar", "teacher", "student"], Component: load(() => import("./routine/Routine")), size: [1020, 640] },
  { id: "magazine", icon: BookOpen, color: "#d64571", roles: ["registrar", "teacher", "student"], Component: load(() => import("./magazine/Magazine")) },
  { id: "notices", icon: Megaphone, color: "#0284c7", roles: ["registrar", "teacher", "student"], Component: load(() => import("./notices/Notices")), size: [860, 580] },
  { id: "audit", icon: ScrollText, color: "#7c3aed", roles: ["registrar"], Component: load(() => import("./audit/AuditLog")) },
  { id: "settings", icon: Settings, color: "#64748b", roles: ["registrar"], Component: load(() => import("./settings/SettingsApp")), size: [820, 600] },

  { id: "myclasses", icon: School, color: "#2f7a5b", roles: ["teacher"], Component: load(() => import("./myclasses/MyClasses")), size: [860, 560] },
  { id: "marks", icon: PencilLine, color: "#c27a1a", roles: ["teacher"], Component: load(() => import("./marks/MarksEntry")), size: [1060, 660] },
  { id: "roster", icon: ListChecks, color: "#4f46e5", roles: ["teacher"], Component: load(() => import("./roster/Roster")), size: [860, 580] },
  { id: "faculty", icon: Contact, color: "#0f8a8a", roles: ["teacher", "student"], Component: load(() => import("./faculty/Faculty")), size: [900, 580] },
  { id: "profile", icon: UserRound, color: "#64748b", roles: ["teacher", "student"], Component: load(() => import("./profile/Profile")), size: [620, 520] },

  { id: "myresults", icon: Award, color: "#c27a1a", roles: ["student"], Component: load(() => import("./myresults/MyResults")), size: [980, 640] },

  { id: "schools", icon: Building2, color: "#2b5fa8", roles: ["petra"], Component: load(() => import("./petra/Schools")), size: [980, 620] },
  { id: "health", icon: HeartPulse, color: "#059669", roles: ["petra"], Component: load(() => import("./petra/Health")), size: [920, 600] },
  { id: "errors", icon: Bug, color: "#b42318", roles: ["petra"], Component: load(() => import("./petra/Errors")), size: [900, 560] },
  { id: "usage", icon: BarChart3, color: "#7c3aed", roles: ["petra"], Component: load(() => import("./petra/Usage")), size: [920, 600] },
  { id: "createschool", icon: SquarePlus, color: "#ea580c", roles: ["petra"], Component: load(() => import("./petra/CreateSchool")), size: [640, 600] },
];

export const appsFor = (role: Role): AppDef[] => APPS.filter((a) => a.roles.includes(role));
export const appById = (id: string): AppDef | undefined => APPS.find((a) => a.id === id);

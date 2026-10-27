"use client";
import { useMeStudentQ, useMeTeacherQ } from "@/api/hooks";
import { Avatar, ErrorBox, SkeletonRows } from "@/components/ui";
import { fmtDate } from "@/lib/dates";
import { useT } from "@/lib/i18n";
import { useUI } from "@/store/ui";

function Row({ l, v }: { l: string; v: string }) {
  return <div className="flex justify-between gap-4 border-b py-2 text-[13px]" style={{ borderColor: "var(--line)" }}><span className="muted">{l}</span><span className="text-right font-semibold">{v}</span></div>;
}

export default function Profile() {
  const { t, lang } = useT();
  const role = useUI((s) => s.session?.role);
  const st = useMeStudentQ(role === "student");
  const te = useMeTeacherQ(role === "teacher");
  const q = role === "student" ? st : te;
  if (q.isLoading) return <SkeletonRows rows={5} />;
  if (q.isError) return <ErrorBox error={q.error} />;
  return (
    <div className="mx-auto max-w-[520px] p-5">
      {role === "student" && st.data ? (
        <>
          <div className="mb-4 flex items-center gap-3"><Avatar name={st.data.name} size={60} /><div><div className="serif-bn text-xl font-bold">{lang === "bn" ? st.data.nameBn : st.data.name}</div><div className="muted text-[13px]">{t("role.student")}</div></div></div>
          <Row l={t("col.studentid")} v={st.data.studentId} /><Row l={t("col.class")} v={`${st.data.classNo}-${st.data.section}`} /><Row l={t("col.roll")} v={String(st.data.roll)} /><Row l={t("col.guardian")} v={st.data.guardian} /><Row l={t("students.admission")} v={fmtDate(st.data.admission, lang)} />
        </>
      ) : te.data ? (
        <>
          <div className="mb-4 flex items-center gap-3"><Avatar name={te.data.name} size={60} /><div><div className="serif-bn text-xl font-bold">{lang === "bn" ? te.data.nameBn : te.data.name}</div><div className="muted text-[13px]">{te.data.designation}</div></div></div>
          <Row l={t("teachers.phone")} v={te.data.phone} /><Row l={t("teachers.email")} v={te.data.email} /><Row l={t("teachers.assign")} v={String(te.data.assignments.length)} />
        </>
      ) : null}
      <p className="muted mt-4 text-[12px]">{t("profile.note")}</p>
    </div>
  );
}

import type { Cell, Invite, Notice, School, Session, Student, Teacher, User } from "../contracts";
import type {
  ApprovalRepo, AuditRepo, AuthRepo, ClassRepo, CellKey, ExamRepo, MagazineRepo, MarksRepo, NoticeRepo, PlatformRepo,
  Repos, ResultRepo, RoutineRepo, SchoolBrand, SchoolRepo, StudentRepo, TeacherRepo,
} from "../repositories";
import { ApiError, audit, getDb, latency, maybeFail, need, notify, persist, readSession, resetDb, writeSession } from "./db";
import { applyScheduled, classCells, computeClass } from "./compute";
import { DEFAULT_GRADING } from "@/lib/grading";
import { MAIN_SCHOOL_ID, PETRA_SCHOOL_ID } from "@/data/seed";
import { SUBJECT_MASTER, subjectsForClass } from "@/data/names";

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const code = (n: number) => Math.random().toString(36).slice(2, 2 + n).toUpperCase();
const brandOf = (s: School): SchoolBrand => ({ id: s.id, name: s.name, nameBn: s.nameBn, city: s.city, monogram: s.monogram, primary: s.primary });
const mySchool = (s: Session): School => {
  const sc = getDb().schools.find((x) => x.id === s.schoolId);
  if (!sc) throw new ApiError("School not found.", "not_found");
  return sc;
};
const toSession = (u: User): Session => ({ userId: u.id, schoolId: u.schoolId, role: u.role, name: u.name, refId: u.refId });

function findCell(k: CellKey, schoolId: string): Cell {
  const c = getDb().cells.find((x) => x.schoolId === schoolId && x.examId === k.examId && x.classNo === k.classNo && x.section === k.section && x.subject === k.subject);
  if (!c) throw new ApiError("This subject is not set up for that class.", "not_found");
  return c;
}
const label = (k: CellKey) => `Class ${k.classNo}-${k.section} ${k.subject}`;

const auth: AuthRepo = {
  async login(id, password) {
    await latency();
    const db = getDb();
    const u = db.users.find((x) => x.loginId.toLowerCase() === id.trim().toLowerCase());
    if (!u || u.password !== password) throw new ApiError("ID or password is not correct.", "invalid_credentials");
    if (u.status === "pending") throw new ApiError("Your sign-up is waiting for registrar approval.", "pending");
    if (u.status === "disabled") throw new ApiError("This account is disabled. Contact your registrar.", "disabled");
    const s = toSession(u);
    writeSession(s);
    audit(s, "auth.login", "Session", "Signed in");
    persist();
    return s;
  },
  async logout() {
    writeSession(null);
  },
  session() {
    return readSession();
  },
  async verifyPassword(password) {
    await latency();
    const s = need();
    const u = getDb().users.find((x) => x.id === s.userId);
    return !!u && u.password === password;
  },
  async brand() {
    const db = getDb();
    const s = readSession();
    const school = db.schools.find((x) => x.id === (s && s.schoolId !== PETRA_SCHOOL_ID ? s.schoolId : MAIN_SCHOOL_ID)) ?? (db.schools[0] as School);
    return brandOf(school);
  },
  async previewInvite(codeIn) {
    await latency();
    const db = getDb();
    const inv = db.invites.find((i) => i.code === codeIn.trim().toUpperCase() && i.status === "pending");
    if (!inv) throw new ApiError("This invite code is not valid or was already used.", "invalid_invite");
    const t = db.teachers.find((x) => x.id === inv.teacherId);
    const sc = db.schools.find((x) => x.id === inv.schoolId);
    if (!t || !sc) throw new ApiError("Invite is incomplete.", "invalid_invite");
    return { teacher: clone(t), school: brandOf(sc) };
  },
  async signupTeacher(codeIn, password) {
    await latency();
    if (password.length < 6) throw new ApiError("Password must be at least 6 characters.", "weak_password");
    const db = getDb();
    const inv = db.invites.find((i) => i.code === codeIn.trim().toUpperCase() && i.status === "pending");
    const t = inv ? db.teachers.find((x) => x.id === inv.teacherId) : undefined;
    if (!inv || !t) throw new ApiError("This invite code is not valid or was already used.", "invalid_invite");
    inv.status = "used";
    t.status = "active";
    db.users.push({ id: `usr_${t.id}`, schoolId: t.schoolId, role: "teacher", loginId: t.phone, password, name: t.name, refId: t.id, status: "active", mustReset: false });
    audit({ userId: `usr_${t.id}`, schoolId: t.schoolId, role: "teacher", name: t.name, refId: t.id }, "teacher.signup", "Teacher", "Completed invite sign-up");
    persist();
  },
  async signupStudent(input) {
    await latency();
    const db = getDb();
    const school = db.schools.find((s) => s.joinCode.toLowerCase() === input.joinCode.trim().toLowerCase());
    if (!school) throw new ApiError("The school join code is not correct. Ask your school office.", "bad_join_code");
    const st = db.students.find((s) => s.schoolId === school.id && s.studentId.toLowerCase() === input.studentId.trim().toLowerCase());
    if (!st) throw new ApiError("This Student ID is not in the school roster. Check the ID or contact your registrar.", "not_in_roster");
    if (st.guardianPhone.slice(-4) !== input.guardianLast4.trim()) throw new ApiError("The guardian phone digits do not match the roster.", "guardian_mismatch");
    if (st.status !== "unclaimed") throw new ApiError("This Student ID already has an account. Use Login or ask your registrar for a reset.", "already_claimed");
    if (input.password.length < 6) throw new ApiError("Password must be at least 6 characters.", "weak_password");
    const status = school.autoApprove ? "active" : "pending";
    st.status = status;
    db.users.push({ id: `usr_${st.id}`, schoolId: school.id, role: "student", loginId: st.studentId, password: input.password, name: st.name, refId: st.id, status, mustReset: false });
    notify(school.id, "registrar", `${st.name} requested to join.`);
    persist();
    return { status };
  },
};

const school: SchoolRepo = {
  async current() {
    await latency();
    const s = need();
    applyScheduled(getDb());
    return clone(mySchool(s));
  },
  async update(patch) {
    await latency();
    const s = need("registrar");
    const sc = mySchool(s);
    Object.assign(sc, patch);
    audit(s, "settings.update", "School", "Updated school profile");
    persist();
    return clone(sc);
  },
  async setSeason(season) {
    await latency();
    const s = need("registrar", "petra");
    const sc = s.role === "petra" ? getDb().schools[0] : mySchool(s);
    if (sc) sc.seasonOverride = season;
    persist();
    return clone(sc as School);
  },
  async regenerateJoinCode() {
    await latency();
    const s = need("registrar");
    const sc = mySchool(s);
    sc.joinCode = `${sc.monogram}MS-${Math.floor(1000 + Math.random() * 9000)}`;
    audit(s, "settings.joincode", "School", "Regenerated join code");
    persist();
    return sc.joinCode;
  },
  async resetDemo() {
    await latency();
    resetDb();
  },
};

const student: StudentRepo = {
  async list() {
    await latency();
    const s = need("registrar", "teacher");
    return clone(getDb().students.filter((x) => x.schoolId === s.schoolId));
  },
  async me() {
    await latency();
    const s = need("student");
    const st = getDb().students.find((x) => x.id === s.refId);
    if (!st) throw new ApiError("Student record not found.", "not_found");
    return clone(st);
  },
  async importRoster(rows) {
    await latency();
    const s = need("registrar");
    const db = getDb();
    let added = 0, updated = 0;
    for (const r of rows) {
      const ex = db.students.find((x) => x.schoolId === s.schoolId && x.studentId === r.studentId);
      if (ex) {
        Object.assign(ex, { roll: r.roll, name: r.name, classNo: r.classNo, section: r.section, guardian: r.guardian, guardianPhone: r.guardianPhone });
        updated++;
      } else {
        const n: Student = { id: `${s.schoolId}_s${Date.now().toString(36)}${added}`, schoolId: s.schoolId, studentId: r.studentId, roll: r.roll, name: r.name, nameBn: r.name, classNo: r.classNo, section: r.section, guardian: r.guardian, guardianPhone: r.guardianPhone, admission: new Date().toISOString(), status: "unclaimed" };
        db.students.push(n);
        added++;
      }
    }
    audit(s, "student.import", "Student", `Roster import: ${added} added, ${updated} updated`);
    persist();
    return { added, updated };
  },
  async resetPassword(id) {
    await latency();
    const s = need("registrar");
    const db = getDb();
    const u = db.users.find((x) => x.schoolId === s.schoolId && x.refId === id);
    if (!u) throw new ApiError("This student has not created an account yet.", "no_account");
    const pw = `reset-${code(5)}`;
    u.password = pw;
    audit(s, "student.reset", "Student", `Issued password reset for ${u.name}`);
    persist();
    return pw;
  },
};

const teacher: TeacherRepo = {
  async list() {
    await latency();
    const s = need();
    return clone(getDb().teachers.filter((x) => x.schoolId === s.schoolId));
  },
  async me() {
    await latency();
    const s = need("teacher");
    const t = getDb().teachers.find((x) => x.id === s.refId);
    if (!t) throw new ApiError("Teacher record not found.", "not_found");
    return clone(t);
  },
  async invites() {
    await latency();
    const s = need("registrar");
    return clone(getDb().invites.filter((x) => x.schoolId === s.schoolId));
  },
  async createInvite(input) {
    await latency();
    maybeFail(0.03);
    const s = need("registrar");
    const db = getDb();
    if (db.teachers.some((t) => t.schoolId === s.schoolId && t.phone === input.phone)) throw new ApiError("A teacher with this phone number already exists.", "duplicate");
    const t: Teacher = { id: `${s.schoolId}_t${Date.now().toString(36)}`, schoolId: s.schoolId, name: input.name, nameBn: input.name, phone: input.phone, email: input.email, designation: input.designation, assignments: [], status: "invited" };
    const inv: Invite = { code: `INV-${code(6)}`, schoolId: s.schoolId, teacherId: t.id, status: "pending", createdAt: new Date().toISOString() };
    db.teachers.push(t);
    db.invites.push(inv);
    audit(s, "teacher.invite", "Teacher", `Generated invite for ${t.name}`);
    persist();
    return clone(inv);
  },
  async importTeachers(rows) {
    await latency();
    const s = need("registrar");
    const db = getDb();
    let added = 0;
    for (const r of rows) {
      if (db.teachers.some((t) => t.schoolId === s.schoolId && t.phone === r.phone)) continue;
      const t: Teacher = { id: `${s.schoolId}_t${Date.now().toString(36)}${added}`, schoolId: s.schoolId, name: r.name, nameBn: r.name, phone: r.phone, email: r.email, designation: r.designation, assignments: [], status: "invited" };
      db.teachers.push(t);
      db.invites.push({ code: `INV-${code(6)}`, schoolId: s.schoolId, teacherId: t.id, status: "pending", createdAt: new Date().toISOString() });
      added++;
    }
    audit(s, "teacher.import", "Teacher", `Teacher import: ${added} added`);
    persist();
    return { added };
  },
  async setAssignments(id, assignments) {
    await latency();
    const s = need("registrar");
    const t = getDb().teachers.find((x) => x.id === id && x.schoolId === s.schoolId);
    if (!t) throw new ApiError("Teacher not found.", "not_found");
    t.assignments = assignments;
    audit(s, "teacher.assign", "Teacher", `Updated assignments for ${t.name}`);
    persist();
    return clone(t);
  },
  async resetPassword(id) {
    await latency();
    const s = need("registrar");
    const u = getDb().users.find((x) => x.schoolId === s.schoolId && x.refId === id);
    if (!u) throw new ApiError("This teacher has not signed up yet.", "no_account");
    const pw = `reset-${code(5)}`;
    u.password = pw;
    audit(s, "teacher.reset", "Teacher", `Issued password reset for ${u.name}`);
    persist();
    return pw;
  },
};

const klass: ClassRepo = {
  async subjects() {
    await latency();
    const s = need();
    return clone(getDb().subjects.filter((x) => x.schoolId === s.schoolId));
  },
  async updateSubject(classNo, subject, patch) {
    await latency();
    const s = need("registrar");
    const d = getDb().subjects.find((x) => x.schoolId === s.schoolId && x.classNo === classNo && x.subject === subject);
    if (!d) throw new ApiError("Subject not found.", "not_found");
    if (patch.pass > patch.full) throw new ApiError("Pass marks cannot be above full marks.", "invalid");
    Object.assign(d, patch);
    audit(s, "subject.update", "Subject", `Class ${classNo} ${subject}: full ${patch.full}, pass ${patch.pass}`);
    persist();
  },
  async exams() {
    await latency();
    const s = need();
    return clone(getDb().exams.filter((x) => x.schoolId === s.schoolId));
  },
  async createExam(name, nameBn) {
    await latency();
    const s = need("registrar");
    const db = getDb();
    const ex = { id: `${s.schoolId}_x${Date.now().toString(36)}`, schoolId: s.schoolId, name, nameBn: nameBn || name, kind: "test" as const, year: 2026 };
    db.exams.push(ex);
    for (const d of db.subjects.filter((x) => x.schoolId === s.schoolId)) {
      for (const sec of d.classNo >= 6 ? ["A", "B"] : ["A"]) {
        const t = db.teachers.find((x) => x.schoolId === s.schoolId && x.assignments.some((a) => a.classNo === d.classNo && a.section === sec && a.subject === d.subject));
        db.cells.push({ schoolId: s.schoolId, examId: ex.id, classNo: d.classNo, section: sec, subject: d.subject, state: "not_started", marks: {}, submittedBy: t ? t.id : null, source: "none", updatedAt: null, returnComment: null, locked: false });
      }
    }
    audit(s, "exam.create", "Exam", `Created exam ${name}`);
    persist();
    return clone(ex);
  },
  async grading() {
    await latency();
    const s = need();
    return clone(getDb().grading[s.schoolId] ?? DEFAULT_GRADING);
  },
  async setGrading(g) {
    await latency();
    const s = need("registrar");
    getDb().grading[s.schoolId] = g;
    audit(s, "grading.update", "Grading", "Updated grading scale");
    persist();
  },
};

const exam: ExamRepo = {
  async matrix(examId) {
    await latency();
    const s = need("registrar");
    const db = getDb();
    applyScheduled(db);
    persist();
    return { cells: clone(db.cells.filter((c) => c.schoolId === s.schoolId && c.examId === examId)), publications: clone(db.publications.filter((p) => p.schoolId === s.schoolId && p.examId === examId)) };
  },
};

const marks: MarksRepo = {
  async cell(k) {
    await latency();
    const s = need("registrar", "teacher");
    return clone(findCell(k, s.schoolId));
  },
  async myCells(examId) {
    await latency();
    const s = need("teacher");
    const t = getDb().teachers.find((x) => x.id === s.refId);
    if (!t) return [];
    const db = getDb();
    return clone(t.assignments.map((a) => db.cells.find((c) => c.schoolId === s.schoolId && c.examId === examId && c.classNo === a.classNo && c.section === a.section && c.subject === a.subject)).filter((c): c is Cell => !!c));
  },
  async saveDraft(k, m) {
    await latency();
    const s = need("teacher", "registrar");
    const c = findCell(k, s.schoolId);
    if (c.locked) throw new ApiError("This sheet is locked. Ask the registrar to return it.", "locked");
    c.marks = m;
    c.state = "draft";
    c.updatedAt = new Date().toISOString();
    audit(s, "marks.draft", "Marks", `Saved draft ${label(k)}`);
    persist();
    return clone(c);
  },
  async submit(k, m) {
    await latency();
    maybeFail(0.02);
    const s = need("teacher", "registrar");
    const c = findCell(k, s.schoolId);
    if (c.locked) throw new ApiError("This sheet is locked. Ask the registrar to return it.", "locked");
    const defs = getDb().subjects.find((d) => d.schoolId === s.schoolId && d.classNo === k.classNo && d.subject === k.subject);
    for (const v of Object.values(m)) if (typeof v === "number" && defs && v > defs.full) throw new ApiError(`Marks cannot be above ${defs.full}.`, "invalid");
    c.marks = m;
    c.state = "submitted";
    c.source = "teacher";
    c.submittedBy = s.refId;
    c.locked = true;
    c.returnComment = null;
    c.updatedAt = new Date().toISOString();
    audit(s, "marks.submit", "Marks", `Submitted ${label(k)}`);
    notify(s.schoolId, "registrar", `${s.name} submitted ${label(k)}.`);
    persist();
    return clone(c);
  },
  async verify(k) {
    await latency();
    const s = need("registrar");
    const c = findCell(k, s.schoolId);
    if (c.state !== "submitted" && c.state !== "uploaded") throw new ApiError("Only submitted or uploaded marks can be verified.", "invalid_state");
    c.state = "verified";
    c.locked = true;
    c.updatedAt = new Date().toISOString();
    audit(s, "exam.verify", "Marks", `Verified ${label(k)}`);
    persist();
    return clone(c);
  },
  async returnCell(k, comment) {
    await latency();
    const s = need("registrar");
    const c = findCell(k, s.schoolId);
    if (c.state === "published") throw new ApiError("Unpublish the class before returning marks.", "invalid_state");
    c.state = "draft";
    c.locked = false;
    c.returnComment = comment;
    c.updatedAt = new Date().toISOString();
    audit(s, "marks.return", "Marks", `Returned ${label(k)}: ${comment}`);
    notify(s.schoolId, "teacher", `${label(k)} was returned: ${comment}`);
    persist();
    return clone(c);
  },
  async importMarks(k, values) {
    await latency();
    const s = need("registrar");
    const c = findCell(k, s.schoolId);
    if (c.state === "published") throw new ApiError("Published marks cannot be replaced. Unpublish first.", "locked");
    c.marks = { ...values };
    c.state = "uploaded";
    c.source = "excel";
    c.locked = true;
    c.updatedAt = new Date().toISOString();
    audit(s, "marks.upload", "Marks", `Uploaded Excel for ${label(k)} (${Object.keys(values).length} rows)`);
    persist();
    return clone(c);
  },
};

function rowCells(db: ReturnType<typeof getDb>, schoolId: string, examId: string, c: number, sec: string) {
  return classCells(db, schoolId, examId, c, sec);
}

const result: ResultRepo = {
  async summary(examId, classNo, section) {
    await latency();
    const s = need("registrar");
    const res = [...computeClass(getDb(), s.schoolId, examId, classNo, section).values()];
    const pass = res.filter((r) => r.passed);
    return {
      students: res.length,
      passRate: res.length ? (pass.length / res.length) * 100 : 0,
      avgGpa: pass.length ? pass.reduce((a, r) => a + r.gpa, 0) / pass.length : 0,
      failCount: res.length - pass.length,
    };
  },
  async publish(examId, classNo, section) {
    await latency();
    maybeFail(0.02);
    const s = need("registrar");
    const db = getDb();
    const cells = rowCells(db, s.schoolId, examId, classNo, section);
    if (!cells.length || cells.some((c) => c.state !== "verified")) throw new ApiError("Every subject must be Verified before publishing.", "not_ready");
    cells.forEach((c) => { c.state = "published"; c.locked = true; });
    db.publications = db.publications.filter((p) => !(p.schoolId === s.schoolId && p.examId === examId && p.classNo === classNo && p.section === section));
    db.publications.push({ schoolId: s.schoolId, examId, classNo, section, state: "published", at: new Date().toISOString() });
    audit(s, "result.publish", "Result", `Published Class ${classNo}-${section}`);
    notify(s.schoolId, "student", `Results for Class ${classNo}-${section} are now published.`);
    persist();
  },
  async schedule(examId, classNo, section, atIso) {
    await latency();
    const s = need("registrar");
    const db = getDb();
    const cells = rowCells(db, s.schoolId, examId, classNo, section);
    if (!cells.length || cells.some((c) => c.state !== "verified")) throw new ApiError("Every subject must be Verified before scheduling.", "not_ready");
    if (new Date(atIso).getTime() <= Date.now()) throw new ApiError("Choose a time in the future.", "invalid");
    db.publications = db.publications.filter((p) => !(p.schoolId === s.schoolId && p.examId === examId && p.classNo === classNo && p.section === section));
    db.publications.push({ schoolId: s.schoolId, examId, classNo, section, state: "scheduled", at: atIso });
    audit(s, "result.schedule", "Result", `Scheduled Class ${classNo}-${section} for ${atIso}`);
    persist();
  },
  async unpublish(examId, classNo, section, reason) {
    await latency();
    const s = need("registrar");
    if (reason.trim().length < 3) throw new ApiError("A reason is required.", "invalid");
    const db = getDb();
    rowCells(db, s.schoolId, examId, classNo, section).forEach((c) => { if (c.state === "published") { c.state = "verified"; } });
    db.publications = db.publications.filter((p) => !(p.schoolId === s.schoolId && p.examId === examId && p.classNo === classNo && p.section === section));
    audit(s, "result.unpublish", "Result", `Unpublished Class ${classNo}-${section}: ${reason}`);
    persist();
  },
  async publishAllReady(examId) {
    await latency();
    const s = need("registrar");
    const db = getDb();
    let n = 0;
    const keys = new Set(db.cells.filter((c) => c.schoolId === s.schoolId && c.examId === examId).map((c) => `${c.classNo}-${c.section}`));
    for (const key of keys) {
      const [cn, sec] = key.split("-") as [string, string];
      const cells = rowCells(db, s.schoolId, examId, Number(cn), sec);
      if (cells.length && cells.every((c) => c.state === "verified")) {
        cells.forEach((c) => { c.state = "published"; c.locked = true; });
        db.publications = db.publications.filter((p) => !(p.schoolId === s.schoolId && p.examId === examId && p.classNo === Number(cn) && p.section === sec));
        db.publications.push({ schoolId: s.schoolId, examId, classNo: Number(cn), section: sec, state: "published", at: new Date().toISOString() });
        notify(s.schoolId, "student", `Results for Class ${cn}-${sec} are now published.`);
        n++;
      }
    }
    audit(s, "result.publish_all", "Result", `Published ${n} ready classes`);
    persist();
    return n;
  },
  async myExams() {
    await latency();
    const s = need("student");
    const db = getDb();
    applyScheduled(db);
    const st = db.students.find((x) => x.id === s.refId);
    if (!st) throw new ApiError("Student record not found.", "not_found");
    return db.exams.filter((e) => e.schoolId === s.schoolId).map((e) => {
      const p = db.publications.find((x) => x.schoolId === s.schoolId && x.examId === e.id && x.classNo === st.classNo && x.section === st.section);
      return { exam: clone(e), state: (p ? p.state : "none") as "published" | "scheduled" | "none", at: p ? p.at : null };
    });
  },
  async myResult(examId) {
    await latency();
    const s = need("student");
    const db = getDb();
    applyScheduled(db);
    const st = db.students.find((x) => x.id === s.refId);
    if (!st) throw new ApiError("Student record not found.", "not_found");
    const p = db.publications.find((x) => x.schoolId === s.schoolId && x.examId === examId && x.classNo === st.classNo && x.section === st.section && x.state === "published");
    if (!p) throw new ApiError("This result is not published yet.", "not_published");
    const r = computeClass(db, s.schoolId, examId, st.classNo, st.section).get(st.id);
    if (!r) throw new ApiError("Result not found.", "not_found");
    return clone(r);
  },
  async myHistory() {
    await latency();
    const s = need("student");
    const db = getDb();
    applyScheduled(db);
    const st = db.students.find((x) => x.id === s.refId);
    if (!st) throw new ApiError("Student record not found.", "not_found");
    const out = [];
    for (const e of db.exams.filter((x) => x.schoolId === s.schoolId)) {
      const p = db.publications.find((x) => x.schoolId === s.schoolId && x.examId === e.id && x.classNo === st.classNo && x.section === st.section && x.state === "published");
      if (!p) continue;
      const r = computeClass(db, s.schoolId, e.id, st.classNo, st.section).get(st.id);
      if (r) out.push({ exam: clone(e), result: clone(r) });
    }
    return out;
  },
};

const magazine: MagazineRepo = {
  async issues() {
    await latency();
    const s = need();
    const all = getDb().issues.filter((i) => i.schoolId === s.schoolId);
    return clone(s.role === "registrar" ? all : all.filter((i) => i.status === "published"));
  },
  async articles() {
    await latency();
    const s = need();
    const all = getDb().articles.filter((a) => a.schoolId === s.schoolId);
    return clone(s.role === "registrar" ? all : all.filter((a) => a.status === "published"));
  },
  async submit(input) {
    await latency();
    const s = need("teacher", "student");
    if (input.title.trim().length < 3 || input.body.trim().length < 20) throw new ApiError("Add a title and at least a few sentences.", "invalid");
    const a = { id: `art_${Date.now().toString(36)}`, schoolId: s.schoolId, issueId: null, title: input.title, lang: input.lang, author: s.name, body: input.body, status: "pending" as const };
    getDb().articles.push(a);
    audit(s, "magazine.submit", "Article", `Submitted "${input.title}"`);
    notify(s.schoolId, "registrar", `${s.name} submitted a magazine article.`);
    persist();
    return clone(a);
  },
  async review(id, decision, issueId) {
    await latency();
    const s = need("registrar");
    const a = getDb().articles.find((x) => x.id === id && x.schoolId === s.schoolId);
    if (!a) throw new ApiError("Article not found.", "not_found");
    a.status = decision === "approve" ? "published" : "rejected";
    a.issueId = decision === "approve" ? issueId : null;
    audit(s, `magazine.${decision}`, "Article", `${decision === "approve" ? "Approved" : "Rejected"} "${a.title}"`);
    persist();
  },
  async createIssue(title, titleBn) {
    await latency();
    const s = need("registrar");
    const db = getDb();
    const i = { id: `iss_${Date.now().toString(36)}`, schoolId: s.schoolId, title, titleBn: titleBn || title, hue: Math.floor(Math.random() * 360), status: "draft" as const, publishedAt: null };
    db.issues.push(i);
    audit(s, "magazine.issue", "Issue", `Created issue ${title}`);
    persist();
    return clone(i);
  },
  async publishIssue(id) {
    await latency();
    const s = need("registrar");
    const i = getDb().issues.find((x) => x.id === id && x.schoolId === s.schoolId);
    if (!i) throw new ApiError("Issue not found.", "not_found");
    i.status = "published";
    i.publishedAt = new Date().toISOString();
    audit(s, "magazine.publish", "Issue", `Published issue ${i.title}`);
    notify(s.schoolId, null, `New magazine issue: ${i.title}`);
    persist();
  },
  async saveArticle(id, patch) {
    await latency();
    const s = need("registrar");
    const a = getDb().articles.find((x) => x.id === id && x.schoolId === s.schoolId);
    if (!a) throw new ApiError("Article not found.", "not_found");
    a.title = patch.title;
    a.body = patch.body;
    audit(s, "magazine.edit", "Article", `Edited "${a.title}"`);
    persist();
  },
};

const notice: NoticeRepo = {
  async list() {
    await latency();
    const s = need();
    const db = getDb();
    const me = s.role === "student" ? db.students.find((x) => x.id === s.refId) : undefined;
    const now = Date.now();
    return clone(db.notices
      .filter((n) => n.schoolId === s.schoolId)
      .filter((n) => s.role === "registrar" || new Date(n.publishAt).getTime() <= now)
      .filter((n) => s.role === "registrar" || n.audience === "all" || (n.audience === "teachers" && s.role === "teacher") || (n.audience === "class" && (s.role === "teacher" || (me && me.classNo === n.classNo))))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.publishAt.localeCompare(a.publishAt)));
  },
  async create(input) {
    await latency();
    const s = need("registrar");
    const n: Notice = { id: `ntc_${Date.now().toString(36)}`, schoolId: s.schoolId, title: input.title, body: input.body, audience: input.audience, classNo: input.audience === "class" ? input.classNo : null, pinned: input.pinned, publishAt: input.publishAt, reads: 0, author: s.name };
    getDb().notices.unshift(n);
    audit(s, "notice.create", "Notice", `Posted "${n.title}"`);
    persist();
    return clone(n);
  },
  async togglePin(id) {
    await latency();
    const s = need("registrar");
    const n = getDb().notices.find((x) => x.id === id && x.schoolId === s.schoolId);
    if (!n) throw new ApiError("Notice not found.", "not_found");
    n.pinned = !n.pinned;
    persist();
  },
  async markRead(id) {
    const s = need();
    const n = getDb().notices.find((x) => x.id === id && x.schoolId === s.schoolId);
    if (n && s.role !== "registrar") { n.reads += 1; persist(); }
  },
  async notifications() {
    await latency();
    const s = need();
    const db = getDb();
    applyScheduled(db);
    return clone(db.notifications.filter((n) => n.schoolId === s.schoolId && (n.role === null || n.role === s.role)).slice(0, 30));
  },
  async markAllRead() {
    const s = need();
    getDb().notifications.forEach((n) => { if (n.schoolId === s.schoolId && (n.role === null || n.role === s.role)) n.read = true; });
    persist();
  },
};

const approval: ApprovalRepo = {
  async pendingSignups() {
    await latency();
    const s = need("registrar");
    return clone(getDb().students.filter((x) => x.schoolId === s.schoolId && x.status === "pending"));
  },
  async approve(studentId) {
    await latency();
    const s = need("registrar");
    const db = getDb();
    const st = db.students.find((x) => x.id === studentId && x.schoolId === s.schoolId);
    if (!st) throw new ApiError("Student not found.", "not_found");
    st.status = "active";
    const u = db.users.find((x) => x.refId === st.id);
    if (u) u.status = "active";
    audit(s, "student.approve", "Student", `Approved ${st.name}`);
    persist();
  },
  async reject(studentId, reason) {
    await latency();
    const s = need("registrar");
    if (reason.trim().length < 3) throw new ApiError("A reason is required.", "invalid");
    const db = getDb();
    const st = db.students.find((x) => x.id === studentId && x.schoolId === s.schoolId);
    if (!st) throw new ApiError("Student not found.", "not_found");
    st.status = "unclaimed";
    db.users = db.users.filter((x) => x.refId !== st.id);
    db.rejections.push({ studentId: st.studentId, reason });
    audit(s, "student.reject", "Student", `Rejected ${st.name}: ${reason}`);
    persist();
  },
};

const auditRepo: AuditRepo = {
  async list() {
    await latency();
    const s = need("registrar");
    return clone(getDb().audit.filter((a) => a.schoolId === s.schoolId));
  },
};

const platform: PlatformRepo = {
  async schools() {
    await latency();
    need("petra");
    const db = getDb();
    return db.schools.map((sc) => ({
      school: clone(sc),
      students: db.students.filter((x) => x.schoolId === sc.id).length,
      teachers: db.teachers.filter((x) => x.schoolId === sc.id).length,
      lastActive: new Date(Date.now() - Math.floor(Math.random() * 6) * 3600_000).toISOString(),
    }));
  },
  async metrics() {
    await latency();
    need("petra");
    return clone(getDb().metrics);
  },
  async errors() {
    await latency();
    need("petra");
    return clone(getDb().errors);
  },
  async createSchool(input) {
    await latency();
    const s = need("petra");
    const db = getDb();
    const mono = input.name.split(/\s+/).map((w) => w[0] ?? "").join("").slice(0, 2).toUpperCase() || "SC";
    const sc: School = { id: `sch_${Date.now().toString(36)}`, name: input.name, nameBn: input.name, city: input.city, monogram: mono, primary: input.primary, joinCode: `${mono}-${Math.floor(1000 + Math.random() * 9000)}`, status: "trial", autoApprove: false, seasonOverride: null };
    db.schools.push(sc);
    db.grading[sc.id] = DEFAULT_GRADING;
    for (let c = 1; c <= 10; c++) for (const sub of subjectsForClass(c)) {
      const m = SUBJECT_MASTER.find((x) => x.en === sub);
      db.subjects.push({ schoolId: sc.id, classNo: c, subject: sub, subjectBn: m ? m.bn : sub, full: 100, pass: 33, components: ["Written", "MCQ"] });
    }
    db.users.push({ id: `${sc.id}_reg`, schoolId: sc.id, role: "registrar", loginId: input.registrarEmail, password: "welcome123", name: `Registrar, ${sc.name}`, refId: null, status: "active", mustReset: true });
    audit(s, "school.create", "School", `Created school ${sc.name}`);
    persist();
    return { school: clone(sc), inviteLink: `/login?school=${sc.id}` };
  },
  async setStatus(id, status) {
    await latency();
    const s = need("petra");
    const sc = getDb().schools.find((x) => x.id === id);
    if (!sc) throw new ApiError("School not found.", "not_found");
    sc.status = status;
    audit(s, "school.status", "School", `${sc.name} set to ${status}`);
    persist();
  },
};

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday"];

const routine: RoutineRepo = {
  async list() {
    await latency();
    const s = need();
    const all = getDb().routine.filter((x) => x.schoolId === s.schoolId);
    if (s.role === "teacher") return clone(all.filter((x) => x.teacherId === s.refId));
    if (s.role === "student") {
      const me = getDb().students.find((x) => x.id === s.refId);
      return clone(me ? all.filter((x) => x.classNo === me.classNo && x.section === me.section) : []);
    }
    return clone(all);
  },
  async setSlot(slot) {
    await latency();
    const s = need("registrar");
    const db = getDb();
    if (slot.teacherId) {
      const clash = db.routine.find((x) => x.schoolId === s.schoolId && x.teacherId === slot.teacherId && x.day === slot.day && x.period === slot.period && !(x.classNo === slot.classNo && x.section === slot.section));
      if (clash) {
        const t = db.teachers.find((x) => x.id === slot.teacherId);
        throw new ApiError(`${t ? t.name : "Teacher"} already teaches Class ${clash.classNo}-${clash.section} in period ${slot.period} on ${DAY_NAMES[slot.day] ?? "that day"}.`, "conflict");
      }
    }
    const i = db.routine.findIndex((x) => x.schoolId === s.schoolId && x.classNo === slot.classNo && x.section === slot.section && x.day === slot.day && x.period === slot.period);
    const row = { ...slot, schoolId: s.schoolId };
    if (i >= 0) db.routine[i] = row; else db.routine.push(row);
    audit(s, "routine.set", "Routine", `Class ${slot.classNo}-${slot.section} ${DAY_NAMES[slot.day] ?? ""} P${slot.period}: ${slot.subject}`);
    persist();
  },
  async clearSlot(classNo, section, day, period) {
    await latency();
    const s = need("registrar");
    const db = getDb();
    db.routine = db.routine.filter((x) => !(x.schoolId === s.schoolId && x.classNo === classNo && x.section === section && x.day === day && x.period === period));
    audit(s, "routine.clear", "Routine", `Class ${classNo}-${section} ${DAY_NAMES[day] ?? ""} P${period} cleared`);
    persist();
  },
  async examSlots(examId) {
    await latency();
    const s = need();
    return clone(getDb().examSlots.filter((x) => x.schoolId === s.schoolId && x.examId === examId));
  },
  async saveExamSlot(slot) {
    await latency();
    const s = need("registrar");
    if (slot.end <= slot.start) throw new ApiError("End time must be after start time.", "invalid");
    const db = getDb();
    const dup = db.examSlots.find((x) => x.schoolId === s.schoolId && x.examId === slot.examId && x.classNo === slot.classNo && x.date === slot.date && x.id !== slot.id && x.start < slot.end && slot.start < x.end);
    if (dup) throw new ApiError(`Class ${slot.classNo} already has ${dup.subject} at that time.`, "conflict");
    if (slot.id) {
      const row = db.examSlots.find((x) => x.id === slot.id && x.schoolId === s.schoolId);
      if (!row) throw new ApiError("Exam slot not found.", "not_found");
      Object.assign(row, slot);
    } else {
      db.examSlots.push({ ...slot, id: `${s.schoolId}_es${Date.now().toString(36)}${code(2)}`, schoolId: s.schoolId });
    }
    audit(s, "examroutine.save", "Exam routine", `Class ${slot.classNo} ${slot.subject} on ${slot.date}`);
    persist();
  },
  async removeExamSlot(id) {
    await latency();
    const s = need("registrar");
    const db = getDb();
    db.examSlots = db.examSlots.filter((x) => !(x.id === id && x.schoolId === s.schoolId));
    audit(s, "examroutine.remove", "Exam routine", "Removed an exam routine row");
    persist();
  },
};

export const mockRepos: Repos = { auth, school, student, teacher, klass, exam, marks, result, magazine, notice, approval, audit: auditRepo, platform, routine };

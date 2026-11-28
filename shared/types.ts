/**
 * What the main process tells the window. The main process owns the device
 * token and every call to the server; the window only ever sees this.
 */

export type SessionInfo = {
  user: { id: string; name: string; loginId: string; avatar: string | null; mustChangePassword: boolean };
  school: { id: string; name: string; logo: string | null } | null;
  /** The platform admin: the web inside the app, never any school's data offline. */
  onlineOnly: boolean;
  permissions: string[];
  syncTables: string[];
};

export type Connection = "checking" | "online" | "offline";

export type UpdateState = {
  status: "idle" | "checking" | "available" | "downloaded" | "none" | "error";
  version?: string;
  percent?: number;
  message?: string;
};

export type AppState =
  | { phase: "starting" }
  | { phase: "signed-out"; connection: Connection; notice?: SignedOutNotice }
  | {
      phase: "signed-in";
      connection: Connection;
      session: SessionInfo;
      /** When the server was last reached; offline screens show it. */
      lastContact: string;
      /** The web app is loaded and showing under the bar. */
      webShown: boolean;
    };

/** Why the sign-in screen is showing, when it isn't a fresh start. */
export type SignedOutNotice = "revoked" | "expired" | "signed-out-on-web";

export type LoginResult = { ok: true } | { ok: false; message: string };

/* ------------------------------------------------------------------ */
/* Offline work (Phase 3: attendance)                                  */
/* ------------------------------------------------------------------ */

/** A change that the server would not take, waiting for someone to look at it. */
export type SyncIssue = {
  opId: string;
  /** What kind of change: "attendance.mark", "payment.record", … */
  action: string;
  /** What it was, in the app's words: "Attendance — Class 5 — A, 2026-11-27". */
  title: string;
  message: string;
  createdAt: string;
};

/** Where this PC's offline copy stands. The bar and every offline screen show it. */
export type SyncStatus = {
  /** False for the platform admin and when signed out: nothing is kept on the PC. */
  available: boolean;
  /** A sync is under way right now. */
  running: boolean;
  /** The first download hasn't finished; offline screens can't work yet. */
  firstSyncDone: boolean;
  /** Rows downloaded in the sync under way, for the progress line. */
  downloaded: number;
  /** Saved on this PC and not yet on the server. */
  waiting: number;
  issues: SyncIssue[];
  /** When the last full sync (send, then download) finished. */
  lastSynced: string | null;
  /** Why the last sync stopped short, when the server refused it (not when offline). */
  error: string | null;
};

export type AttendanceStatusOption = { id: string; code: string; label: string; labelUr: string | null; effect: string };

export type AttendanceSetup = {
  session: { id: string; name: string } | null;
  sections: { id: string; label: string }[];
  statuses: AttendanceStatusOption[];
  /** The PC's own date, which is the school's day for a register marked here. */
  today: string;
  canView: boolean;
  canMark: boolean;
  /** May change an earlier day's register. */
  canEdit: boolean;
};

export type RegisterEntry = {
  enrollmentId: string;
  name: string;
  admissionNo: string;
  rollNo: number | null;
  statusId: string | null;
};

export type Register = {
  sectionId: string;
  date: string;
  entries: RegisterEntry[];
  /** Saved on this PC and not yet on the server. */
  waiting: boolean;
  /** The server refused the last save of this register; see the sync issues. */
  issue: string | null;
};

export type SaveResult = { ok: true } | { ok: false; message: string };

/* ------------------------------------------------------------------ */
/* Fee collection (Phase 4)                                            */
/* ------------------------------------------------------------------ */

/** The school as a receipt prints it (GET /api/desktop/v1/school). */
export type SchoolInfo = { name: string; nameUr: string | null; address: string | null; phone: string | null; logo: string | null; currency: string };

export type FeeSetup = {
  currency: string;
  accounts: { id: string; name: string; isDefault: boolean }[];
  today: string;
  canCollect: boolean;
  /** Receipt numbers this PC still holds; at 0 a receipt prints as provisional. */
  receiptsLeft: number;
};

export type StudentHit = { studentId: string; name: string; admissionNo: string; fatherName: string | null; classLabel: string | null };

export type LedgerCharge = {
  id: string;
  head: string;
  period: string;
  dueDate: string;
  net: number;
  /** Paid on the server, and collected here but not yet sent. */
  paid: number;
  waiting: number;
  outstanding: number;
};

export type LedgerPayment = {
  /** `payment:<id>` once on the server, `op:<opId>` while waiting here. */
  key: string;
  receiptNo: string | null;
  amount: number;
  paidOn: string;
  state: "synced" | "waiting" | "issue";
  cancelled: boolean;
};

export type Ledger = { student: StudentHit; charges: LedgerCharge[]; payments: LedgerPayment[]; outstanding: number; advance: number };

export type CollectInput = { studentId: string; amount: number; accountId: string | null; reference: string | null; paidOn: string };
export type CollectResult = { ok: true; receiptKey: string } | { ok: false; message: string };

export type ReceiptView = {
  school: SchoolInfo | null;
  currency: string;
  receiptNo: string | null;
  paidOn: string;
  student: StudentHit;
  account: string | null;
  reference: string | null;
  lines: { head: string; period: string; amount: number }[];
  total: number;
  advance: number;
  /** Still outstanding after this payment, on what this PC knows. */
  balance: number;
  waiting: boolean;
  cancelled: boolean;
};

export type ReceiptSize = "a4" | "thermal";

/* ------------------------------------------------------------------ */
/* Registration and students (Phase 5)                                 */
/* ------------------------------------------------------------------ */

/**
 * The school's admission form, as the server keeps it (AdmissionFormSettings
 * in src/lib/admission-form.ts, ilmways). Only what the form needs to draw.
 */
export type FieldType = "text" | "textarea" | "number" | "date" | "select" | "radio" | "checkbox" | "phone" | "email" | "cnic" | "table";
export type FormSection = "program" | "student" | "family" | "contact" | "previous" | "academic" | "other" | "office";
export type AdmissionField = {
  id: string;
  label: string;
  type: FieldType;
  section: FormSection;
  required: boolean;
  enabled: boolean;
  options: string[];
  columns: string[];
  rows: string[];
  classes: string[];
  hint: string;
};
export type CoreKey =
  | "lastName" | "bForm" | "fatherName" | "dob" | "gender" | "phone" | "email" | "address"
  | "guardianCnic" | "guardianPhone" | "guardianEmail" | "rollNo" | "monthlyFee";
export type CoreSetting = { enabled: boolean; required: boolean; label?: string };
export type AdmissionFormSettings = {
  core: Record<CoreKey, CoreSetting>;
  fields: AdmissionField[];
  documents: { id: string; label: string; required: boolean; enabled: boolean }[];
};

export type AdmitClass = { id: string; name: string; sections: { id: string; name: string }[] };

export type AdmitSetup = {
  form: AdmissionFormSettings | null;
  classes: AdmitClass[];
  session: { id: string; name: string } | null;
  today: string;
  /** The next number this PC would give, from its reserved block; "" when it holds none. */
  nextAdmissionNo: string;
  admissionNosLeft: number;
};

/** The admission form's fields under the web form's own input names. */
export type AdmitInput = { fields: Record<string, string> };
export type AdmitResult = { ok: true; studentId: string } | { ok: false; message: string; field?: string };

/** The student's own details, as the web's edit form has them. */
export type StudentDetails = {
  admissionNo: string;
  firstName: string;
  lastName: string;
  fatherName: string;
  dob: string;
  gender: string;
  bForm: string;
  phone: string;
  email: string;
  address: string;
  admittedOn: string;
};

export type StudentProfile = {
  studentId: string;
  details: StudentDetails;
  status: string;
  classLabel: string | null;
  sessionName: string | null;
  guardians: { name: string; relation: string | null; phone: string | null }[];
  /** Answers to the school's own fields, label and value. */
  answers: { label: string; value: string }[];
  /** Saved here and not yet on the server: admitted, or edited. */
  waiting: boolean;
  issue: string | null;
  /** Admitted on this PC and not yet on the server. */
  admittedHere: boolean;
};

export type AdmissionLetterView = {
  school: SchoolInfo | null;
  name: string;
  fatherName: string | null;
  admissionNo: string;
  admittedOn: string;
  className: string | null;
  sessionName: string | null;
  guardian: string | null;
  documents: { label: string; received: boolean }[];
};

/** The window's own screens over the web app. */
export type NativeScreen = "home" | "attendance" | "fees" | "students" | "admit";

export type DesktopApi = {
  getState(): Promise<AppState>;
  onState(listener: (state: AppState) => void): () => void;
  login(identifier: string, password: string): Promise<LoginResult>;
  logout(): Promise<void>;
  retryConnection(): Promise<void>;
  getUpdateState(): Promise<UpdateState>;
  onUpdateState(listener: (state: UpdateState) => void): () => void;
  installUpdate(): void;
  appVersion(): Promise<string>;

  /** Show one of the window's own screens over the web app, or null for the web app. */
  setScreen(screen: NativeScreen | null): void;
  onScreen(listener: (screen: NativeScreen | null) => void): () => void;
  /** The web app's history, for the bar's back and forward buttons. */
  onWebNav(listener: (nav: WebNav) => void): () => void;
  webBack(): void;
  webForward(): void;
  webReload(): void;
  /** The account menu, drawn natively so it shows over the web app. `at` is in window coordinates. */
  openAccountMenu(at: { x: number; y: number }, labels: { signOut: string; version: string; waiting?: string }): void;

  getSyncStatus(): Promise<SyncStatus>;
  onSyncStatus(listener: (status: SyncStatus) => void): () => void;
  syncNow(): Promise<void>;
  retryIssue(opId: string): Promise<void>;
  discardIssue(opId: string): Promise<void>;

  attendanceSetup(): Promise<AttendanceSetup>;
  attendanceRegister(sectionId: string, date: string): Promise<Register>;
  saveRegister(input: { sectionId: string; date: string; entries: { enrollmentId: string; statusId: string }[] }): Promise<SaveResult>;

  feeSetup(): Promise<FeeSetup | null>;
  searchStudents(query: string): Promise<StudentHit[]>;
  ledger(studentId: string): Promise<Ledger | null>;
  collect(input: CollectInput): Promise<CollectResult>;
  receipt(key: string): Promise<ReceiptView | null>;
  admitSetup(): Promise<AdmitSetup | null>;
  admit(input: AdmitInput): Promise<AdmitResult>;
  studentProfile(studentId: string): Promise<StudentProfile | null>;
  editStudent(studentId: string, details: StudentDetails): Promise<SaveResult>;
  admissionLetter(studentId: string): Promise<AdmissionLetterView | null>;

  /** Print a page the window drew (a receipt), in a window of its own with no scripts. */
  printHtml(html: string, size: ReceiptSize): Promise<SaveResult>;
  platform: NodeJS.Platform;
  locale: string;
};

export type WebNav = { canGoBack: boolean; canGoForward: boolean; title: string };

/** Height of the window's own title bar; the web view sits below it. */
export const BAR_HEIGHT = 40;

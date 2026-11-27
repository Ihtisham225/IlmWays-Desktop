/** The few line icons the window's own screens use (Lucide's shapes, ISC licence). */
type Props = { className?: string };

function Icon({ className = "size-4", children }: Props & { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      {children}
    </svg>
  );
}

export const ChevronLeft = (p: Props) => <Icon {...p}><path d="m15 18-6-6 6-6" /></Icon>;
export const ChevronRight = (p: Props) => <Icon {...p}><path d="m9 18 6-6-6-6" /></Icon>;
export const ChevronDown = (p: Props) => <Icon {...p}><path d="m6 9 6 6 6-6" /></Icon>;
export const Reload = (p: Props) => (
  <Icon {...p}>
    <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
    <path d="M21 3v5h-5" />
  </Icon>
);
export const Globe = (p: Props) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="10" />
    <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
    <path d="M2 12h20" />
  </Icon>
);
export const ClipboardCheck = (p: Props) => (
  <Icon {...p}>
    <rect width="8" height="4" x="8" y="2" rx="1" />
    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
    <path d="m9 14 2 2 4-4" />
  </Icon>
);
export const CloudCheck = (p: Props) => (
  <Icon {...p}>
    <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
    <path d="m9.5 14 2 2 3.5-3.5" />
  </Icon>
);
export const CloudOff = (p: Props) => (
  <Icon {...p}>
    <path d="m2 2 20 20" />
    <path d="M5.78 5.78A7 7 0 0 0 9 19h8.5a4.5 4.5 0 0 0 1.31-.2" />
    <path d="M21.53 16.5A4.5 4.5 0 0 0 17.5 10h-1.79A7 7 0 0 0 10.2 5.2" />
  </Icon>
);
export const Spinner = ({ className = "size-4" }: Props) => <Reload className={`${className} animate-spin`} />;
export const Alert = (p: Props) => (
  <Icon {...p}>
    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
    <path d="M12 9v4" />
    <path d="M12 17h.01" />
  </Icon>
);
export const Arrow = (p: Props) => <Icon {...p}><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></Icon>;

export function BuddyMascot({ size = 112 }: { size?: number }) {
  return (
    <svg className="buddy-mascot" width={size} height={size} viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <ellipse cx="60" cy="108" rx="28" ry="6" fill="#ececec" />
      <rect x="28" y="38" width="64" height="52" rx="22" fill="#f4f4f4" stroke="#d9d9d9" />
      <path d="M38 44c0-12 8-22 22-22s22 10 22 22" fill="#f7f7f7" stroke="#d9d9d9" />
      <rect x="40" y="50" width="40" height="22" rx="8" fill="#1f1f1f" />
      <circle cx="52" cy="61" r="4" fill="#5b8cff" />
      <circle cx="68" cy="61" r="4" fill="#5b8cff" />
      <rect x="48" y="78" width="24" height="14" rx="4" fill="#ececec" stroke="#d4d4d4" />
      <path d="M34 58h-8M94 58h8" stroke="#cfcfcf" strokeWidth="3" strokeLinecap="round" />
      <path d="M44 30c-6-8-14-8-16-2M76 30c6-8 14-8 16-2" stroke="#d0d0d0" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

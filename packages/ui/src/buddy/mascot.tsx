import naidanUrl from "./naidan.png";

type Props = {
  size?: number;
  compact?: boolean;
};

export function BuddyMascot({ size = 112, compact = false }: Props) {
  return (
    <img
      className={compact ? "buddy-mascot is-compact" : "buddy-mascot"}
      src={naidanUrl}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
    />
  );
}

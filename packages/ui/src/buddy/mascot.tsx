import faceUrl from "./linabell-face.png";
import fullUrl from "./linabell.png";

type Props = {
  size?: number;
  compact?: boolean;
  face?: boolean;
};

export function BuddyMascot({ size = 160, compact = false, face = false }: Props) {
  const useFace = compact || face;
  return (
    <img
      className={compact ? "buddy-mascot is-compact" : "buddy-mascot"}
      src={useFace ? faceUrl : fullUrl}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
    />
  );
}

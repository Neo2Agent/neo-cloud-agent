import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

/** True when the OS asks for reduced motion. Starts false until the first read. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let alive = true;
    const apply = (value: boolean) => {
      if (alive) setReduced(value);
    };
    void AccessibilityInfo.isReduceMotionEnabled().then(apply);
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", apply);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  return reduced;
}

import { BUDDY_SHORTCUTS, padBuddyGrid, type BuddySkill } from "./catalog";
import { BuddyIcon } from "./icons";
import { BuddyMascot } from "./mascot";
import { BuddyTargetToggle } from "./target-toggle";

type Props = {
  moreOpen: boolean;
  target?: "cloud" | "desk";
  deskDisabled?: boolean;
  showTarget?: boolean;
  skills: BuddySkill[];
  onTarget?: (value: "cloud" | "desk") => void;
  onShortcut: (id: (typeof BUDDY_SHORTCUTS)[number]["id"]) => void;
  onSkill: (id: string) => void;
};

export function BuddyHome({
  moreOpen,
  target = "cloud",
  deskDisabled,
  showTarget,
  skills,
  onTarget,
  onShortcut,
  onSkill,
}: Props) {
  const targetToggle = (showTarget ?? Boolean(onTarget)) && onTarget;
  return (
    <div className={moreOpen ? "buddy-home is-more" : "buddy-home"}>
      <div className="buddy-home-hero">
        <BuddyMascot />
        <h2 className="buddy-hello">Neo，我帮你</h2>
        {targetToggle ? (
          <BuddyTargetToggle value={target} deskDisabled={deskDisabled} onChange={onTarget} />
        ) : null}
      </div>
      {moreOpen ? (
        <ul className="buddy-skill-grid">
          {padBuddyGrid(skills, 3).map((item, index) => (
            <li key={item?.id ?? `pad-${index}`}>
              {item ? (
                <button type="button" onClick={() => onSkill(item.id)}>
                  <span className="buddy-icon-slot">
                    <BuddyIcon name={item.icon} />
                  </span>
                  <span>{item.label}</span>
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      <nav className="buddy-shortcuts" aria-label="快捷入口">
        {BUDDY_SHORTCUTS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={item.id === "more" && moreOpen ? "is-on" : undefined}
            onClick={() => onShortcut(item.id)}
          >
            <span className="buddy-icon-slot">
              <BuddyIcon name={item.icon} />
            </span>
            <span>{item.id === "more" && moreOpen ? "收起" : item.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

import { BUDDY_SHORTCUTS, type BuddySkill } from "./catalog";
import { BuddyIcon } from "./icons";
import { BuddyMascot } from "./mascot";
import { BuddyTargetToggle } from "./target-toggle";

type Props = {
  moreOpen: boolean;
  target: "cloud" | "desk";
  deskDisabled?: boolean;
  skills: BuddySkill[];
  onTarget: (value: "cloud" | "desk") => void;
  onShortcut: (id: (typeof BUDDY_SHORTCUTS)[number]["id"]) => void;
  onSkill: (id: string) => void;
};

export function BuddyHome({ moreOpen, target, deskDisabled, skills, onTarget, onShortcut, onSkill }: Props) {
  return (
    <div className={moreOpen ? "buddy-home is-more" : "buddy-home"}>
      <div className="buddy-home-hero">
        <BuddyMascot />
        <h2 className="buddy-hello">Neo，我帮你</h2>
        <BuddyTargetToggle value={target} deskDisabled={deskDisabled} onChange={onTarget} />
      </div>
      {moreOpen ? (
        <ul className="buddy-skill-grid">
          {skills.map((item) => (
            <li key={item.id}>
              <button type="button" onClick={() => onSkill(item.id)}>
                <BuddyIcon name={item.icon} />
                <span>{item.label}</span>
              </button>
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
            <BuddyIcon name={item.icon} />
            <span>{item.id === "more" && moreOpen ? "收起" : item.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

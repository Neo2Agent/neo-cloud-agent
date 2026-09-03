/** Shared with the mobile composer; the logic lives in contracts so RN never imports web. */
export {
  applyMention,
  filterMentions,
  mentionKindLabel,
  mentionTrigger,
  type ComposerMention,
  type MentionKind,
} from "@neo-cloud-agent/contracts/mention";

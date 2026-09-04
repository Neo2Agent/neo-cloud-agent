# Sandbox term only. Host aliases / prompt stay out.
case $- in
  *i*) ;;
  *) return ;;
esac
set +o histexpand
bind "set bell-style none" 2>/dev/null || true
bind "set completion-ignore-case on" 2>/dev/null || true
bind "set show-all-if-ambiguous on" 2>/dev/null || true
bind "set page-completions off" 2>/dev/null || true
bind "set colored-stats off" 2>/dev/null || true
bind "set colored-completion-prefix off" 2>/dev/null || true

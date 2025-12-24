## term-capture machine-aware prompt configuration
## Source this from your zshrc after oh-my-zsh loads.

PM_PROMPT_VARIANT=${PM_PROMPT_VARIANT:-auto}
PM_CONFIG_DIR=${PM_CONFIG_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/term-capture}

# Optional: load shared + host-specific overrides from:
#   $PM_CONFIG_DIR/prompt-machine.zsh
#   $PM_CONFIG_DIR/prompt-machine.$HOST.zsh
#   $PM_CONFIG_DIR/prompt-machine.local.zsh
if [[ -d "$PM_CONFIG_DIR" ]]; then
  [[ -r "$PM_CONFIG_DIR/prompt-machine.zsh" ]] && source "$PM_CONFIG_DIR/prompt-machine.zsh"

  _pm_host=${HOST-}
  _pm_host=${_pm_host%%.*}
  if [[ -z "${_pm_host}" ]]; then
    _pm_host=$(hostname -s 2>/dev/null || hostname 2>/dev/null || print -r -- '')
    _pm_host=${_pm_host%%.*}
  fi
  if [[ -n "${_pm_host}" && -r "$PM_CONFIG_DIR/prompt-machine.${_pm_host}.zsh" ]]; then
    source "$PM_CONFIG_DIR/prompt-machine.${_pm_host}.zsh"
  fi
  unset _pm_host

  [[ -r "$PM_CONFIG_DIR/prompt-machine.local.zsh" ]] && source "$PM_CONFIG_DIR/prompt-machine.local.zsh"
fi

# Optional: rename hosts to short labels you like (exact host match).
# PM_HOST_LABELS=(
#   my-mbp mbp
#   ip-10-0-0-12 api-prod-1
# )
#
# Optional: set roles (exact host match).
# PM_HOST_ROLES=(
#   my-mbp local
#   ip-10-0-0-12 prod
# )
#
# Optional: role assignment rules (globs; first match wins).
# PM_HOST_ROLE_GLOBS=(
#   'ip-10-0-*=prod'
#   '*-stg=staging'
#   '*.dev=dev'
# )
#
# Optional: choose prompt variants by host (exact) or host globs.
# PM_HOST_VARIANTS=( my-mbp dense ip-10-0-0-12 two-line )
# PM_HOST_VARIANT_GLOBS=( '*prod*=two-line' )

source "${ZSH:-$HOME/.oh-my-zsh}/term-capture/zsh/prompt-machine.zsh"

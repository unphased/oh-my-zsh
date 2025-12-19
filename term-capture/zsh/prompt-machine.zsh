autoload -Uz add-zsh-hook colors vcs_info
colors

typeset -g PM_LOADED=1
typeset -g PM_PROMPT_VARIANT=${PM_PROMPT_VARIANT:-dense}
typeset -g PM_SHOW_USER=${PM_SHOW_USER:-auto}
typeset -g PM_HOST_MAXLEN=${PM_HOST_MAXLEN:-18}
typeset -g PM_ENABLE_VCS=${PM_ENABLE_VCS:-1}
typeset -g PM_VCS_CHECK_CHANGES=${PM_VCS_CHECK_CHANGES:-1}
typeset -g PM_PROMPT_CHAR=${PM_PROMPT_CHAR:-'❯'}
typeset -g PM_PROMPT_CHAR_ROOT=${PM_PROMPT_CHAR_ROOT:-'#'}
typeset -g PM_HOST_ALIAS_FALLBACK=${PM_HOST_ALIAS_FALLBACK:-short}

typeset -gA PM_HOST_LABELS
typeset -gA PM_HOST_ROLES
typeset -ga PM_HOST_ROLE_GLOBS

typeset -g PM_SEG_HOST=''
typeset -g PM_SEG_VCS=''
typeset -g PM_SEG_PATH=''
typeset -g PM_SEG_LEFT=''
typeset -g PM_SEG_RIGHT=''
typeset -g PM_LAST_STATUS=0

function pm_is_ssh() {
  [[ -n ${SSH_CONNECTION-} || -n ${SSH_CLIENT-} || -n ${SSH_TTY-} ]]
}

function pm_host_raw() {
  print -r -- ${HOST-$(hostname -s 2>/dev/null || hostname 2>/dev/null || print -r -- unknown)}
}

function pm_host_short() {
  local host
  host=$(pm_host_raw)
  host=${host%%.*}
  print -r -- "$host"
}

function pm_host_label() {
  local host label
  host=$(pm_host_raw)
  label=${PM_HOST_LABELS[$host]-}
  if [[ -z $label ]]; then
    if [[ $PM_HOST_ALIAS_FALLBACK == full ]]; then
      label=$host
    else
      label=$(pm_host_short)
    fi
  fi

  if (( ${#label} > PM_HOST_MAXLEN )); then
    label="${label[1,PM_HOST_MAXLEN]}"
  fi
  print -r -- "$label"
}

function pm_role_for_host() {
  local host role rule pattern value
  host=$(pm_host_raw)

  role=${PM_HOST_ROLES[$host]-}
  if [[ -n $role ]]; then
    print -r -- "$role"
    return 0
  fi

  for rule in "${PM_HOST_ROLE_GLOBS[@]}"; do
    pattern=${rule%%=*}
    value=${rule#*=}
    if [[ $host == ${~pattern} ]]; then
      print -r -- "$value"
      return 0
    fi
  done

  if pm_is_ssh; then
    case ${host:l} in
      (*prod*|*production*|*prd*) print -r -- prod ;;
      (*stg*|*stage*|*staging*)   print -r -- staging ;;
      (*dev*|*test*|*qa*)         print -r -- dev ;;
      (*)                         print -r -- remote ;;
    esac
  else
    print -r -- local
  fi
}

function pm_role_style() {
  local role bg fg tag
  role=$(pm_role_for_host)
  case $role in
    (prod)    bg=160 fg=15 tag='PROD' ;;
    (staging) bg=130 fg=15 tag='STG' ;;
    (dev)     bg=24  fg=15 tag='DEV' ;;
    (remote)  bg=60  fg=15 tag='SSH' ;;
    (local)   bg=236 fg=15 tag='LOCAL' ;;
    (*)       bg=240 fg=15 tag=${role:u} ;;
  esac
  print -r -- "$bg:$fg:$tag"
}

function pm_configure_vcs_info() {
  zstyle ':vcs_info:*' enable git
  zstyle ':vcs_info:*' max-exports 2
  zstyle ':vcs_info:git:*' formats ' %F{244}%b%u%c%f'
  zstyle ':vcs_info:git:*' actionformats ' %F{244}%b|%a%u%c%f'
  zstyle ':vcs_info:git:*' stagedstr '+'
  zstyle ':vcs_info:git:*' unstagedstr '!'
  zstyle ':vcs_info:git:*' check-for-changes "${PM_VCS_CHECK_CHANGES}"
}

function pm_update_vcs() {
  if [[ $PM_ENABLE_VCS != 1 ]]; then
    PM_SEG_VCS=''
    return 0
  fi
  vcs_info
  PM_SEG_VCS=${vcs_info_msg_0_-}
}

function pm_update_host_segment() {
  local bg fg tag role label ident show_user
  role=$(pm_role_style)
  bg=${role%%:*}
  role=${role#*:}
  fg=${role%%:*}
  tag=${role#*:}
  label=$(pm_host_label)

  show_user=$PM_SHOW_USER
  if [[ $show_user == auto ]]; then
    if pm_is_ssh || (( EUID == 0 )) || [[ -n ${SUDO_USER-} ]]; then
      show_user=always
    else
      show_user=never
    fi
  fi

  if [[ $show_user == always ]]; then
    ident="${USER-unknown}@${label}"
  else
    ident="$label"
  fi

  PM_SEG_HOST="%K{$bg}%F{$fg} $tag $ident %f%k"
}

function pm_update_path_segment() {
  PM_SEG_PATH=" %F{251}%~%f"
}

function pm_prompt_char() {
  if (( EUID == 0 )); then
    print -r -- "$PM_PROMPT_CHAR_ROOT"
  else
    print -r -- "$PM_PROMPT_CHAR"
  fi
}

function pm_build_prompt_dense() {
  local status_color prompt_char
  status_color='%(?.%F{70}.%F{203})'
  prompt_char=$(pm_prompt_char)
  PM_SEG_LEFT="${PM_SEG_HOST}${PM_SEG_PATH}${PM_SEG_VCS} ${status_color}${prompt_char}%f "
  PM_SEG_RIGHT="%(?..%F{203}exit:%?%f )%F{244}%*%f"
}

function pm_build_prompt_two_line() {
  local status_color prompt_char
  status_color='%(?.%F{70}.%F{203})'
  prompt_char=$(pm_prompt_char)
  PM_SEG_LEFT="${PM_SEG_HOST}${PM_SEG_PATH}${PM_SEG_VCS}\n${status_color}${prompt_char}%f "
  PM_SEG_RIGHT="%(?..%F{203}exit:%?%f )%F{244}%*%f"
}

function pm_build_prompt_minimal() {
  local status_color prompt_char
  status_color='%(?.%F{70}.%F{203})'
  prompt_char=$(pm_prompt_char)
  PM_SEG_LEFT="%F{244}%1~%f ${status_color}${prompt_char}%f "
  PM_SEG_RIGHT="%F{244}%*%f"
}

function pm_apply_prompt() {
  case $PM_PROMPT_VARIANT in
    (dense)    pm_build_prompt_dense ;;
    (two-line) pm_build_prompt_two_line ;;
    (minimal)  pm_build_prompt_minimal ;;
    (*)        PM_PROMPT_VARIANT=dense; pm_build_prompt_dense ;;
  esac
  PROMPT="$PM_SEG_LEFT"
  RPROMPT="$PM_SEG_RIGHT"
}

function pm_precmd() {
  local last_status=$?
  PM_LAST_STATUS=$last_status
  pm_update_host_segment
  pm_update_path_segment
  pm_update_vcs
  pm_apply_prompt
}

function pm_use() {
  if [[ -z ${1-} ]]; then
    print -r -- "usage: pm_use <dense|two-line|minimal>"
    return 2
  fi
  PM_PROMPT_VARIANT=$1
  pm_precmd
}

function pm_list_variants() {
  print -r -- "dense"
  print -r -- "two-line"
  print -r -- "minimal"
}

function pm_setup() {
  setopt prompt_subst
  pm_configure_vcs_info
  add-zsh-hook precmd pm_precmd
  pm_precmd
}

if [[ -z ${PM_SETUP_DONE-} ]]; then
  typeset -g PM_SETUP_DONE=1
  pm_setup
fi

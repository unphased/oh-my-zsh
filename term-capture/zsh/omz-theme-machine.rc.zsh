## term-capture: machine-specific oh-my-zsh theme selection
## Source this from your ~/.zshrc BEFORE loading oh-my-zsh.
##
## Default local override file: ~/.zshrc.machine
## Override path with: OMZ_MACHINE_THEME_FILE=/path/to/file
##
## Minimal ~/.zshrc.machine example:
##   ZSH_THEME="agnoster"
##
## If the override file is missing, falls back to: ZSH_THEME="lust"

: ${ZSH_THEME:=lust}

OMZ_MACHINE_THEME_FILE=${OMZ_MACHINE_THEME_FILE:-$HOME/.zshrc.machine}
if [[ -r "$OMZ_MACHINE_THEME_FILE" ]]; then
  source "$OMZ_MACHINE_THEME_FILE"
fi

: ${ZSH_THEME:=lust}


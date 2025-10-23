# Path to your oh-my-zsh configuration.
ZSH=$HOME/.oh-my-zsh

# for linuxbrew (no need to detect linux)
export MANPATH="$HOME/.linuxbrew/share/man:$MANPATH"
export INFOPATH="$HOME/.linuxbrew/share/info:$INFOPATH"
export COLORTERM=truecolor

# debug logging, remove me to not waste disk
# set the trace prompt to include seconds, nanoseconds, script name and line number
PS4='+$EPOCHREALTIME> '
# # save file stderr to file descriptor 3 and redirect stderr (including trace 
# # output) to a file with the script's PID as an extension
# exec 3>&2 2>/tmp/zshlog.$$
# # set options to turn on tracing and expansion of commands contained in the prompt
# setopt XTRACE VERBOSE

# Set name of the theme to load.
# Look in ~/.oh-my-zsh/themes/
# Optionally, if you set this to "random", it'll load a random theme each
# time that oh-my-zsh is loaded.
ZSH_THEME="lust"
export LANG=en_US.UTF-8

# Example aliases
# alias zshconfig="mate ~/.zshrc"
# alias ohmyzsh="mate ~/.oh-my-zsh"

# Set to this to use case-sensitive completion
# CASE_SENSITIVE="true"

# Comment this out to disable bi-weekly auto-update checks
DISABLE_AUTO_UPDATE="true"

# soooooo i put this back on, and it basically still sucks because its too dumb
# setopt correct

# Uncomment to change how many often would you like to wait before auto-updates occur? (in days)
# export UPDATE_ZSH_DAYS=13

# Uncomment following line if you want to disable colors in ls
# DISABLE_LS_COLORS="true"

# Uncomment following line if you want to disable autosetting terminal title.
# DISABLE_AUTO_TITLE="true"

# Uncomment following line if you want red dots to be displayed while waiting for completion
COMPLETION_WAITING_DOTS="true" # yes yes yes

# This is fantastic. Holy balls good.

autoload -U zmv
alias mmv='noglob zmv -W'

# Which plugins would you like to load? (plugins can be found in ~/.oh-my-zsh/plugins/*)
# Custom plugins may be added to ~/.oh-my-zsh/custom/plugins/
# Example format: plugins=(rails git textmate ruby lighthouse)
plugins=(git cp macos history F-Sy-H zsh-autosuggestions vi-mode lf zsh-copilot)

# api env vars for auth (e.g. zsh-copilot)
source ~/.ai-env

# autocomplete configuration reduce spasticness at least starting out
# The following zstyle settings are for zsh-autocomplete, which is not currently
# enabled, and may be causing completion conflicts.
# zstyle ':autocomplete:*' min-input 3
# Show this many history lines when pressing ↑.
# zstyle ':autocomplete:history-search:*' list-lines 200  # int
# completely absurd why this is not default
# zstyle ':autocomplete:*' widget-style menu-select 

# Debug git completion
# The autoload below was for debugging, but it can interfere with OMZ's compinit.
# autoload -Uz _git 2>/dev/null && echo "DEBUG: _git loaded successfully" || echo "DEBUG: _git load failed"

# not sure what this is
# zstyle ':completion:*' tag-order '! history-words' -

# set the history substring search custom settings before loading it
HISTORY_SUBSTRING_SEARCH_HIGHLIGHT_FOUND='bg=cyan,fg=black'
HISTORY_SUBSTRING_SEARCH_HIGHLIGHT_NOT_FOUND='bg=magenta,fg=black'

export VI_MODE_SET_CURSOR=true
source $ZSH/oh-my-zsh.sh


## These are for zsh-autocomplete to remove its weird bad history menu
# bindkey '\e[A' up-line-or-history
# bindkey '\eOA' up-line-or-history
# bindkey '\e[B' down-line-or-history
# bindkey '\eOB' down-line-or-history

setopt NO_NOMATCH
# that allows carat to work for git stuff

# complete words from tmux pane(s) {{{1
# Source: http://blog.plenz.com/2012-01/zsh-complete-words-from-tmux-pane.html
_tmux_pane_words() {
  local expl
  local -a w
  if [[ -z "$TMUX_PANE" ]]; then
    _message "not running inside tmux!"
    return 1
  fi
  # capture current pane first
  w=( ${(u)=$(tmux capture-pane -J -p)} )
  for i in $(tmux list-panes -F '#P'); do
    # skip current pane (handled above)
    [[ "$TMUX_PANE" = "$i" ]] && continue
    w+=( ${(u)=$(tmux capture-pane -J -p -t $i)} )
  done
  _wanted values expl 'words from current tmux pane' compadd -a w
}
 
zle -C tmux-pane-words-prefix   complete-word _generic
zle -C tmux-pane-words-anywhere complete-word _generic
bindkey '^Ff' tmux-pane-words-prefix
bindkey '^F^F' tmux-pane-words-anywhere
zstyle ':completion:tmux-pane-words-(prefix|anywhere):*' completer _tmux_pane_words
zstyle ':completion:tmux-pane-words-(prefix|anywhere):*' ignore-line current
# display the (interactive) menu on first execution of the hotkey
zstyle ':completion:tmux-pane-words-(prefix|anywhere):*' menu yes select interactive
zstyle ':completion:tmux-pane-words-anywhere:*' matcher-list 'b:=* m:{A-Za-z}={a-zA-Z}'
# }}}

# this should be allowed I think. But the system should really be configured to
# give that path to root user.
[[ $(id -u) == 0 ]] && export PATH=/usr/local/bin:$PATH
# export PAGER=vimpager

zmodload zsh/datetime
# this is for the $EPOCHREALTIME

# zmodload zsh/complist
# bindkey -M menuselect ' ' accept-and-infer-next-history
# bindkey -M menuselect '^?' undo

stty -ixon
stty -ixoff

bindkey "\e[1~" beginning-of-line
bindkey "\e[4~" end-of-line

# source $ZSH/plugins/history-substring-search/history-substring-search.plugin.zsh

# a bind seems to be needed to unbreak substring search whenever safe-paste (or 
# vi mode) are also enabled. But, there is yet another layer of weirdness with 
# this plugin, where if i use the arrow keys (like I had been for at least two 
# years) the behavior is inconsistent w.r.t. queued up keystrokes entered 
# during a longrunning process. But if I bind it to pgup/pgdn it does not 
# exhibit this problem. So I am switching the bind to pgup/pgdn in order to 
# make the behavior unambiguous
bindkey '\e[5~' history-substring-search-up
bindkey '\e[6~' history-substring-search-down

bindkey "\e[3~" delete-char
bindkey "\e[3;5~" kill-word
bindkey "\e[3;3~" kill-word
bindkey "\e" backward-delete-word

bindkey "\eOc" forward-word
bindkey "\eOd" backward-word

# ctrl left/right
bindkey "\e[1;5C" forward-word
bindkey "\e[1;5D" backward-word

# ctrl up/down
bindkey "\e[1;5A" beginning-of-line
bindkey "\e[1;5B" end-of-line

# alt
bindkey "\e[1;3C" forward-word
bindkey "\e[1;3D" backward-word

# alt up/down
bindkey "\e[1;3A" beginning-of-line
bindkey "\e[1;3B" end-of-line

# shift
bindkey "\e[1;2C" forward-word
bindkey "\e[1;2D" backward-word

bindkey "\e[5C" forward-word
bindkey "\e[5D" backward-word
bindkey "\e\e[C" forward-word
bindkey "\e\e[D" backward-word

# undo redo
bindkey "^U" undo
bindkey "^Y" redo

# submit a raw newline without triggering command. note will be like a semicolon and initiate a new command
function insert-newline() {
  LBUFFER+=$'\n'
}

# Create a widget from the function
zle -N insert-newline

# Bind the widget to a key sequence, in this case, \x1b\x0a
bindkey "\e^M" insert-newline

# TODO Turn into a real plugin which should be trivial
source $ZSH/line-editor.zsh

# for numpad enter key to work as enter, for easy right hand mouse reaching on full keyboards (I dont use those
# anymore though)
bindkey -s "\eOM" "^M"

bindkey -M vicmd '\e.' insert-last-word
bindkey -M viins '\e.' insert-last-word

autoload -Uz copy-earlier-word
zle -N copy-earlier-word
bindkey -M viins '\e,' copy-earlier-word
# Above wont work with autocomplete (its enabled since i've (temp?) given up on the latter due to 
# bad behavior), see https://github.com/marlonrichert/zsh-autocomplete/issues/425 may get this soon 
# yet!

export HISTSIZE=95000
export SAVEHIST=95000
export EXTENDED_HISTORY=1 # This appears to have no effect in conjunction with INC_APPEND_HISTORY which seems set by default

# This is an independent save of the history and terminal's cwd.
# This avoids problems that crop up when I try to squish the cwd into the history entry.
# function zshaddhistory()
# {
#   COMMAND_STR=${1%%$'\n'}
#   # rest is "default" zshaddhistory()
#   print -Sr ${COMMAND_STR}
#   fc -p
# }

. ~/.aliases.sh

# # Set GIT_AUTHOR_NAME based on system git config and machine-id
# MACHINE_ID=$(cat /opt/machine-id 2>/dev/null)
#
# if [[ -n "$MACHINE_ID" ]]; then
#   export GIT_AUTHOR_NAME="Steven Lu @ $MACHINE_ID"
#   echo "Set GIT_AUTHOR_NAME to $GIT_AUTHOR_NAME"
# else
#   echo -e "\e[1;31m\e[103m WARNING: /opt/machine-id not found! \e[0m"
#   echo -e "\e[1;31m\e[103m Please create it with: echo <unique-identifier> | sudo tee /opt/machine-id \e[0m"
#   echo -e "\e[1;31m\e[103m Using hostname as fallback. GIT_AUTHOR_NAME may not be unique. \e[0m"
#   export GIT_AUTHOR_NAME="Steven Lu @ $(hostname)"
# fi

# Function to update SSH_AUTH_SOCK, DISPLAY, and XAUTHORITY from tmux
update_env_from_tmux() {
  if [ -n "$TMUX" ]; then
    # Update SSH_AUTH_SOCK
    local tmux_ssh_auth_sock=$(tmux show-environment | grep "^SSH_AUTH_SOCK")
    if [[ -n "$tmux_ssh_auth_sock" ]]; then
      export $tmux_ssh_auth_sock
    fi

    # Update DISPLAY and XAUTHORITY
    local tmux_display=$(tmux show-environment | grep "^DISPLAY")
    local tmux_xauth=$(tmux show-environment | grep "^XAUTHORITY")
    if [[ -n "$tmux_display" && -n "$tmux_xauth" ]]; then
      export $tmux_display
      export $tmux_xauth
    fi
  fi
}

# Call update_env_from_tmux before each command
preexec_functions+=(update_env_from_tmux)

# Function to log command execution
log_command() {
  local cmd_start_time=$EPOCHREALTIME
  local cmd_string=$3
  typeset -g COMMAND_START_TIME
  typeset -g CMD_DELIMITER_ESCAPED
  COMMAND_START_TIME=$cmd_start_time
  local replace="@\\\$@"
  local cmd_escaped=${cmd_string//
/@\\n@}
  local cmd_delimiter_escaped=${cmd_escaped//@\$@/$replace}
  CMD_DELIMITER_ESCAPED=$cmd_delimiter_escaped
  local tmux_info=$([ -n "$TMUX" ] && tmux display -p "W #I:#W P#P D#D" || echo "No Tmux")
  
  print -r "$PWD@\$@${cmd_delimiter_escaped}@\$@GIT_AUTHOR_NAME_DEPRECATED@\$@$TTY@\$@$HOST@\$@$(date)@\$@$(git rev-parse --short HEAD 2> /dev/null)@\$@$tmux_info@\$@$cmd_start_time" >> ~/.zsh_enhanced_new_history
}

# Add log_command to preexec functions
preexec_functions+=(log_command)

# NOTE (no good place to put this) -- consider Antigen (move away from 
# oh-my-zsh)

handle_execution_duration() {
  RETVAL=$?
  # catch the time of the last command termination (which ordinarily will 
  # prompt the prompt to be run and therefore this func to run. But wont be 
  # good at tracking forked processes.)
  COMMAND_END_TIME=$EPOCHREALTIME
  if [[ -z $COMMAND_START_TIME ]]; then
    # echo "Shell is new, initialized at $COMMAND_END_TIME"
  else
    delta=$((COMMAND_END_TIME - COMMAND_START_TIME))
    print -r "command ($CMD_DELIMITER_ESCAPED) started at $COMMAND_START_TIME took ${delta}s with return value $RETVAL" >> ~/.zsh_enhanced_new_history
    if [ ${delta%%.*} -gt 7200 ]; then
      hours=$((${delta%%.*} / 3600))
      minutes=$(((${delta%%.*} % 3600) / 60))
      seconds=$((${delta%%.*} % 60))
      printf "\x1b[33m==> Took %d hr %d min %d sec\x1b[m\n" "$hours" "$minutes" "$seconds"
    elif [ ${delta%%.*} -gt 600 ]; then
      # Convert to minutes and keep fractional seconds
      minutes=$((${delta%%.*} / 60))
      fractional_seconds=$((${delta} - $minutes * 60))
      printf "\x1b[33m==> Took %d min %.3f sec\x1b[m\n" "$minutes" "$fractional_seconds"
    elif [ ${delta%%.*} -gt 4 ]; then
      # this will display the duration when exceeding 5.0 seconds
      printf "\x1b[33m==> Took %.3f sec\x1b[m\n" "$delta"
    fi
    COMMAND_START_TIME=
  fi
}

_last_color_tmux_pane_pwd=""
color_tmux_pane() {
  if [[ -z "$TMUX" ]]; then
    return
  fi

  local desired_color actual_color
  if [[ "$PWD" == "$_last_color_tmux_pane_pwd" ]]; then
    desired_color=$(~/util/color-pane.sh --get-color 2>/dev/null)
    if [[ -n "$desired_color" ]]; then
      actual_color=$(tmux display-message -p -t "${TMUX_PANE:-.}" '#{pane_bg}' 2>/dev/null)
      if [[ -n "$actual_color" && "${desired_color:l}" == "${actual_color:l}" ]]; then
        return
      fi
    fi
  fi

  # temp disabling this -- looking to swap to OSC11 to achieve this
  return

  # Avoid running if the directory hasn't changed.
  _last_color_tmux_pane_pwd=$PWD

  ~/util/set-bgcolor-by-cwd-tmux.zsh
}

# Add it to the precmd hooks, which is a robust way to handle this.
autoload -U add-zsh-hook
add-zsh-hook precmd handle_execution_duration
add-zsh-hook precmd color_tmux_pane

color_tmux_pane

echo "Finished loading my .zshrc"

# load fuzzyfind bindings etc
[ -f ~/.fzf.zsh ] && source ~/.fzf.zsh

emscriptenv () {
  # load emsdk env if present
  [ -f ~/emsdk/emsdk_env.sh ] && source ~/emsdk/emsdk_env.sh || echo no emsdk repo found.
}

[ -f ~/.zsh_user_profile ] && source ~/.zsh_user_profile


# ===== Below is custom zsh method to implement recall of previous cmds' cmd part, as a counterpart to venerable alt+.
typeset -g GET_FIRST_ARG_INDEX
typeset -g GET_FIRST_ARG_CURRENT

get-first-arg() {
    # local debug_file="/tmp/get-first-arg-debug.log"
    # echo "Function called at $(date)" > $debug_file

    if [[ -z $BUFFER || $BUFFER != $GET_FIRST_ARG_CURRENT ]]; then
        GET_FIRST_ARG_INDEX=1
        GET_FIRST_ARG_CURRENT=$BUFFER
    fi

    local current_cmd=${BUFFER%% *}
    local new_cmd
    local history_cmd

    while true; do
        history_cmd=$(fc -ln -$GET_FIRST_ARG_INDEX -$GET_FIRST_ARG_INDEX 2>/dev/null)
        
        # echo "Current index: $GET_FIRST_ARG_INDEX" >> $debug_file
        # echo "History command: $history_cmd" >> $debug_file

        if [[ -z $history_cmd ]]; then
            # echo "Reached beginning of history, resetting index" >> $debug_file
            GET_FIRST_ARG_INDEX=1
            continue
        fi

        new_cmd=$(echo $history_cmd | awk '{print $1}')
        # echo "New command: $new_cmd" >> $debug_file

        if [[ $new_cmd != $current_cmd ]]; then
            BUFFER="$new_cmd "
            CURSOR=$#BUFFER
            GET_FIRST_ARG_CURRENT=$BUFFER
            # echo "Found different command: $new_cmd" >> $debug_file
            break
        fi

        ((GET_FIRST_ARG_INDEX++))
        # echo "Command matches current, continuing search" >> $debug_file
    done

    # echo "Final BUFFER: $BUFFER" >> $debug_file
    # echo "Current INDEX: $GET_FIRST_ARG_INDEX" >> $debug_file
    # echo "Function finished at $(date)" >> $debug_file
    # echo "-------------------" >> $debug_file
}

zle -N get-first-arg
bindkey '\e,' get-first-arg

# Append a command directly
zvm_after_init_commands+=('[ -f ~/.fzf.zsh ] && source ~/.fzf.zsh')

test -e "$HOME/.shellfishrc" && source "$HOME/.shellfishrc"

# bun completions
[ -s "/Users/slu/.bun/_bun" ] && source "/Users/slu/.bun/_bun"

# bun
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"

# set ctrl e to recall cmds made in cwd
bindkey '^e' atuin-up-search

# for poetry
# fpath+=~/.zfunc
# autoload -Uz compinit && compinit

# for pyenv
export PYENV_ROOT="$HOME/.pyenv"
export PATH="$PYENV_ROOT/bin:$PATH"
# eval "$(pyenv init --path)"
eval "$(pyenv init -)"

# the atuin setup
eval "$(atuin init zsh --disable-up-arrow)"
eval "$(zoxide init zsh)"

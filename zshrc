# Path to your oh-my-zsh configuration.
ZSH=$HOME/.oh-my-zsh

# debug logging, remove me to not waste disk
# set the trace prompt to include seconds, nanoseconds, script name and line number
# This is GNU date syntax; by default Macs ship with the BSD date program, which isn't compatible
PS4='+$(date "+%s:%N") %N:%i> '
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
plugins=(git cp osx history zsh-syntax-highlighting history-substring-search)

source $ZSH/oh-my-zsh.sh

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
bindkey '^Ft' tmux-pane-words-prefix
bindkey '^F^F' tmux-pane-words-anywhere
zstyle ':completion:tmux-pane-words-(prefix|anywhere):*' completer _tmux_pane_words
zstyle ':completion:tmux-pane-words-(prefix|anywhere):*' ignore-line current
# display the (interactive) menu on first execution of the hotkey
zstyle ':completion:tmux-pane-words-(prefix|anywhere):*' menu yes select interactive
zstyle ':completion:tmux-pane-words-anywhere:*' matcher-list 'b:=* m:{A-Za-z}={a-zA-Z}'
# }}}

# Thankfully the path that is already present is the one that the system has set according to
# normal practices. This inserts a few more things that I use from the shell.
export PATH=~/bin:~/util:$PATH:/opt/local/bin:/usr/local/share/npm/bin

# this should be allowed I think. But the system should really be configured to
# give that path to root user.
[[ $(id -u) == 0 ]] && export PATH=/usr/local/bin:$PATH
# export PAGER=vimpager

# zmodload zsh/complist
# bindkey -M menuselect ' ' accept-and-infer-next-history
# bindkey -M menuselect '^?' undo

stty -ixon
stty -ixoff
bindkey "^[[1;3C" forward-word
bindkey "^[[1;3D" backward-word

# source $ZSH/plugins/history-substring-search/history-substring-search.plugin.zsh

# a bind seems to be needed to unbreak substring search whenever safe-paste (or 
# vi mode) are also enabled. But, there is yet another layer of weirdness with 
# this plugin, where if i use the arrow keys (like I had been for at least two 
# years) the behavior is inconsistent w.r.t. queued up keystrokes entered 
# during a longrunning process. But if I bind it to pgup/pgdn it does not 
# exhibit this problem. So I am switching the bind to pgup/pgdn in order to 
# make the behavior unambiguous
bindkey '^[[5~' history-substring-search-up
bindkey '^[[6~' history-substring-search-down

export HISTSIZE=5000
export SAVEHIST=5000
export EXTENDED_HISTORY=1 # This appears to have no effect in conjunction with INC_APPEND_HISTORY which seems set by default

# This is an independent save of the history and terminal's cwd.
# This avoids problems that crop up when I try to squish the cwd into the history entry.
function zshaddhistory()
{
  COMMAND_STR=${1%%$'\n'}
  # rest is "default" zshaddhistory()
  print -Sr ${COMMAND_STR}
  fc -p
}

. ~/.aliases.sh

# munge system git config's user name with environment git name (munge the bits 
# inside parens, check the bit before for equality)
GAN_NAME=${GIT_AUTHOR_NAME%\(*}
GAN_PARENS=${${GIT_AUTHOR_NAME#*\(}%\)*}
GAN_PARENS_LAST=${GAN_PARENS##*on }
GAN_PARENS_EXCEPT_LAST=${GAN_PARENS% on*}
[[ "$GAN_PARENS_LAST" == *\[* ]] && \
  GAN_PARENS_LAST_BRACKETS=${${GAN_PARENS_LAST#*\[}%\]*} && \
  GAN_PARENS_LAST_BEFORE_BRACKETS=${GAN_PARENS_LAST%\[*}

# The convention here will be [<number> tmux <number>] where numbers on each 
# side are omitted if they are one and represents which side of tmux they are 
# on

if [[ -n "$GAN_PARENS_LAST_BRACKETS" ]]; then
  (( INC_COUNT = $GAN_PARENS_LAST_BRACKETS + 1 ))
else
  INC_COUNT=2
fi

#echo "GAN_NAME=$GAN_NAME GAN_PARENS=$GAN_PARENS 
#GAN_PARENS_LAST=$GAN_PARENS_LAST 
#GAN_PARENS_LAST_BRACKETS=$GAN_PARENS_LAST_BRACKETS 
#GAN_PARENS_LAST_BEFORE_BRACKETS=$GAN_PARENS_LAST_BEFORE_BRACKETS 
#COUNT=$(($INC_COUNT - 1))"
GN_SYS=$(git config --get user.name)
GN_SYS_PARENS=${${GN_SYS#*\(}%\)*}
GN_SYS_NAME=${GN_SYS%\(*}
#echo "GN_SYS_NAME=$GN_SYS_NAME GN_SYS_PARENS=$GN_SYS_PARENS"

if [[ -n "$GIT_AUTHOR_NAME" && "$GAN_NAME" != "$GN_SYS_NAME" ]]; then
  echo "Git author name mismatch with user name: $GAN_NAME vs. $GN_SYS_NAME"
fi

# Be sure to update sshd_config on servers to accept the GIT_AUTHOR_NAME env to
# be passed through SSH
if [[ -n "$GAN_PARENS" ]]; then
  if [[ "$GAN_PARENS_LAST" == "$GN_SYS_PARENS" ]]; then
    export GIT_AUTHOR_NAME="$GN_SYS_NAME(${GAN_PARENS}[$INC_COUNT])" # only when $INC_COUNT == 2, really
    echo "new shell on same system, shell count was incremented, now is $GIT_AUTHOR_NAME"
  elif [[ "$GAN_PARENS_LAST_BEFORE_BRACKETS" == "$GN_SYS_PARENS" ]]; then
    export GIT_AUTHOR_NAME="$GN_SYS_NAME(${GAN_PARENS_EXCEPT_LAST} on ${GAN_PARENS_LAST_BEFORE_BRACKETS}[$INC_COUNT])" # only when $INC_COUNT == 2, really
    echo "new shell on same system, shell count was incremented, now is $GIT_AUTHOR_NAME"
  else
    export GIT_AUTHOR_NAME="$GN_SYS_NAME($GAN_PARENS on $GN_SYS_PARENS)"
    echo "GIT_AUTHOR_NAME is now $GIT_AUTHOR_NAME"
  fi
else
  export GIT_AUTHOR_NAME="$GN_SYS_NAME($GN_SYS_PARENS)"
  echo "GIT_AUTHOR_NAME is now $GIT_AUTHOR_NAME (seeded from git config)"
fi

# grab tmux environment during zsh preexec. tmux show-environment actually 
# magically does the right thing passing along the env that i want that was set 
# by PuTTY etc.
if [ -n "$TMUX" ]; then
  function tmux_env_per_cmd()
  {
    # this is the one that is run every command and implemments the updating of
    # the shell's GIT_AUTHOR_NAME
    TMUX_ENV_GAN=$(tmux show-environment GIT_AUTHOR_NAME)
    [[ $TMUX_ENV_GAN[1] == 'G' ]] && export "${TMUX_ENV_GAN%\)*}[tmux])"
    # if starts with '-' it means it was disabled by tmux
  }
  function refresh_tmux_env()
  {
    TMUX_ENV_GAN=$(tmux show-environment | grep "^GIT_AUTHOR_NAME")
    # TODO: Reconcile count in GAN and indicate tmux here and design this to 
    # transparently pass through counts (will be tricky)
    [[ -n "$TMUX_ENV_GAN" ]] && export "${TMUX_ENV_GAN%\)*}[tmux])"

    # Consequences -- if the tmux server was not initially started by the Mac 
    # (thereby seeding the entire tmux environment with SSH_AUTH_SOCK), you 
    # actually have to run some command from the Mac in a given terminal in 
    # order to trigger this preexec for the SSH_AUTH_SOCK to get registered 
    # into that particular shell. This is however not strictly an improvement 
    # on previous behavior because fresh panes that are made from the terminal 
    # not posessing the SSH socket env var won't pass it in. (I might take 
    # SSH_AUTH_SOCK out of this system to bring back old behavior - when I do 
    # that, this code can stay but won't do anything)
    TMUX_ENV_G_SSH_AUTH_SOCK=$(tmux show-environment -g | grep "^SSH_AUTH_SOCK")
    TMUX_ENV_SSH_AUTH_SOCK=$(tmux show-environment | grep "^SSH_AUTH_SOCK")
    [[ -z "$TMUX_ENV_SSH_AUTH_SOCK" ]] && tmux setenv ${(z)TMUX_ENV_G_SSH_AUTH_SOCK/=/ } && echo "Extended SSH_AUTH_SOCK to this session"
    # this expansion replacement is safe because the auth sock path has no 
    # equals in it (but even still it only replaces the first)
  }
  function preexec ()
  {
    tmux_env_per_cmd
    # TODO: make this only attempt when on a terminal that supports ecapes that
    # set title (e.g. MTerminal doesnt support it)

    # assumes using screen-* TERM (for some reason tmux seems to not require 
    # this when in xterm-* TERM -- it still sends the title) this sets the 
    # title for tmux to use. this is important for context sensitive tmux 
    # hotkey integration/delegation to work properly in Linux in particcular 
    printf "\x1b]2;${2//\%/%%}\x1b\\"

    # this does timing. For whatever reason, i can't do it in zshaddhistory 
    # (the env vars don't live beyond it), that's fine. (TODO consider moving 
    # the zsh_enhanced_new_history write operation to happen in here, this one 
    # can get the aliases and even full shell functions expanded out)
    COMMAND_START_TIME=$(date +%s%3N)
    # the start time can be used as a unique ID to locate the command, because 
    # the shell is pretty slow. We can always upgrade the timestamp to ns also.
    COMMAND_EXECUTION_STRING=$3
    # echo "command ($2) about to start at $COMMAND_START_TIME"
    # I think $2 already has no newline in it

    # defines escaped newline sentinel
    REPLACE="@\\\$@"
    # I decided here to trade ease-of-copy for ease of parsing and processing
    CMD_NEWLINE_ESCAPED=${COMMAND_EXECUTION_STRING//
/@\\n@}
    CMD_DELIMITER_ESCAPED=${CMD_NEWLINE_ESCAPED//@\$@/$REPLACE}
    print -r "$PWD@\$@${CMD_DELIMITER_ESCAPED}@\$@$GIT_AUTHOR_NAME@\$@$TTY@\$@$HOST@\$@$(date)@\$@$(git rev-parse --short HEAD 2> /dev/null)@\$@$COMMAND_START_TIME" >> ~/.zsh_enhanced_new_history
  }
  refresh_tmux_env
else
  function preexec ()
  {
    COMMAND_START_TIME=$(date +%s%3N)
    COMMAND_EXECUTION_STRING=$3
    REPLACE="@\\\$@"
    CMD_NEWLINE_ESCAPED=${COMMAND_EXECUTION_STRING//
/@\\n@}
    CMD_DELIMITER_ESCAPED=${CMD_NEWLINE_ESCAPED//@\$@/$REPLACE}
    print -r "$PWD@\$@${CMD_DELIMITER_ESCAPED}@\$@$GIT_AUTHOR_NAME@\$@$TTY@\$@$HOST@\$@$(date)@\$@$(git rev-parse --short HEAD 2> /dev/null)@\$@$COMMAND_START_TIME" >> ~/.zsh_enhanced_new_history
  }
fi

# NOTE (no good place to put this) -- consider Antigen (move away from 
# oh-my-zsh)

function precmd ()
{
  # catch the time of the last command termination (which ordinarily will 
  # prompt the prompt to be run and therefore this func to run)
  COMMAND_END_TIME=$(date +%s%3N)
  if [[ -z $COMMAND_START_TIME ]]; then
    echo "Shell is new, initialized at $COMMAND_END_TIME"
  else
    print -r "command ($CMD_DELIMITER_ESCAPED) started at $COMMAND_START_TIME took $((COMMAND_END_TIME - COMMAND_START_TIME)) ms" >> ~/.zsh_enhanced_new_history
  fi
}

echo "Finished loading my .zshrc"

# load fuzzyfind bindings etc
[ -f ~/.fzf.zsh ] && source ~/.fzf.zsh


# load nvm
export NVM_DIR=~/.nvm
[[ $(uname) == Darwin ]] && source $(brew --prefix nvm)/nvm.sh

# vim: ts=2 sw=2 et :

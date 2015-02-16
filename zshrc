# Path to your oh-my-zsh configuration.
ZSH=$HOME/.oh-my-zsh

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
plugins=(git cp osx history zsh-syntax-highlighting)

source $ZSH/oh-my-zsh.sh

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
bindkey '^X^Tt' tmux-pane-words-prefix
bindkey '^X^TT' tmux-pane-words-anywhere
zstyle ':completion:tmux-pane-words-(prefix|anywhere):*' completer _tmux_pane_words
zstyle ':completion:tmux-pane-words-(prefix|anywhere):*' ignore-line current
# display the (interactive) menu on first execution of the hotkey
zstyle ':completion:tmux-pane-words-(prefix|anywhere):*' menu yes select interactive
zstyle ':completion:tmux-pane-words-anywhere:*' matcher-list 'b:=* m:{A-Za-z}={a-zA-Z}'
# }}}

# Thankfully the path that is already present is the one that the system has set according to
# normal practices. This inserts a few more things that I use from the shell.
export PATH=~/bin:~/util:$PATH:/opt/local/bin:/usr/local/share/npm/bin:~/.apportable/SDK/bin

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
source $ZSH/plugins/history-substring-search/history-substring-search.plugin.zsh

export HISTSIZE=5000
export SAVEHIST=5000
export EXTENDED_HISTORY=1 # This appears to have no effect in conjunction with INC_APPEND_HISTORY which seems set by default

# This is an independent save of the history and terminal's cwd.
# This avoids problems that crop up when I try to squish the cwd into the history entry.
function zshaddhistory() {
    COMMAND_STR=${1%%$'\n'}
    [[ ( -z $COMMAND_STR ) || ( $COMMAND_STR =~ ^hist(ory)?$ ) || \
        ( $COMMAND_STR =~ ^l(s\|l\|a)?$ ) || \
        ( $COMMAND_STR =~ ^(d\|gd\|git\ diff\|glp\|gg)$ ) \
    ]] && return 1
    # do not do anything on common commands

    # do the needful
    print -r "$PWD; $COMMAND_STR; $GIT_AUTHOR_NAME@$TTY@$HOST@$(date +%s.%N)" >> ~/.zsh_enhanced_history

    # rest is "default" zshaddhistory()
    print -Sr ${COMMAND_STR}
    fc -p
}

. ~/.aliases.sh

# maintain this manually per-system
source ~/.keychain-setup.sh

# munge system git config's user name with environment git name (munge the bits 
# inside parens, check the bit before for equality)
GAN_NAME=${GIT_AUTHOR_NAME%\(*}
GAN_PARENS=${${GIT_AUTHOR_NAME#*\(}%\)*}
GAN_PARENS_LAST=${GAN_PARENS##*on }
[[ "$GAN_PARENS_LAST" == *\[* ]] && \
  GAN_PARENS_LAST_BRACKETS=${${GAN_PARENS#*\[}%\]*} && \
  GAN_PARENS_LAST_BEFORE_BRACKETS=${GAN_PARENS%\[*}

if [[ -n "$GAN_PARENS_LAST_BRACKETS" ]]; then
  (( INC_COUNT = $GAN_PARENS_LAST_BRACKETS + 1 ))
else
  INC_COUNT=2
fi

echo "GAN_NAME=$GAN_NAME GAN_PARENS=$GAN_PARENS GAN_PARENS_LAST=$GAN_PARENS_LAST GAN_PARENS_LAST_BRACKETS=$GAN_PARENS_LAST_BRACKETS GAN_PARENS_LAST_BEFORE_BRACKETS=$GAN_PARENS_LAST_BEFORE_BRACKETS COUNT=$(($INC_COUNT - 1))"
GN_SYS=$(git config --get user.name)
GN_SYS_PARENS=${${GN_SYS#*\(}%\)*}
GN_SYS_NAME=${GN_SYS%\(*}
echo "GN_SYS_NAME=$GN_SYS_NAME GN_SYS_PARENS=$GN_SYS_PARENS"

if [[ -n "$GIT_AUTHOR_NAME" && "$GAN_NAME" != "$GN_SYS_NAME" ]]; then
  echo "Git author name mismatch with user name: $GAN_NAME vs. $GN_SYS_NAME"
fi

# Be sure to update sshd_config on servers to accept the GIT_AUTHOR_NAME env to
# be passed through SSH
if [[ -n "$GAN_PARENS" ]]; then
  if [[ "$GAN_PARENS_LAST" == "$GN_SYS_PARENS" ]]; then
    export GIT_AUTHOR_NAME="$GN_SYS_NAME($GAN_PARENS)"
    echo "new shell on same system, GIT_AUTHOR_NAME remains $GIT_AUTHOR_NAME"
  else
    export GIT_AUTHOR_NAME="$GN_SYS_NAME($GAN_PARENS on $GN_SYS_PARENS)"
    echo "GIT_AUTHOR_NAME is now $GIT_AUTHOR_NAME"
  fi
else
  export GIT_AUTHOR_NAME="$GN_SYS_NAME($GN_SYS_PARENS)"
  echo "GIT_AUTHOR_NAME is now $GIT_AUTHOR_NAME (same as git config)"
fi

# grab tmux environment during zsh preexec. tmux show-environment actually 
# magically does the right thing passing along the env that i want that was set 
# by PuTTY etc.
if [ -n "$TMUX" ]; then
  function refresh_tmux_env {
    TMUX_ENV_GAN=$(tmux show-environment | grep "^GIT_AUTHOR_NAME")
    [[ -n "$TMUX_ENV_GAN" ]] && export "$TMUX_ENV_GAN"

    # Consequences -- if the tmux server was not initially started by the Mac 
    # (thereby seeding the entire tmux environment with SSH_AUTH_SOCK), you 
    # actually have to run some command from the Mac in a given terminal in 
    # order to trigger this preexec for the SSH_AUTH_SOCK to get registered 
    # into that particular shell. This is strictly an improvement on previous 
    # behavior.
    TMUX_ENV_SSH_AUTH_SOCK=$(tmux show-environment | grep "^SSH_AUTH_SOCK")
    [[ -n "$TMUX_ENV_SSH_AUTH_SOCK" ]] && export "$TMUX_ENV_SSH_AUTH_SOCK"
  }
  function preexec {
    refresh_tmux_env
  }
fi

echo "Finished loading my .zshrc"

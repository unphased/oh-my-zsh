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

export HISTSIZE=20000
export SAVEHIST=200000

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
    print -r "$PWD; $COMMAND_STR; $TTY@$HOST@$(date +%s.%N)" >> ~/.zsh_enhanced_history

    # rest is "default" zshaddhistory()
    print -Sr ${COMMAND_STR}
    fc -p
}

. ~/.aliases.sh

# maintain this manually per-system
source ~/.keychain-setup.sh

echo "Finished loading my .zshrc"

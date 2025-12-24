# Machine-specific oh-my-zsh theme selection

Goal: avoid “which machine am I on?” mistakes by picking a different `ZSH_THEME` per machine, without relying on hostname.

## How it works

- Default theme stays `lust` (same as today).
- If `~/.zshrc.machine` exists, it is sourced during startup.
- That local file can override `ZSH_THEME`.

## Setup

In `zshrc`, we source `~/.zshrc.machine` right after `ZSH_THEME="lust"`.

## Create the local file

On each machine, create `~/.zshrc.machine` (do not check it into git) with just:

```zsh
ZSH_THEME="lust"          # default
# ZSH_THEME="robbyrussell"  # example override
```

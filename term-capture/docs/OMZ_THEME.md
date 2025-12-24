# Oh-my-zsh theme selection (per machine)

If you keep a shared `~/.zshrc` across machines, the cleanest way to get machine-specific theming is a local override file that is not synced.

This repo ships a tiny helper that:
- sets a default `ZSH_THEME="lust"` (if you haven’t set one yet)
- sources a per-machine local file (defaults to `~/.zshrc.machine`)
- falls back to `"lust"` if the override file is missing

## Setup

In `~/.zshrc`, add this **before** `source $ZSH/oh-my-zsh.sh`:

```zsh
export ZSH="$HOME/.oh-my-zsh"

source "$ZSH/term-capture/zsh/omz-theme-machine.rc.zsh"

source "$ZSH/oh-my-zsh.sh"
```

## Per-machine override file

Create `~/.zshrc.machine` on each machine (don’t sync it) with just:

```zsh
ZSH_THEME="lust"
```

Pick any installed OMZ theme name, e.g.:

```zsh
ZSH_THEME="robbyrussell"
```

## Custom path (optional)

If you prefer a different location, set `OMZ_MACHINE_THEME_FILE` in your `~/.zshrc` before sourcing the helper:

```zsh
OMZ_MACHINE_THEME_FILE="$HOME/.config/zsh/theme.local.zsh"
source "$ZSH/term-capture/zsh/omz-theme-machine.rc.zsh"
```


# Machine-aware Zsh prompt

This repo includes an optional prompt helper that makes the machine/role highly salient (especially when SSH'd) while keeping the rest of the prompt compact.

## Enable

Add to `~/.zshrc`:

```zsh
source "$HOME/.oh-my-zsh/term-capture/zsh/prompt-machine.zsh"
```

Pick a variant:

```zsh
pm_use dense
pm_use two-line
pm_use minimal
```

## Machine mapping (recommended)

Exact host → label/role:

```zsh
PM_HOST_LABELS=(
  my-mbp mbp
  ip-10-0-0-12 api-prod-1
)

PM_HOST_ROLES=(
  my-mbp local
  ip-10-0-0-12 prod
)
```

Glob rules (first match wins):

```zsh
PM_HOST_ROLE_GLOBS=(
  'ip-10-0-*=prod'
  '*-stg=staging'
  '*.dev=dev'
)
```

Built-in fallback when SSH'd (if you don’t configure anything):
- host contains `prod|production|prd` → `prod`
- host contains `stg|stage|staging` → `staging`
- host contains `dev|test|qa` → `dev`
- otherwise → `remote`

## Tweaks

```zsh
PM_SHOW_USER=auto          # auto|always|never
PM_HOST_MAXLEN=18
PM_PROMPT_CHAR='❯'
PM_PROMPT_CHAR_ROOT='#'
PM_ENABLE_VCS=1
PM_VCS_CHECK_CHANGES=1
```


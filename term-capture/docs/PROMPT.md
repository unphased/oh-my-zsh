# Machine-aware Zsh prompt

This repo includes an optional prompt helper that makes the machine/role highly salient (especially when SSH'd) while keeping the rest of the prompt compact.

## Enable

Add to `~/.zshrc`:

```zsh
source "$HOME/.oh-my-zsh/term-capture/zsh/prompt-machine.rc.zsh"
```

Pick a variant:

```zsh
pm_use dense
pm_use two-line
pm_use minimal
```

If you want one synced config that auto-selects by hostname, set:

```zsh
PM_PROMPT_VARIANT=auto
```

If you want the *simplest* machine-specific setup (no hostname dependence), set these in your per-machine local file (e.g. `~/.zshrc.machine`, sourced by your `~/.zshrc`):

```zsh
PM_PROMPT_VARIANT=two-line
PM_MACHINE_LABEL="mbp"
PM_MACHINE_ROLE="local"   # local|remote|dev|staging|prod|...
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

Exact host → prompt variant (optional):

```zsh
PM_HOST_VARIANTS=(
  my-mbp dense
  ip-10-0-0-12 two-line
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

Glob rules for variants (first match wins):

```zsh
PM_HOST_VARIANT_GLOBS=(
  '*prod*=two-line'
  'ip-10-0-*=two-line'
)
```

Role → prompt variant defaults (used when `PM_PROMPT_VARIANT=auto` and no host match):
- `prod` → `two-line`
- `remote` → `two-line`
- `staging|dev|local` → `dense`

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

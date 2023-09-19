function check_word_splitting {
  local -a args
  local buffer="${LBUFFER}${RBUFFER}"
  printf "buf: >>%q<<\n" "$buffer" >> ~/zsh_word_splitting_log.txt
  args=(${(z):-"$buffer"})

  # Logging the array to a file
  for i in {1..${#args[@]}}; do
    printf 'arg[%d]: >>%q<<\n' $i "${args[i]}" >> ~/zsh_word_splitting_log.txt
  done
}

# Creating a widget from the function and binding it to a key (Ctrl+X in this case)
zle -N check_word_splitting
bindkey "^X" check_word_splitting


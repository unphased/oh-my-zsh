function check_word_splitting {
  local -a args
  local buffer="${LBUFFER}${RBUFFER}"
  print "buf: >>"$buffer"<<" >> ~/zsh_word_splitting_log.txt
  
  # Temporarily replace escaped spaces with a unique placeholder
  buffer="${buffer//\\ /__ESC_SPACE__}"
  
  buffer="${buffer//\\\\/\\\\\\\\}"
  buffer="${buffer//\\n/\\\\n}"
  buffer="${buffer//\\r/\\\\r}"
  buffer="${buffer//\\t/\\\\t}"
  
  print "buf_after: >>"$buffer"<<" >> ~/zsh_word_splitting_log.txt
  args=(${(z):-"$buffer"})
  
  # Replace the placeholders back with the original escaped spaces in each argument in the args array
  for i in {1..${#args[@]}}; do
    args[i]="${args[i]//__ESC_SPACE__/\\\ }"
  done

  # Logging the array to a file
  for i in {1..${#args[@]}}; do
    printf 'arg[%d]: >>%q<<\n' $i "${args[i]}" >> ~/zsh_word_splitting_log.txt
  done
}

# Creating a widget from the function and binding it to a key (Ctrl+X in this case)
zle -N check_word_splitting
bindkey "^X" check_word_splitting


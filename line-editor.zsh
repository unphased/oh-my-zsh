function check_word_splitting {
  local -a args
  local buffer="${LBUFFER}${RBUFFER}"
  print "buf: >>"$buffer"<<" >> ~/zsh_word_splitting_log.txt
  buffer="${buffer//\\n/\\\\n}"
  buffer="${buffer//\\r/\\\\r}"
  buffer="${buffer//\\t/\\\\t}"
  buffer="${buffer//\\\\/\\\\\\\\}"
  buffer="${buffer//\\ /\\\\ }"
  print "buf_after: >>"$buffer"<<" >> ~/zsh_word_splitting_log.txt
  args=(${(z):-"$buffer"})
  # args=(${(z):-"${LBUFFER}${RBUFFER}"})

  # Logging the array to a file
  for i in {1..${#args[@]}}; do
    print "arg[$i]: >>${args[i]}<<" >> ~/zsh_word_splitting_log.txt
  done
}

# Creating a widget from the function and binding it to a key (Ctrl+X in this case)
zle -N check_word_splitting
bindkey "^X" check_word_splitting


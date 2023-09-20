function move-current-arg-left {
  local -a args
  local buffer="${LBUFFER}${RBUFFER}"
  printf "start: >>%s█%s<<\n" "$LBUFFER" "$RBUFFER" >> ~/zsh_word_splitting_log.txt
  args=(${(z):-"$buffer"})

  # for arg in "${args[@]}"; do
  #   echo "arg: >>%s<<" "$arg" >> ~/zsh_word_splitting_log.txt
  # done

  # Finding the index of the current argument based on the cursor position
  local idx
  local length=0
  local cursor_pos_in_arg=0
  local args_in_lbuffer=(${(z):-"$LBUFFER"})
  local args_in_rbuffer=(${(z):-"$RBUFFER"})
  printf "number args in l/r buffers: %d %d tot args: %d last char lbuf: %s\n" "${#args_in_lbuffer}" "${#args_in_rbuffer}" "${#args}" "${LBUFFER: -1}" >> ~/zsh_word_splitting_log.txt

  # if lbuf_len + rbuf_len == args_len, then we're in a gap. Otherwise, it should be one greater, and we're in the
  # middle of an arg and the arg index would be lbuf_len + 1.

  if (( ${#args_in_lbuffer} + ${#args_in_rbuffer} == ${#args} )); then
    # When in a gap, if the last char of LBUFFER is a whitespace
    if [[ "${LBUFFER: -1}" == " " ]]; then
      idx=$(( ${#args_in_lbuffer} + 1 ))
    else
      idx=${#args_in_lbuffer}
    fi
  else
    idx=${#args_in_lbuffer}
  fi
  printf "idx: %d\n" "$idx" >> ~/zsh_word_splitting_log.txt

  # Swapping the current argument with the previous one if it's not the first argument
  # if (( idx > 1 )); then
  #   local temp=$args[$idx]
  #   args[$idx]=$args[$((idx-1))]
  #   args[$((idx-1))]=$temp
  #
  #   # Finding the new cursor position
  #   local new_cursor_pos=0
  #   for i in {1..$((idx-2))}; do
  #     new_cursor_pos=$(( $new_cursor_pos + ${#args[i]} + 1 ))
  #   done
  #   new_cursor_pos=$(( $new_cursor_pos + cursor_pos_within_arg ))
  #
  #   # Reconstructing LBUFFER and RBUFFER
  #   LBUFFER=${(j: :)args[1,idx-2]}
  #   LBUFFER="$LBUFFER ${args[idx-1]} ${args[idx]} "
  #   RBUFFER=" ${(j: :)args[idx+1,-1]}"
  #   CURSOR=$new_cursor_pos
  # fi
}

zle -N move-current-arg-left
bindkey "^B" move-current-arg-left

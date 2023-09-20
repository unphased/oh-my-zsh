function move-current-arg-left {
  local -a args
  local buffer="${LBUFFER}${RBUFFER}"
  # printf "buf: >>%q<<\n" "$buffer" >> ~/zsh_word_splitting_log.txt
  args=(${(z):-"$buffer"})

  # Finding the index of the current argument based on the cursor position
  local idx
  local length=0
  local cursor_pos_in_arg=0
  local args_in_lbuffer=(${(z):-"$LBUFFER"})
  for arg in "${args_in_lbuffer[@]}"; do
    length=$(( length + ${#arg} + 1 ))
  done
  length=$(( length - 1 )) # Adjusting for the extra space added in the last iteration

  # Finding the relative cursor position within the current argument
  if (( length > ${#LBUFFER} )); then
    cursor_pos_in_arg=$(( length - ${#LBUFFER} - 1 ))
    idx=${#args_in_lbuffer}
  else
    cursor_pos_in_arg=${#LBUFFER}
    idx=$(( ${#args_in_lbuffer} + 1 ))
  fi

  # Finding the relative cursor position within the current argument
  printf "2nd State dump: cursor_pos_in_arg=%d length=%d #LBUFFER=%d #args[idx]=%d\n" "$cursor_pos_in_arg" "$length" "${#LBUFFER}" "${#args[idx]}" >> ~/zsh_word_splitting_log.txt

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

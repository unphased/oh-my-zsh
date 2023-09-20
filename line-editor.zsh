function move-current-arg-left {
  local -a args
  local buffer="${LBUFFER}${RBUFFER}"
  printf "buf: >>%q<<\n" "$buffer" >> ~/zsh_word_splitting_log.txt
  args=(${(z):-"$buffer"})
  
  # Finding the index of the current argument based on the cursor position
  local idx
  local length=0
  for i in {1..${#args[@]}}; do
    length=$(( $length + ${#args[i]} + 1 ))
    if (( length >= ${#LBUFFER} )); then
      idx=$i
      printf "idx is %d: >>%q<<\n" "$idx" "${args[idx]}" >> ~/zsh_word_splitting_log.txt
      break
    fi
  done
  
  # Finding the relative cursor position within the current argument
  local cursor_pos_within_arg=$(( ${#LBUFFER} - $length + ${#args[idx]} + 1 ))

  # Swapping the current argument with the previous one if it's not the first argument
  if (( idx > 1 )); then
    local temp=$args[$idx]
    args[$idx]=$args[$((idx-1))]
    args[$((idx-1))]=$temp
    
    # Finding the new cursor position
    local new_cursor_pos=0
    for i in {1..$((idx-2))}; do
      new_cursor_pos=$(( $new_cursor_pos + ${#args[i]} + 1 ))
    done
    
    new_cursor_pos=$(( $new_cursor_pos + cursor_pos_within_arg ))

    # Reconstructing LBUFFER and RBUFFER
    LBUFFER=${(j: :)args[1,idx-2]}
    LBUFFER="$LBUFFER ${args[idx-1]} ${args[idx]} "
    RBUFFER=" ${(j: :)args[idx+1,-1]}"
    CURSOR=$new_cursor_pos
  fi
}

zle -N move-current-arg-left
bindkey "^X" move-current-arg-left

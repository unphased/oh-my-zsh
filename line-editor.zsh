function move-current-arg-left {
  local -a args
  local buffer="${LBUFFER}${RBUFFER}"
  printf "start: >>%s█%s<<\n" "$LBUFFER" "$RBUFFER" >> ~/zsh_word_splitting_log.txt
  printf "cursor: $CURSOR ${#LBUFFER}\n" >> ~/zsh_word_splitting_log.txt
  args=(${(z):-"$buffer"})
  local -a separators
  local last_idx=$(( ${#args[1]} + 1 ))
  unset CURSORIDX

  for arg in "${args[@]:1}"; do
    # Finding the start index of the current argument in the buffer
    # printf "Scanning this region now: >>%s<<\n" "${buffer[last_idx,-1]}" >> ~/zsh_word_splitting_log.txt
    local start_idx=$(( ${buffer[last_idx,-1][(i)$arg]} + last_idx - 1 ))

    separators+="${buffer[last_idx,start_idx-1]}"
    # printf "Adding separator in spot %d built from idxs %d to %d: >>%q<<\n" "${#separators}" "$last_idx" "$start_idx" "${buffer[last_idx,start_idx-1]}" >> ~/zsh_word_splitting_log.txt

    if (( CURSOR >= $(( start_idx - 1)) && CURSOR < ( start_idx + ${#arg} ) )); then
      CURSORIDX=$(( ${#separators} + 1 ))
      CURSOROFFSET=$(( $CURSOR - $start_idx + 2 ))
      printf "##### Cursor ($CURSOR) is associated with this arg (range $start_idx ~ $(( start_idx + ${#arg} ))) (no. %d): >>%s<<, the offset within the arg is %d\n" "$CURSORIDX" "$arg" "$CURSOROFFSET" >> ~/zsh_word_splitting_log.txt
    fi

    # Setting the last index to after the end of the current argument
    last_idx=$(( start_idx+${#arg} ))
    printf "last_idx set now to %d after incrementing startidx=%d by %d >>%s<<\n" "$last_idx" "$start_idx" ${#arg} "$arg" >> ~/zsh_word_splitting_log.txt
  done

  # Assert len of separators is one less than len of args
  if (( ${#separators} != ${#args} - 1 )); then
    printf "Error: separators and args are not the appropriate length: %d vs %d\n" "${#separators}" "${#args}" >> ~/zsh_word_splitting_log.txt
    for arg in "${separators[@]}"; do
      printf "Separator (escaped dump): >>%q<<\n" "$arg" >> ~/zsh_word_splitting_log.txt
    done
  fi

  # Printing the args and separators zipped up for debugging
  for i in {1..$(( ${#args} - 1 ))}; do
    printf "Arg ($i): >>%s<< Separator (escaped dump): >>%q<<\n" "${args[i]}" "${separators[i]}"
  done >> ~/zsh_word_splitting_log.txt
  printf "Last Arg (${#args}): >>%s<<\n\n" "$args[-1]" >> ~/zsh_word_splitting_log.txt

  # Swapping the current argument with the previous one if it's not the first argument
  if (( ${+CURSORIDX} )); then
    printf "Cursor was determined to be on arg number %d at position %d\n" "$CURSORIDX" "$CURSOROFFSET" >> ~/zsh_word_splitting_log.txt
    # Perform an array element swap
    local tmp=$args[$CURSORIDX]
    args[$CURSORIDX]=$args[$((CURSORIDX-1))]
    args[$((CURSORIDX-1))]=$tmp
    # build the buffers again
    LBUFFER=""
    RBUFFER=""
    for i in {1..$(( ${#args} - 1 ))}; do
      if (( i < CURSORIDX-1 )); then
        LBUFFER="$LBUFFER${args[i]}${separators[i]}"
        printf "i=$i Appending L >>%q<<\n" "${args[i]}${separators[i]}">> ~/zsh_word_splitting_log.txt
      elif (( i == CURSORIDX-1 )); then
        LBUFFER="$LBUFFER${args[i][1,CURSOROFFSET-1]}"
        RBUFFER="${args[i][CURSOROFFSET,-1]}${separators[i]}"
        printf "i=$i Appending L >>%q<< and initiating R >>%q<<\n" "${args[i][1,CURSOROFFSET-1]}" "${args[i][CURSOROFFSET,-1]}${separators[i]}">> ~/zsh_word_splitting_log.txt
      else
        RBUFFER="$RBUFFER${args[i]}${separators[i]}"
        printf "i=$i Appending R >>%q<<\n" "${args[i]}${separators[i]}">> ~/zsh_word_splitting_log.txt
      fi
    done
    RBUFFER="$RBUFFER${args[-1]}"
    printf "i=$i Appending R >>%q<<\n" "${args[-1]}">> ~/zsh_word_splitting_log.txt

  else
    printf "Cursor not on an arg, aborting." >> ~/zsh_word_splitting_log.txt
  fi
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
bindkey "\e[" move-current-arg-left
bindkey "\e]" move-current-arg-right

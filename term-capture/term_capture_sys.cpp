#include "term_capture_sys.hpp"

namespace tc {
namespace sys {
select_fn select_impl = ::select;

int select(int nfds, fd_set* readfds, fd_set* writefds, fd_set* exceptfds, struct timeval* timeout) {
  return select_impl(nfds, readfds, writefds, exceptfds, timeout);
}

void reset_to_default_select() {
  select_impl = ::select;
}
} // namespace sys
} // namespace tc

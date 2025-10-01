#ifndef TERM_CAPTURE_SYS_HPP
#define TERM_CAPTURE_SYS_HPP

#include <sys/select.h>
#include <sys/time.h>

namespace tc {
namespace sys {
using select_fn = int (*)(int, fd_set*, fd_set*, fd_set*, struct timeval*);

extern select_fn select_impl;

int select(int nfds, fd_set* readfds, fd_set* writefds, fd_set* exceptfds, struct timeval* timeout);

void reset_to_default_select();
} // namespace sys
} // namespace tc

#endif // TERM_CAPTURE_SYS_HPP

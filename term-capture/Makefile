CXX = g++
CXXFLAGS = -Wall -Wextra -O2
TARGETS = term-capture hexflow
TERM_CAPTURE_SRCS = term-capture.cpp
HEXFLOW_SRCS = hexflow.cpp
TERM_CAPTURE_OBJS = $(TERM_CAPTURE_SRCS:.cpp=.o)
HEXFLOW_OBJS = $(HEXFLOW_SRCS:.cpp=.o)

all: $(TARGETS)

term-capture: $(TERM_CAPTURE_OBJS)
	$(CXX) $(TERM_CAPTURE_OBJS) -o $@

hexflow: $(HEXFLOW_OBJS)
	$(CXX) $(HEXFLOW_OBJS) -o $@

%.o: %.cpp
	$(CXX) $(CXXFLAGS) -c $< -o $@

clean:
	rm -f $(TERM_CAPTURE_OBJS) $(HEXFLOW_OBJS) $(TARGETS)

.PHONY: all clean

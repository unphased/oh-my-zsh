CXX = g++
COMMON_FLAGS = -Wall -Wextra
DEBUG_FLAGS = $(COMMON_FLAGS) -g -O0 -DDEBUG
RELEASE_FLAGS = $(COMMON_FLAGS) -O2 -DNDEBUG

TARGETS = term-capture hexflow

all: debug release

debug: debug/term-capture debug/hexflow

release: release/term-capture release/hexflow

debug/term-capture: debug/term-capture.o
	$(CXX) $< -o $@

debug/hexflow: debug/hexflow.o
	$(CXX) $< -o $@

release/term-capture: release/term-capture.o
	$(CXX) $< -o $@

release/hexflow: release/hexflow.o
	$(CXX) $< -o $@

debug/%.o: %.cpp
	@mkdir -p debug
	$(CXX) $(DEBUG_FLAGS) -c $< -o $@

release/%.o: %.cpp
	@mkdir -p release
	$(CXX) $(RELEASE_FLAGS) -c $< -o $@

clean:
	rm -rf debug release

.PHONY: all debug release clean


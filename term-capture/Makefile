CXX = g++
COMMON_FLAGS = -Wall -Wextra
DEBUG_FLAGS = $(COMMON_FLAGS) -g -O0 -DDEBUG
RELEASE_FLAGS = $(COMMON_FLAGS) -O2 -DNDEBUG

TARGETS = term-capture hexflow

all: debug release

debug: $(patsubst %,debug/%,$(TARGETS))

release: $(patsubst %,release/%,$(TARGETS))

debug/%: debug/%.o
	$(CXX) $(DEBUG_FLAGS) $^ -o $@

release/%: release/%.o
	$(CXX) $(RELEASE_FLAGS) $^ -o $@

debug/%.o: %.cpp
	@mkdir -p debug
	$(CXX) $(DEBUG_FLAGS) -c $< -o $@

release/%.o: %.cpp
	@mkdir -p release
	$(CXX) $(RELEASE_FLAGS) -c $< -o $@

clean:
	rm -rf debug release

.PHONY: all debug release clean


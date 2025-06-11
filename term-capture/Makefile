CXX = g++
COMMON_FLAGS = -Wall -Wextra
DEBUG_FLAGS = $(COMMON_FLAGS) -g -O0 -DDEBUG
RELEASE_FLAGS = $(COMMON_FLAGS) -O2 -DNDEBUG
COVERAGE_FLAGS = $(COMMON_FLAGS) --coverage -O0 -DDEBUG # Add --coverage and keep debug-friendly flags

TARGETS = term-capture hexflow

all: debug release

debug: $(patsubst %,debug/%,$(TARGETS))

release: $(patsubst %,release/%,$(TARGETS))

coverage: $(patsubst %,coverage/%,$(TARGETS)) # New target for coverage builds

debug/%: debug/%.o
	$(CXX) $(DEBUG_FLAGS) $^ -o $@

release/%: release/%.o
	$(CXX) $(RELEASE_FLAGS) $^ -o $@

coverage/%: coverage/%.o # Rule for linking coverage executables
	$(CXX) $(COVERAGE_FLAGS) $^ -o $@

debug/%.o: %.cpp
	@mkdir -p debug
	$(CXX) $(DEBUG_FLAGS) -c $< -o $@

release/%.o: %.cpp
	@mkdir -p release
	$(CXX) $(RELEASE_FLAGS) -c $< -o $@

coverage/%.o: %.cpp # Rule for compiling .cpp to .o with coverage
	@mkdir -p coverage
	$(CXX) $(COVERAGE_FLAGS) -c $< -o $@

clean:
	rm -rf debug release coverage # Add coverage directory
	rm -f *.gcda *.gcno # Remove gcov data files from the root directory

.PHONY: all debug release coverage clean # Add coverage target


CXX = g++
COMMON_FLAGS = -Wall -Wextra
DEBUG_FLAGS = $(COMMON_FLAGS) -g -O0 -DDEBUG
RELEASE_FLAGS = $(COMMON_FLAGS) -O2 -DNDEBUG
COVERAGE_FLAGS = $(COMMON_FLAGS) --coverage -O0 -DDEBUG # Add --coverage and keep debug-friendly flags

TARGETS = term-capture hexflow

# Test configuration
TEST_DIR = tests
TEST_RUNNER_NAME = test_runner
TEST_EXECUTABLE = coverage/$(TEST_RUNNER_NAME)

# Source files for the test runner itself and specific test suites
TEST_SRC_FILES = $(TEST_DIR)/main.cpp \
                 $(TEST_DIR)/hexflow_tests.cpp
# TODO: Add term_capture_tests.cpp later

# Object files for the test sources
TEST_OBJ_FILES = $(TEST_SRC_FILES:%.cpp=coverage/%.o)

# Application object files needed for linking tests
APP_OBJ_FOR_TESTS = coverage/hexflow.o
# TODO: Add coverage/term-capture.o when term-capture tests are added

# Add include path for catch.hpp and use coverage flags for tests
TEST_COMPILE_FLAGS = $(COVERAGE_FLAGS) -I$(TEST_DIR)


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

# Rule to compile test source files
# Example: coverage/tests/main.o from tests/main.cpp
coverage/$(TEST_DIR)/%.o: $(TEST_DIR)/%.cpp $(TEST_DIR)/catch.hpp Makefile
	@mkdir -p $(@D)
	$(CXX) $(TEST_COMPILE_FLAGS) -c $< -o $@

# Rule to link the test runner
$(TEST_EXECUTABLE): $(TEST_OBJ_FILES) $(APP_OBJ_FOR_TESTS)
	@mkdir -p $(@D)
	$(CXX) $(COVERAGE_FLAGS) $^ -o $@

# Test target: build and run tests
test: $(TEST_EXECUTABLE)
	./$(TEST_EXECUTABLE)

clean:
	rm -rf debug release coverage # This also removes test objects and executables in coverage/
	rm -f *.gcda *.gcno # Remove gcov data files from the root directory (if any)

.PHONY: all debug release coverage clean test # Add test target


CXX = g++
COMMON_FLAGS = -Wall -Wextra -std=c++14 # Specify C++14 standard for Catch2 v3
DEBUG_FLAGS = $(COMMON_FLAGS) -g -O0 -DDEBUG
RELEASE_FLAGS = $(COMMON_FLAGS) -O2 -DNDEBUG
COVERAGE_FLAGS = $(COMMON_FLAGS) --coverage -O0 -DDEBUG # Add --coverage and keep debug-friendly flags

TARGETS = term-capture hexflow

# Test configuration
TEST_DIR = tests
TEST_RUNNER_NAME = test_runner
TEST_EXECUTABLE = coverage/$(TEST_RUNNER_NAME)

# Source files for the test runner itself and specific test suites
# main.cpp is removed as catch_amalgamated.cpp provides main() for Catch2 v3
TEST_SRC_FILES = $(TEST_DIR)/hexflow_tests.cpp \
                 $(TEST_DIR)/catch_amalgamated.cpp
# TODO: Add term_capture_tests.cpp later

# Object files for the test sources
# This pattern will generate coverage/tests/hexflow_tests.o and coverage/tests/catch_amalgamated.o
TEST_OBJ_FILES = $(patsubst $(TEST_DIR)/%.cpp,coverage/$(TEST_DIR)/%.o,$(TEST_SRC_FILES))

# Application object files needed for linking tests
# We'll use a special version of hexflow.o compiled without its main()
HEXFLOW_FOR_TEST_OBJ = coverage/hexflow_for_test.o
APP_OBJ_FOR_TESTS = $(HEXFLOW_FOR_TEST_OBJ)
# TODO: Add coverage/term-capture_for_test.o when term-capture tests are added

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

# Specific rules for objects that depend on hexflow.hpp
HEXFLOW_HPP = hexflow.hpp

debug/hexflow.o: hexflow.cpp $(HEXFLOW_HPP) Makefile
	@mkdir -p debug
	$(CXX) $(DEBUG_FLAGS) -c hexflow.cpp -o $@

release/hexflow.o: hexflow.cpp $(HEXFLOW_HPP) Makefile
	@mkdir -p release
	$(CXX) $(RELEASE_FLAGS) -c hexflow.cpp -o $@

coverage/hexflow.o: hexflow.cpp $(HEXFLOW_HPP) Makefile
	@mkdir -p coverage
	$(CXX) $(COVERAGE_FLAGS) -c hexflow.cpp -o $@

# Generic rules for other .o files (if any are added later that don't depend on hexflow.hpp)
debug/%.o: %.cpp Makefile
	@mkdir -p debug
	$(CXX) $(DEBUG_FLAGS) -c $< -o $@

release/%.o: %.cpp Makefile
	@mkdir -p release
	$(CXX) $(RELEASE_FLAGS) -c $< -o $@

coverage/%.o: %.cpp Makefile # Rule for compiling .cpp to .o with coverage
	@mkdir -p coverage
	$(CXX) $(COVERAGE_FLAGS) -c $< -o $@


# Rule to compile test source files (hexflow_tests.cpp)
coverage/$(TEST_DIR)/hexflow_tests.o: $(TEST_DIR)/hexflow_tests.cpp $(TEST_DIR)/catch_amalgamated.hpp $(HEXFLOW_HPP) Makefile
	@mkdir -p $(@D)
	$(CXX) $(TEST_COMPILE_FLAGS) -c $(TEST_DIR)/hexflow_tests.cpp -o $@

# Rule to compile catch_amalgamated.cpp
coverage/$(TEST_DIR)/catch_amalgamated.o: $(TEST_DIR)/catch_amalgamated.cpp $(TEST_DIR)/catch_amalgamated.hpp Makefile
	@mkdir -p $(@D)
	$(CXX) $(TEST_COMPILE_FLAGS) -c $(TEST_DIR)/catch_amalgamated.cpp -o $@

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


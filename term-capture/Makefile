CXX = g++
COMMON_FLAGS = -Wall -Wextra -std=c++14 # Specify C++14 standard for Catch2 v3
DEBUG_FLAGS = $(COMMON_FLAGS) -g -O0 -DDEBUG -fprofile-arcs -ftest-coverage # Use gcov-compatible coverage flags
RELEASE_FLAGS = $(COMMON_FLAGS) -O2 -DNDEBUG
# COVERAGE_FLAGS is removed

TARGETS = term-capture hexflow

# Test configuration
TEST_DIR = tests
TEST_RUNNER_NAME = test_runner
TEST_EXECUTABLE = debug/$(TEST_RUNNER_NAME) # Test executable now in debug/
COVERAGE_DIR = debug/coverage
GCOVR_OBJECT_DIR = debug
GCOVR_GCOV = $(shell command -v llvm-cov >/dev/null 2>&1 && echo "--gcov-executable=llvm-cov gcov" || echo "")
GCOVR_EXCLUDES = --exclude 'tests/.*' --exclude '.*catch_amalgamated.*'

# Source files for the test runner itself and specific test suites
# main.cpp is removed as catch_amalgamated.cpp provides main() for Catch2 v3
TEST_SRC_FILES = $(TEST_DIR)/hexflow_tests.cpp \
                 $(TEST_DIR)/term_capture_tests.cpp \
                 $(TEST_DIR)/catch_amalgamated.cpp

# Object files for the test sources
# This pattern will generate debug/tests/hexflow_tests.o etc.
TEST_OBJ_FILES = $(patsubst $(TEST_DIR)/%.cpp,debug/$(TEST_DIR)/%.o,$(TEST_SRC_FILES))

# Application object files needed for linking tests
# We'll use special versions of .o files compiled without their main()
HEXFLOW_FOR_TEST_OBJ = debug/hexflow_for_test.o # Object file in debug/
TERM_CAPTURE_FOR_TEST_OBJ = debug/term_capture_for_test.o # Object file in debug/
APP_OBJ_FOR_TESTS = $(HEXFLOW_FOR_TEST_OBJ) $(TERM_CAPTURE_FOR_TEST_OBJ)

# Add include path for catch.hpp and use debug (now with coverage) flags for tests
TEST_COMPILE_FLAGS = $(DEBUG_FLAGS) -I$(TEST_DIR)


all: debug release

debug: $(patsubst %,debug/%,$(TARGETS))

release: $(patsubst %,release/%,$(TARGETS))

# coverage target is removed

debug/%: debug/%.o
	$(CXX) $(DEBUG_FLAGS) $^ -o $@

release/%: release/%.o
	$(CXX) $(RELEASE_FLAGS) $^ -o $@

# coverage executable linking rule is removed

# Specific rules for objects that depend on .hpp files
HEXFLOW_HPP = hexflow.hpp
TERM_CAPTURE_HPP = term-capture.hpp

debug/hexflow.o: hexflow.cpp $(HEXFLOW_HPP) Makefile
	@mkdir -p debug
	$(CXX) $(DEBUG_FLAGS) -c hexflow.cpp -o $@

release/hexflow.o: hexflow.cpp $(HEXFLOW_HPP) Makefile
	@mkdir -p release
	$(CXX) $(RELEASE_FLAGS) -c hexflow.cpp -o $@

# coverage/hexflow.o rule removed

debug/term-capture.o: term-capture.cpp $(TERM_CAPTURE_HPP) Makefile
	@mkdir -p debug
	$(CXX) $(DEBUG_FLAGS) -c term-capture.cpp -o $@

release/term-capture.o: term-capture.cpp $(TERM_CAPTURE_HPP) Makefile
	@mkdir -p release
	$(CXX) $(RELEASE_FLAGS) -c term-capture.cpp -o $@

# coverage/term-capture.o rule removed


# Rule to compile test source files (hexflow_tests.cpp)
# Output directory changed to debug/
debug/$(TEST_DIR)/hexflow_tests.o: $(TEST_DIR)/hexflow_tests.cpp $(TEST_DIR)/catch_amalgamated.hpp $(HEXFLOW_HPP) Makefile
	@mkdir -p $(@D)
	$(CXX) $(TEST_COMPILE_FLAGS) -c $(TEST_DIR)/hexflow_tests.cpp -o $@

# Rule to compile term_capture_tests.cpp
# Output directory changed to debug/
debug/$(TEST_DIR)/term_capture_tests.o: $(TEST_DIR)/term_capture_tests.cpp $(TEST_DIR)/catch_amalgamated.hpp $(TERM_CAPTURE_HPP) Makefile
	@mkdir -p $(@D)
	$(CXX) $(TEST_COMPILE_FLAGS) -c $(TEST_DIR)/term_capture_tests.cpp -o $@

# Rule to compile catch_amalgamated.cpp
# Output directory changed to debug/
debug/$(TEST_DIR)/catch_amalgamated.o: $(TEST_DIR)/catch_amalgamated.cpp $(TEST_DIR)/catch_amalgamated.hpp Makefile
	@mkdir -p $(@D)
	$(CXX) $(TEST_COMPILE_FLAGS) -c $(TEST_DIR)/catch_amalgamated.cpp -o $@

# Rule to compile hexflow.cpp as a library for tests (without its main function)
# Output directory changed to debug/, uses DEBUG_FLAGS
$(HEXFLOW_FOR_TEST_OBJ): hexflow.cpp $(HEXFLOW_HPP) Makefile
	@mkdir -p $(@D)
	$(CXX) $(DEBUG_FLAGS) -DBUILD_HEXFLOW_AS_LIB -c hexflow.cpp -o $@

# Rule to compile term-capture.cpp as a library for tests (without its main function)
# Output directory changed to debug/, uses DEBUG_FLAGS
$(TERM_CAPTURE_FOR_TEST_OBJ): term-capture.cpp $(TERM_CAPTURE_HPP) Makefile
	@mkdir -p $(@D)
	$(CXX) $(DEBUG_FLAGS) -DBUILD_TERM_CAPTURE_AS_LIB -c term-capture.cpp -o $@

# Rule to link the test runner
# Uses DEBUG_FLAGS
$(TEST_EXECUTABLE): $(TEST_OBJ_FILES) $(APP_OBJ_FOR_TESTS)
	@mkdir -p $(@D)
	$(CXX) $(DEBUG_FLAGS) $^ -o $@

# Test target: build and run tests
# Pass extra flags to Catch2 with TEST_ARGS, e.g.:
#   make test TEST_ARGS="-s -v high --durations yes"
TEST_ARGS ?=
test: clean-coverage-data $(TEST_EXECUTABLE) debug/term-capture debug/hexflow
	./$(TEST_EXECUTABLE) $(TEST_ARGS)
	./debug/term-capture debug/coverage_smoke /bin/echo ok >/dev/null 2>/dev/null || true
	printf 'A' | ./debug/hexflow >/dev/null 2>/dev/null || true
	$(MAKE) coverage
	cat $(COVERAGE_DIR)/coverage.txt

# Convenience targets for richer output or machine-readable reports
test-verbose: $(TEST_EXECUTABLE)
	./$(TEST_EXECUTABLE) -s -v high --durations yes

test-json: $(TEST_EXECUTABLE)
	@mkdir -p debug
	./$(TEST_EXECUTABLE) -r JSON -o debug/test-results.json -s -v high

test-junit: $(TEST_EXECUTABLE)
	@mkdir -p debug
	./$(TEST_EXECUTABLE) -r junit -o debug/junit.xml -s

# Generate coverage reports (HTML + text summary) after tests
coverage:
	@mkdir -p $(COVERAGE_DIR)
	@sh -c 'command -v gcovr >/dev/null 2>&1 || { echo "gcovr not found. Install with: brew install gcovr (or pip install gcovr)"; exit 0; }'
	gcovr --root . $(GCOVR_EXCLUDES) --object-directory $(GCOVR_OBJECT_DIR) $(GCOVR_GCOV) --html --html-details -o $(COVERAGE_DIR)/index.html --gcov-ignore-errors=no_working_dir_found
	gcovr --root . $(GCOVR_EXCLUDES) --object-directory $(GCOVR_OBJECT_DIR) $(GCOVR_GCOV) --txt -o $(COVERAGE_DIR)/coverage.txt --txt-metric=branch --gcov-ignore-errors=no_working_dir_found
	gcovr --root . $(GCOVR_EXCLUDES) --object-directory $(GCOVR_OBJECT_DIR) $(GCOVR_GCOV) --xml -o $(COVERAGE_DIR)/coverage.xml --gcov-ignore-errors=no_working_dir_found
	gcovr --root . $(GCOVR_EXCLUDES) --object-directory $(GCOVR_OBJECT_DIR) $(GCOVR_GCOV) --json -o $(COVERAGE_DIR)/coverage.json --gcov-ignore-errors=no_working_dir_found

# Convenience: open the HTML coverage report on macOS
open-coverage: coverage
	open $(COVERAGE_DIR)/index.html

# Remove stale coverage data files to avoid gcov merge errors
clean-coverage-data:
	@find debug -name '*.gcda' -delete 2>/dev/null || true
	@find release -name '*.gcda' -delete 2>/dev/null || true

clean:
	rm -rf debug release # coverage directory removed from clean
	rm -f *.gcda *.gcno # Remove gcov data files from the root directory (if any)
	rm -f debug/*.gcda debug/*.gcno # Remove gcov data files from debug directory
	rm -f debug/tests/*.gcda debug/tests/*.gcno # Remove gcov data files from debug/tests directory


.PHONY: all debug release clean test test-verbose test-json test-junit coverage open-coverage clean-coverage-data # coverage target removed


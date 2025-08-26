CXX = g++
COMMON_FLAGS = -Wall -Wextra -std=c++14 # Specify C++14 standard for Catch2 v3
DEBUG_FLAGS = $(COMMON_FLAGS) -g -O0 -DDEBUG --coverage # Add --coverage to DEBUG_FLAGS
RELEASE_FLAGS = $(COMMON_FLAGS) -O2 -DNDEBUG
# COVERAGE_FLAGS is removed

TARGETS = term-capture hexflow

# Test configuration
TEST_DIR = tests
TEST_RUNNER_NAME = test_runner
TEST_EXECUTABLE = debug/$(TEST_RUNNER_NAME) # Test executable now in debug/

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
TEST_COMPILE_FLAGS = $(DEBUG_FLAGS) -I. -I$(TEST_DIR)


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
TERM_CAPTURE_HPP = term_capture.hpp

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
test: $(TEST_EXECUTABLE)
	./$(TEST_EXECUTABLE)

clean:
	rm -rf debug release # coverage directory removed from clean
	rm -f *.gcda *.gcno # Remove gcov data files from the root directory (if any)
	rm -f debug/*.gcda debug/*.gcno # Remove gcov data files from debug directory
	rm -f debug/tests/*.gcda debug/tests/*.gcno # Remove gcov data files from debug/tests directory


.PHONY: all debug release clean test # coverage target removed


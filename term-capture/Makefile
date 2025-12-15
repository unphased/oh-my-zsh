# Makefile overview
# - debug: builds debug binaries (with coverage flags) -> debug/term-capture, debug/hexflow
#           Includes debug symbols and coverage instrumentation; ideal for GDB/lldb and tests.
# - release: builds optimized binaries -> release/term-capture, release/hexflow
#            Lean: no debug symbols, no -DDEBUG, no coverage/test instrumentation.
# - test: builds and runs unit tests (Catch2 runner), then smoke-runs debug binaries,
#         then generates coverage reports. This target depends on debug builds.
# - coverage: generates HTML/TXT/XML/JSON coverage reports from debug build artifacts
# - open-coverage: opens the HTML coverage report (macOS)
# - clean: removes build artifacts
# - clean-coverage-data: removes stale .gcda files to avoid gcov merge errors
# - help: prints a summary of common targets
CXX = g++
COMMON_FLAGS = -Wall -Wextra -std=c++14 # Specify C++14 standard for Catch2 v3
DEBUG_FLAGS = $(COMMON_FLAGS) -g -O0 -DDEBUG -fprofile-arcs -ftest-coverage # Use gcov-compatible coverage flags
RELEASE_FLAGS = $(COMMON_FLAGS) -O2 -DNDEBUG # Lean release: no -g, no -DDEBUG, no coverage flags
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
                 $(TEST_DIR)/tcap_tests.cpp \
                 $(TEST_DIR)/select_link_tests.cpp \
                 $(TEST_DIR)/link_seam_tests.cpp \
                 $(TEST_DIR)/catch_amalgamated.cpp

# Object files for the test sources
# This pattern will generate debug/tests/hexflow_tests.o etc.
TEST_OBJ_FILES = $(patsubst $(TEST_DIR)/%.cpp,debug/$(TEST_DIR)/%.o,$(TEST_SRC_FILES))

UNAME_S := $(shell uname -s)
LDLIBS :=
ifeq ($(UNAME_S),Linux)
LDLIBS += -ldl
endif

# Application object files needed for linking tests
# We'll use special versions of .o files compiled without their main()
HEXFLOW_FOR_TEST_OBJ = debug/hexflow_for_test.o # Object file in debug/
TERM_CAPTURE_FOR_TEST_OBJ = debug/term_capture_for_test.o # Object file in debug/
APP_OBJ_FOR_TESTS = $(HEXFLOW_FOR_TEST_OBJ) $(TERM_CAPTURE_FOR_TEST_OBJ)

# Add include path for catch.hpp and use debug (now with coverage) flags for tests
TEST_COMPILE_FLAGS = $(DEBUG_FLAGS) -I$(TEST_DIR) -DBUILD_TERM_CAPTURE_AS_LIB


all: debug release

debug: $(patsubst %,debug/%,$(TARGETS))

release: $(patsubst %,release/%,$(TARGETS))

# coverage target is removed

debug/%: debug/%.o
	$(CXX) $(DEBUG_FLAGS) $^ $(LDLIBS) -o $@

release/%: release/%.o
	$(CXX) $(RELEASE_FLAGS) $^ $(LDLIBS) -o $@

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

# Rule to compile tcap_tests.cpp
debug/$(TEST_DIR)/tcap_tests.o: $(TEST_DIR)/tcap_tests.cpp $(TEST_DIR)/catch_amalgamated.hpp tcap.hpp Makefile
	@mkdir -p $(@D)
	$(CXX) $(TEST_COMPILE_FLAGS) -c $(TEST_DIR)/tcap_tests.cpp -o $@

debug/$(TEST_DIR)/link_seam_tests.o: $(TEST_DIR)/link_seam_tests.cpp $(TEST_DIR)/catch_amalgamated.hpp Makefile
	@mkdir -p $(@D)
	$(CXX) $(TEST_COMPILE_FLAGS) -c $(TEST_DIR)/link_seam_tests.cpp -o $@

debug/$(TEST_DIR)/select_link_tests.o: $(TEST_DIR)/select_link_tests.cpp $(TEST_DIR)/catch_amalgamated.hpp Makefile
	@mkdir -p $(@D)
	$(CXX) $(TEST_COMPILE_FLAGS) -c $(TEST_DIR)/select_link_tests.cpp -o $@

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
	$(CXX) $(DEBUG_FLAGS) $^ $(LDLIBS) -o $@

# Test targets
# Pass extra flags to Catch2 with TEST_ARGS, e.g.:
#   make test-lite TEST_ARGS="-s -v high --durations yes"
#   make test-json TEST_ARGS="--rng-seed 12345"
TEST_ARGS ?=
UNIT_FILTER ?= ~[integration]
INTEGRATION_FILTER ?= [integration]

# Full suite, console output only (no JSON/JUnit). This is the fastest path to
# populate coverage data for gcovr.
test-lite: clean-coverage-data $(TEST_EXECUTABLE) debug/term-capture debug/hexflow
	./$(TEST_EXECUTABLE) $(TEST_ARGS)

# Full suite, JSON report (single-run; no double-execution).
test-json: clean-coverage-data $(TEST_EXECUTABLE) debug/term-capture debug/hexflow
	@mkdir -p debug
	./$(TEST_EXECUTABLE) $(TEST_ARGS) -r JSON -s > debug/test-results.json

# Full suite, JUnit (single-run; kept for compatibility, but JSON is preferred).
test-junit: clean-coverage-data $(TEST_EXECUTABLE) debug/term-capture debug/hexflow
	@mkdir -p debug
	./$(TEST_EXECUTABLE) $(TEST_ARGS) -r junit -o debug/junit.xml -s

# Default: generate JSON report + coverage (smoke runs help coverage reach mains).
test: test-json
	$(MAKE) validate-reports
	./debug/term-capture debug/coverage_smoke /bin/echo ok >/dev/null 2>/dev/null || true
	printf 'A' | ./debug/hexflow >/dev/null 2>/dev/null || true
	$(MAKE) coverage
	cat $(COVERAGE_DIR)/coverage.txt

# Run only unit tests (exclude [integration] tagged tests)
test-unit: $(TEST_EXECUTABLE)
	./$(TEST_EXECUTABLE) $(TEST_ARGS) $(UNIT_FILTER)

# Run only integration tests (only [integration] tagged tests)
# Ensure the debug binaries exist because integration tests invoke them.
test-integration: $(TEST_EXECUTABLE) debug/term-capture debug/hexflow
	./$(TEST_EXECUTABLE) $(TEST_ARGS) $(INTEGRATION_FILTER)

# Convenience targets for richer output or machine-readable reports
test-verbose: $(TEST_EXECUTABLE)
	./$(TEST_EXECUTABLE) -s -v high --durations yes

# Verbose JSON (useful for debugging the report itself)
test-json-verbose: clean-coverage-data $(TEST_EXECUTABLE) debug/term-capture debug/hexflow
	@mkdir -p debug
	./$(TEST_EXECUTABLE) $(TEST_ARGS) -r JSON -s -v high > debug/test-results.json

# Generate coverage reports (HTML + text summary) after tests

coverage:
	@mkdir -p $(COVERAGE_DIR)
	@if ! command -v gcovr >/dev/null 2>&1; then \
		echo "gcovr not found. Install with: brew install gcovr (or pip install gcovr)"; \
		echo "gcovr not found. Coverage reports were skipped." > $(COVERAGE_DIR)/coverage.txt; \
	else \
		gcovr --root . $(GCOVR_EXCLUDES) --object-directory $(GCOVR_OBJECT_DIR) $(GCOVR_GCOV) --html --html-details -o $(COVERAGE_DIR)/index.html --gcov-ignore-errors=no_working_dir_found; \
		gcovr --root . $(GCOVR_EXCLUDES) --object-directory $(GCOVR_OBJECT_DIR) $(GCOVR_GCOV) --txt -o $(COVERAGE_DIR)/coverage.txt --txt-metric=branch --gcov-ignore-errors=no_working_dir_found; \
		gcovr --root . $(GCOVR_EXCLUDES) --object-directory $(GCOVR_OBJECT_DIR) $(GCOVR_GCOV) --xml -o $(COVERAGE_DIR)/coverage.xml --gcov-ignore-errors=no_working_dir_found; \
		gcovr --root . $(GCOVR_EXCLUDES) --object-directory $(GCOVR_OBJECT_DIR) $(GCOVR_GCOV) --json -o $(COVERAGE_DIR)/coverage.json --gcov-ignore-errors=no_working_dir_found; \
	fi

# Print the text coverage summary (generates it first if needed).
coverage-text: coverage
	@cat $(COVERAGE_DIR)/coverage.txt

# Convenience: open the HTML coverage report on macOS
open-coverage: test-lite coverage
	open $(COVERAGE_DIR)/index.html

# Dev helpers (macOS-oriented)
dev:
	python3 -m http.server 7878

test-open: test-json
	@echo "Opening: http://127.0.0.1:7878/web/test-report/"
	@echo "If it doesn't load, start the server first: make dev"
	open http://127.0.0.1:7878/web/test-report/

# Validate machine-readable test reports if tools are present
validate-reports:
	@sh -c '[ -f debug/test-results.json ] && command -v jq >/dev/null 2>&1 && jq -e . debug/test-results.json >/dev/null 2>&1 && echo "Validated JSON report: debug/test-results.json" || echo "Skipping JSON validation: missing debug/test-results.json or install jq (brew install jq)";'
	@sh -c '[ -f debug/junit.xml ] && command -v xmllint >/dev/null 2>&1 && xmllint --noout debug/junit.xml >/dev/null 2>&1 && echo "Validated JUnit XML: debug/junit.xml" || echo "Skipping JUnit XML validation: missing debug/junit.xml or install xmllint (libxml2)";'

# Human-friendly JUnit review helpers
junit-summary: test-junit
	@python3 tools/junit_summary.py debug/junit.xml

# Help: explain common targets and their relationships
help:
	@echo "Common targets:"
	@echo "  make            -> same as 'make all' (builds debug and release)"
	@echo "  make debug      -> build debug binaries (with coverage flags)"
	@echo "  make release    -> build release binaries (optimized)"
	@echo "  make test       -> run full suite once (JSON report), smoke-run debug mains,"
	@echo "                     then generate and print coverage summary"
	@echo "  make test-lite  -> run full suite (console only; fastest way to populate coverage data)"
	@echo "  make test-json  -> run full suite and write JSON to debug/test-results.json"
	@echo "  make test-unit  -> run only unit tests (exclude [integration] tagged tests)"
	@echo "  make test-integration -> run only [integration]-tagged tests"
	@echo "  make test-junit -> run tests and write JUnit XML to debug/junit.xml"
	@echo "  make junit-summary -> print a quick summary of debug/junit.xml"
	@echo "  make validate-reports -> sanity check JSON (jq) and XML (xmllint) if available"
	@echo "  make coverage   -> generate coverage reports from existing debug build artifacts"
	@echo "  make coverage-text -> print debug/coverage/coverage.txt"
	@echo "  make open-coverage -> open HTML coverage report (macOS)"
	@echo "  make dev        -> run python http.server on :7878"
	@echo "  make test-open  -> run tests (JSON) and open report UI"
	@echo "  make clean      -> remove build artifacts (debug/, release/)"
	@echo "  make clean-coverage-data -> remove stale coverage data files (*.gcda)"

# Remove stale coverage data files to avoid gcov merge errors
clean-coverage-data:
	@find debug -name '*.gcda' -delete 2>/dev/null || true
	@find release -name '*.gcda' -delete 2>/dev/null || true

clean:
	rm -rf debug release # coverage directory removed from clean
	rm -f *.gcda *.gcno # Remove gcov data files from the root directory (if any)
	rm -f debug/*.gcda debug/*.gcno # Remove gcov data files from debug directory
	rm -f debug/tests/*.gcda debug/tests/*.gcno # Remove gcov data files from debug/tests directory


.PHONY: all debug release clean test test-lite test-unit test-integration test-verbose test-json test-json-verbose test-junit junit-summary coverage coverage-text open-coverage dev test-open clean-coverage-data validate-reports help # coverage target removed

# WORKLOG - term-capture & hexflow

## Planned Work

### Goal: Enhance `term-capture` for robust, regular use and add advanced features.

**0. Test System & Coverage Establishment (Top Priority)**
    - [X] **Set up Test Framework:** Migrated to Catch2 v3 (amalgamated). User to download `catch_amalgamated.hpp` and `catch_amalgamated.cpp` to `tests/`. Removed `tests/main.cpp`. Makefile updated for C++14 and new Catch2 files.
    - [ ] **Develop Initial Test Suite:** Create basic tests covering core functionality:
        - [X] `term-capture`: Refactored argument parsing into `parse_arguments` function and `Config` struct. Added `term_capture.hpp`. Added unit tests for `parse_arguments` in `tests/term_capture_tests.cpp`. Makefile updated for new header and dependencies.
        - [X] `hexflow`: Refactored `print_byte` for testability and added comprehensive unit tests in `tests/hexflow_tests.cpp`.
    - [X] **Integrate Coverage Reporting (Makefile):** Configured Makefile to compile test files with coverage flags. Added `test` target to build and run tests. Linked `hexflow.o` and `term_capture.o` (compiled as libs with coverage) into test runner. Makefile updated for `hexflow.hpp`, `term_capture.hpp` and `term_capture.cpp` test compilation.
    - [ ] **Generate Coverage Reports (gcov/lcov):** Add Makefile targets or scripts to generate and view coverage reports (e.g., using `gcov` and `lcov` to produce HTML reports).
    - [ ] **General Hardening (Continuous through Testing):** Conduct thorough testing across various shells, commands, and edge cases (e.g., rapid window resizing, unusual signal patterns, PTY exhaustion, different TERM values) to identify and fix stability issues. This will be driven by the test suite.
    - [ ] **Iteratively Increase Coverage:** Continuously write and refine tests to achieve high code coverage for `term-capture.cpp` and `hexflow.cpp`.

**1. Core Robustness & Usability Enhancements (Post-Test Setup):**
    - [ ] **Exit Code Propagation:** Modify `term-capture` to correctly propagate the exit status of the wrapped command/shell, instead of always exiting with 0.
    - [ ] **Configurable Logging Levels/Verbosity:**
        - [ ] Allow suppression or redirection of `term-capture`'s own startup/shutdown messages (e.g., via command-line flags or environment variables).
    - [ ] **Improved Signal Handling:** Review and enhance signal handling for robustness, ensuring all relevant signals are managed gracefully (e.g., SIGHUP), informed by test cases.

**2. Log Management & Storage:**
    - [ ] **Log Rotation & Archival:** Implement a strategy for automatic log rotation (e.g., based on size or time) and potential archival to prevent excessive disk usage.
    - [ ] **Configurable Log Paths:** Allow users to specify log file naming patterns or directories more flexibly (e.g., including timestamps, session IDs, or user-defined structures).
    - [ ] **Disk Access Optimization:** Investigate methods to reduce the frequency of disk writes for log files, potentially by buffering more data in memory before flushing, while considering data loss risk on crash.

**3. Performance & Resource Control for Large Output:**
    - [ ] **High Data Rate Throttling Mechanism:**
        - [ ] Implement logic to monitor data ingress (e.g., from the child PTY to `term-capture`) at regular intervals (e.g., 1/30th of a second).
        - [ ] Define a configurable data rate threshold (e.g., 3MB/s) for these intervals.
        - [ ] If the threshold is exceeded for a configurable number of consecutive intervals (e.g., `N` intervals):
            - [ ] Implement a "boundary retention" strategy: Keep the data from the first `M` and last `M` intervals of this high-rate sequence (where `M` is a configurable integer, e.g., 2).
            - [ ] Discard the data from the intervening `N - 2*M` intervals to save disk space, while aiming to preserve context (like escape sequences for entering/exiting modes).
            - [ ] Log an indicator that data was throttled/dropped.
    - [ ] **Configuration for Throttling:** Provide command-line options or a configuration file mechanism to enable/disable throttling and adjust its parameters (interval duration, rate threshold, `N`, `M`).

**4. Advanced Features:**
    - [ ] **Session Playback Functionality:**
        - [ ] Design and develop a companion tool or mode for `term-capture` logs that allows replaying a captured session in a terminal.
        - [ ] Consider timing aspects to make playback realistic.
        - [ ] Explore integration or compatibility with `tmux`-like features for enhanced playback control (e.g., pause, step, speed control).
        - [ ] This might involve storing timing information alongside the raw input/output streams or developing a format that can accommodate this.
    - [ ] **Structured Logging Format (Optional Enhancement):**
        - [ ] Consider an alternative or additional log format (e.g., JSON-based) that includes timestamps for each chunk of data, stream identifiers (input/output), and metadata about events like window resizing or throttling. This could facilitate more advanced analysis and playback.

**5. Documentation & Build System:**
    - [ ] **Update README:** Keep README.md updated with new features, configuration options, and usage examples.
    - [ ] **Makefile Enhancements:** Review Makefile for any necessary updates as new source files or dependencies are added (e.g., for test framework, coverage report generation).

## In Progress

- (None currently)

## Completed

- (None tracked here yet, initial README created under e411c0a)

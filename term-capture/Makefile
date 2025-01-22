CXX = g++
COMMON_FLAGS = -Wall -Wextra
DEBUG_FLAGS = $(COMMON_FLAGS) -g -O0 -DDEBUG
RELEASE_FLAGS = $(COMMON_FLAGS) -O2 -DNDEBUG

TARGETS = term-capture hexflow
TERM_CAPTURE_SRC = term-capture.cpp
HEXFLOW_SRC = hexflow.cpp

DEBUG_DIR = debug
RELEASE_DIR = release

all: debug release

debug: $(DEBUG_DIR) $(addprefix $(DEBUG_DIR)/, $(TARGETS))
release: $(RELEASE_DIR) $(addprefix $(RELEASE_DIR)/, $(TARGETS))

$(DEBUG_DIR):
	mkdir -p $(DEBUG_DIR)

$(RELEASE_DIR):
	mkdir -p $(RELEASE_DIR)

$(DEBUG_DIR)/term-capture: $(TERM_CAPTURE_SRC)
	$(CXX) $(DEBUG_FLAGS) $< -o $@

$(DEBUG_DIR)/hexflow: $(HEXFLOW_SRC)
	$(CXX) $(DEBUG_FLAGS) $< -o $@

$(RELEASE_DIR)/term-capture: $(TERM_CAPTURE_SRC)
	$(CXX) $(RELEASE_FLAGS) $< -o $@

$(RELEASE_DIR)/hexflow: $(HEXFLOW_SRC)
	$(CXX) $(RELEASE_FLAGS) $< -o $@

clean:
	rm -rf $(DEBUG_DIR) $(RELEASE_DIR)

.PHONY: all debug release clean


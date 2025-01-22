CXX = g++
COMMON_FLAGS = -Wall -Wextra
DEBUG_FLAGS = $(COMMON_FLAGS) -g -O0 -DDEBUG
RELEASE_FLAGS = $(COMMON_FLAGS) -O2 -DNDEBUG

TARGETS = term-capture hexflow
TERM_CAPTURE_SRC = term-capture.cpp
HEXFLOW_SRC = hexflow.cpp

DEBUG_DIR = debug
RELEASE_DIR = release

DEBUG_OBJS = $(DEBUG_DIR)/term-capture.o $(DEBUG_DIR)/hexflow.o
RELEASE_OBJS = $(RELEASE_DIR)/term-capture.o $(RELEASE_DIR)/hexflow.o

all: debug release

debug: | $(DEBUG_DIR)
	$(MAKE) $(addprefix $(DEBUG_DIR)/, $(TARGETS))

release: | $(RELEASE_DIR)
	$(MAKE) $(addprefix $(RELEASE_DIR)/, $(TARGETS))

$(DEBUG_DIR):
	mkdir -p $(DEBUG_DIR)

$(RELEASE_DIR):
	mkdir -p $(RELEASE_DIR)

$(DEBUG_DIR)/%.o: %.cpp
	$(CXX) $(DEBUG_FLAGS) -c $< -o $@

$(RELEASE_DIR)/%.o: %.cpp
	$(CXX) $(RELEASE_FLAGS) -c $< -o $@

$(DEBUG_DIR)/term-capture: $(DEBUG_DIR)/term-capture.o
	$(CXX) $< -o $@

$(DEBUG_DIR)/hexflow: $(DEBUG_DIR)/hexflow.o
	$(CXX) $< -o $@

$(RELEASE_DIR)/term-capture: $(RELEASE_DIR)/term-capture.o
	$(CXX) $< -o $@

$(RELEASE_DIR)/hexflow: $(RELEASE_DIR)/hexflow.o
	$(CXX) $< -o $@

clean:
	rm -rf $(DEBUG_DIR) $(RELEASE_DIR)

.PHONY: all debug release clean


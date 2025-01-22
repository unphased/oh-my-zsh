CXX = g++
COMMON_FLAGS = -Wall -Wextra
DEBUG_FLAGS = $(COMMON_FLAGS) -g -O0 -DDEBUG
RELEASE_FLAGS = $(COMMON_FLAGS) -O2 -DNDEBUG

TARGETS = term-capture hexflow
BUILD_DIRS = debug release

all: debug release

debug: | debug
	$(MAKE) $(addprefix debug/, $(TARGETS))

release: | release
	$(MAKE) $(addprefix release/, $(TARGETS))

$(BUILD_DIRS):
	mkdir -p $@

debug/%.o: %.cpp | debug
	$(CXX) $(DEBUG_FLAGS) -c $< -o $@

release/%.o: %.cpp | release
	$(CXX) $(RELEASE_FLAGS) -c $< -o $@

debug/%: debug/%.o
	$(CXX) $< -o $@

release/%: release/%.o
	$(CXX) $< -o $@

clean:
	rm -rf $(BUILD_DIRS)

.PHONY: all debug release clean


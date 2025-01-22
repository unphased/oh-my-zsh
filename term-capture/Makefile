CXX = g++
COMMON_FLAGS = -Wall -Wextra
DEBUG_FLAGS = $(COMMON_FLAGS) -g -O0 -DDEBUG
RELEASE_FLAGS = $(COMMON_FLAGS) -O2 -DNDEBUG

TARGETS = term-capture hexflow
BUILD_DIRS = debug release

all: debug release

debug release: | %
	$(MAKE) $(addprefix $@/, $(TARGETS))

$(BUILD_DIRS):
	mkdir -p $@

%/%.o: %.cpp | %
	$(CXX) $($(shell echo $(@D) | tr a-z A-Z)_FLAGS) -c $< -o $@

%/term-capture %/hexflow: %/%.o
	$(CXX) $< -o $@

clean:
	rm -rf $(BUILD_DIRS)

.PHONY: all debug release clean


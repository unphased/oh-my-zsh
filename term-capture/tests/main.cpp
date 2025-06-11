#define CATCH_CONFIG_RUNNER
#include "catch.hpp"

int main(int argc, char* argv[]) {
    // Global setup can go here
    int result = Catch::Session().run(argc, argv);
    // Global cleanup can go here
    return result;
}

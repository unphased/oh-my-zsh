#include "catch_amalgamated.hpp" // Using Catch2 v3 amalgamated header
#include "term_capture.hpp"   // Include the header for term_capture
#include <vector>
#include <string>

TEST_CASE("TermCapture Argument Parsing", "[term_capture][args]") {
    SECTION("Only prefix provided") {
        char* argv[] = {const_cast<char*>("term-capture"), const_cast<char*>("my_log_prefix")};
        int argc = sizeof(argv) / sizeof(char*);
        Config config = parse_arguments(argc, argv);

        REQUIRE(config.valid);
        REQUIRE(config.log_prefix == "my_log_prefix");
        REQUIRE(config.command_and_args.empty());
        REQUIRE(config.error_message.empty());
    }

    SECTION("Prefix and simple command provided") {
        char* argv[] = {const_cast<char*>("term-capture"), const_cast<char*>("session1"), const_cast<char*>("ls")};
        int argc = sizeof(argv) / sizeof(char*);
        Config config = parse_arguments(argc, argv);

        REQUIRE(config.valid);
        REQUIRE(config.log_prefix == "session1");
        REQUIRE(config.command_and_args.size() == 1);
        REQUIRE(config.command_and_args[0] == "ls");
        REQUIRE(config.error_message.empty());
    }

    SECTION("Prefix, command, and arguments provided") {
        char* argv[] = {
            const_cast<char*>("term-capture"), 
            const_cast<char*>("session2"), 
            const_cast<char*>("grep"), 
            const_cast<char*>("pattern"), 
            const_cast<char*>("file.txt")
        };
        int argc = sizeof(argv) / sizeof(char*);
        Config config = parse_arguments(argc, argv);

        REQUIRE(config.valid);
        REQUIRE(config.log_prefix == "session2");
        REQUIRE(config.command_and_args.size() == 3);
        REQUIRE(config.command_and_args[0] == "grep");
        REQUIRE(config.command_and_args[1] == "pattern");
        REQUIRE(config.command_and_args[2] == "file.txt");
        REQUIRE(config.error_message.empty());
    }

    SECTION("Insufficient arguments (no prefix)") {
        char* argv[] = {const_cast<char*>("term-capture")};
        int argc = sizeof(argv) / sizeof(char*);
        Config config = parse_arguments(argc, argv);

        REQUIRE_FALSE(config.valid);
        REQUIRE_FALSE(config.error_message.empty());
        // Optionally, check parts of the error message
        REQUIRE(config.error_message.find("Usage: term-capture <prefix>") != std::string::npos);
    }
    
    SECTION("Insufficient arguments (argc is 0 - highly unlikely but good to cover)") {
        char* argv[] = {const_cast<char*>("term-capture")}; // argv[0] is program name
        int argc = 0; // Simulate no arguments at all
        Config config = parse_arguments(argc, argv);

        REQUIRE_FALSE(config.valid);
        REQUIRE_FALSE(config.error_message.empty());
    }

    SECTION("Insufficient arguments (argc is 1, only program name)") {
        char* argv[] = {const_cast<char*>("term-capture")};
        int argc = 1;
        Config config = parse_arguments(argc, argv);

        REQUIRE_FALSE(config.valid);
        REQUIRE_FALSE(config.error_message.empty());
    }
}

// Placeholder for future tests
TEST_CASE("TermCapture PTY Logic (Placeholder)", "[term_capture][pty]") {
    REQUIRE(true);
}

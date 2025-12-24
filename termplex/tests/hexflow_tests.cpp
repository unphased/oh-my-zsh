#include "catch_amalgamated.hpp" // Using Catch2 v3 amalgamated header
#include "../hexflow.hpp" // Include the header for print_byte (from parent dir)
#include <sstream>     // For std::stringstream to capture output

// Validate the formatting logic for individual bytes written by hexflow.
TEST_CASE("Hexflow print_byte functionality", "[hexflow]") {
    std::stringstream ss;
    bool test_last_was_nonprint; // State variable for tests

    // Helper to reset state for each section
    auto reset_state = [&]() {
        ss.str(""); // Clear the stringstream
        ss.clear(); // Clear any error flags on the stream
        test_last_was_nonprint = false; // Reset state
    };

    SECTION("Printable character") {
        reset_state();
        print_byte('A', ss, test_last_was_nonprint);
        REQUIRE(ss.str() == "A");
        REQUIRE_FALSE(test_last_was_nonprint);
    }

    SECTION("Non-printable character (e.g., SOH 0x01)") {
        reset_state();
        print_byte(0x01, ss, test_last_was_nonprint);
        REQUIRE(ss.str() == " 01"); // Note leading space for hex
        REQUIRE(test_last_was_nonprint);
    }

    SECTION("Newline character") {
        reset_state();
        print_byte('\n', ss, test_last_was_nonprint);
        REQUIRE(ss.str() == " \\n");
        REQUIRE(test_last_was_nonprint); // Newline is treated as non-print for state
    }

    SECTION("Carriage return character") {
        reset_state();
        print_byte('\r', ss, test_last_was_nonprint);
        REQUIRE(ss.str() == " \\r");
        REQUIRE(test_last_was_nonprint);
    }

    SECTION("Tab character") {
        reset_state();
        print_byte('\t', ss, test_last_was_nonprint);
        REQUIRE(ss.str() == " \\t");
        REQUIRE(test_last_was_nonprint);
    }

    SECTION("Transition from non-printable to printable") {
        reset_state();
        // First, a non-printable
        print_byte(0x02, ss, test_last_was_nonprint); // Outputs " 02"
        REQUIRE(ss.str() == " 02");
        REQUIRE(test_last_was_nonprint); // State is now true

        // Then, a printable
        ss.str(""); // Clear for next char's output
        print_byte('B', ss, test_last_was_nonprint);
        REQUIRE(ss.str() == " B"); // Space added due to transition
        REQUIRE_FALSE(test_last_was_nonprint);
    }

    SECTION("Transition from printable to non-printable") {
        reset_state();
        // First, a printable
        print_byte('C', ss, test_last_was_nonprint); // Outputs "C"
        REQUIRE(ss.str() == "C");
        REQUIRE_FALSE(test_last_was_nonprint); // State is now false

        // Then, a non-printable
        ss.str(""); // Clear for next char's output
        print_byte(0x03, ss, test_last_was_nonprint);
        REQUIRE(ss.str() == " 03"); // No extra space from transition, just the one for hex
        REQUIRE(test_last_was_nonprint);
    }
    
    SECTION("Consecutive printable characters") {
        reset_state();
        print_byte('X', ss, test_last_was_nonprint);
        REQUIRE(ss.str() == "X");
        REQUIRE_FALSE(test_last_was_nonprint);
        
        ss.str(""); // Clear for next char
        print_byte('Y', ss, test_last_was_nonprint);
        REQUIRE(ss.str() == "Y"); // No leading space
        REQUIRE_FALSE(test_last_was_nonprint);
    }

    SECTION("Consecutive non-printable characters (different types)") {
        reset_state();
        print_byte(0x0A, ss, test_last_was_nonprint); // This is \n, will print " \n"
        REQUIRE(ss.str() == " \\n");
        REQUIRE(test_last_was_nonprint);
        
        ss.str(""); // Clear for next char
        print_byte(0x0B, ss, test_last_was_nonprint); // Vertical Tab (0x0b)
        REQUIRE(ss.str() == " 0b"); // Note: space before hex, no *additional* space from transition logic
        REQUIRE(test_last_was_nonprint);
    }

    SECTION("Hex value formatting (ensure leading zero for single digit hex)") {
        reset_state();
        print_byte(0x0F, ss, test_last_was_nonprint);
        REQUIRE(ss.str() == " 0f");
        REQUIRE(test_last_was_nonprint);
    }
}

#!/bin/bash
# Wrapper that runs a test command and treats exit code 77 (skip) as success.
# Exit 77 = ABI mismatch skip (GNU convention), exit 0 = pass, exit 1 = fail.
# Usage: tests/run-test.sh npm run test:integration-happy

"$@"
exit_code=$?

if [ "$exit_code" -eq 77 ]; then
  echo "  ⏭ Skipped (ABI mismatch)"
  exit 0
fi

exit "$exit_code"

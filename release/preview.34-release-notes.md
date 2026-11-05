# Happy Friday Lite 3.0.7.01-preview.34

This Windows x64 preview includes a repair to the Office AI tool-call stream bridge. It sends a bounded output-token budget, handles both incremental and cumulative tool-argument deltas, and reports provider length cutoffs as truncated tool calls. Local stream, authentication, provider parameter-error, interruption, build, and packaged startup checks passed.

**Validation limit:** the original 22-page PDF and live model configuration have not yet completed an end-to-end regression. Treat this as a test candidate; it does not establish that the reported live-model failure is fully resolved. The installer is unsigned.

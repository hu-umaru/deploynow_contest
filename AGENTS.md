# Development notes

- This is Quantum Beat Studio, a static browser app for the Deploy Now contest.
- Read README.md and docs/architecture.md before changing measurement semantics.
- Keep the runtime free of API keys, paid services and remote audio/font dependencies.
- Five qubits, q0 as internal least-significant bit, display strings in q0→q4 order.
- Always sample the joint state distribution. Never sample qubit marginals independently.
- Every gate column is one beat and ends in a joint projective measurement (16 per loop).
- Hand-drawn mode carries measured basis outcomes to the next column; reset at bar start.
- Score mode prepares the source note mask with X at EVERY column, then applies remix gates.
- INT=H-Rz-H and PAIR=H-CNOT are within-column composites, measured only after completion.
- Never claim separated H gates interfere across measurements, or that Rz alone changes these probabilities.
- Source imports: uncompressed partwise MusicXML, first 16 quarter-note beats, no PDF/OCR/MXL/MIDI.
- Distinguish source quantization/polyphony reduction from changes caused by quantum gates.
- Schema v2 has optional source notes and 16 frozen outcomes; v1 migration clears 4 old outcomes.
- Keep quantum logic and musical mapping independent of DOM/audio APIs.
- Use npm run check, npm test and npm run build for logic changes; browser workflow for UI/audio changes.
- Do not commit dist/, test-results/, node_modules/, or secrets.
- GitHub Actions builds and tests; production hosting is Lolipop Deploy Now, static framework.
- Do not invent successful browser, audio quality, deployment or contest-submission verification.

# Development notes

- This is Quantum Beat Studio, a static browser app for the Deploy Now contest.
- Read README.md and docs/architecture.md before changing measurement semantics.
- Keep the runtime free of API keys, paid services and remote audio/font dependencies.
- Five qubits, q0 as internal least-significant bit, display strings in q0→q4 order.
- Always sample the joint state distribution. Never sample qubit marginals independently.
- Bar circuits start at |00000⟩ and are measured once per bar, before musical playback.
- Keep quantum logic and musical mapping independent of DOM/audio APIs.
- Use npm run check, npm test and npm run build for logic changes; browser workflow for UI/audio changes.
- Do not commit dist/, test-results/, node_modules/, or secrets.
- GitHub Actions builds and tests; production hosting is Lolipop Deploy Now, static framework.
- Do not invent successful browser, audio quality, deployment or contest-submission verification.

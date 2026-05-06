# Angry Oracle Code-Change Process Diagram

```mermaid
flowchart TD
    A[Start /call request] --> B[Map project context and quality gates]
    B --> C[Implement with TDD or targeted verification as appropriate]
    C --> D[Inventory git changes]
    D --> E[Run verification commands]
    E --> F{Running-app manual verification applicable?}
    F -- Yes --> G[Run openforge-app-operator skill]
    F -- No --> H[Record manual verification skip rationale]
    G --> I[Angry principal engineer code + architecture review]
    H --> I
    I --> J{Approved, no required fixes, and score >= target?}
    J -- Yes --> K[Complete successfully]
    J -- No --> L{Iterations remaining?}
    L -- Yes --> M[Fix oracle blockers and required feedback]
    M --> D
    L -- No --> N[Manual breakpoint with oracle feedback]
    N --> O[Complete as not approved unless user takes over]
```

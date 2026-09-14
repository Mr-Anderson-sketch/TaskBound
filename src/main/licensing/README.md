# Licensing seam

Everything about licensing lives in this folder. `getLicenseStatus()` is the only export the rest of the app may import. It returns `{ tier: "free" }` until the owner approves a licensing approach (see docs/TODOS.md).

# InBetween Mapping

Welcome to the **InBetween Mapping** project repository.

---

## 📁 Project Structure

```text
InBetween Mapping/
├── Assets/       # Media, assets, textures, and static resources
├── Scripts/      # Source code files separated by feature and responsibility
├── Styles/       # Styling, theme definitions, and presentation rules
├── Values/       # Global constants, settings, and accessible configuration variables
└── README.md     # Project guidelines and documentation
```

---

## 🛠️ Development & Architecture Guidelines

To keep the codebase maintainable, readable, and scalable, please follow these core rules:

### 1. Great Code Structure & Organization
- Maintain a clean and modular code architecture.
- Keep components loosely coupled and follow the **Single Responsibility Principle (SRP)**.
- Document logic clearly and keep naming conventions consistent throughout the codebase.

### 2. Separate Functionalities into Different Files
- **Do not write monolithic files.**
- Each distinct feature, service, or functionality must reside in its own dedicated file (e.g., inside the `Scripts/` folder or relevant subdirectories).
- Break large modules into smaller, reusable helper functions or classes across separate files.

### 3. Centralize Accessible Variables in the `Values/` Folder
- All configurable variables, tuneable parameters, game/app settings, and global constants that need to be accessed or adjusted must be stored in files inside the **`Values/`** directory.
- Avoid hardcoding values directly within logic scripts.
- Expose values cleanly (e.g., config files, constants modules) so they can be easily reviewed, updated, and referenced across the project.


# Eoin's Building Game

Eoin's Building Game is a browser-based 3D building sandbox inspired by games like Minecraft, built with [Three.js](https://threejs.org/). Place, remove, and explore blocks in a procedurally generated world. The game runs entirely in your browser—no installation required!

## Features

- 3D block world rendered with Three.js
- Place and remove blocks freely
- Save and load your world (export/import as JSON)
- Simple first-person controls (WASD + mouse)
- Pause menu and options (in progress)
- Responsive UI and modern design

## Getting Started

### Prerequisites

- A modern web browser (Chrome, Firefox, Edge, Safari)

### Running the Game

1. Clone or download this repository.
2. Open `index.html` in your web browser.
3. Start building!

> **Tip:** If you open the game locally and see issues with loading modules, try running a simple local server (see below).

#### Running a Local Server (Optional)

If you have Python installed, you can run:

```bash
python3 -m http.server
```

Then open [http://localhost:8000](http://localhost:8000) in your browser.

## Controls

- **WASD**: Move
- **Mouse**: Look around
- **Left Click**: Place block
- **Right Click**: Remove block
- **Space**: Jump
- **Esc**: Pause menu

## Exporting & Importing Worlds

- Use the in-game menu to export your world as a `.json` file.
- Import a previously saved world using the import option.

## License

This project is licensed under the MIT License. See `LICENSE` for details.

# Geoguessr Trainer

A training tool for Geoguessr that helps you systematically learn regions using a chess-like grid system and Obsidian flashcards.

## Features

- Divides countries into 8x8 chess-like grids (A1-H8)
- Tracks your learning progress for each cell (untouched, learning, mastered)
- Creates markdown flashcards compatible with Obsidian's spaced repetition plugin
- Visualizes your progress on an interactive map
- Estimates completion date based on your progress

## Setup and Installation

### Prerequisites

- [Node.js](https://nodejs.org/) (v12 or higher)
- [npm](https://www.npmjs.com/) (comes with Node.js)
- [Obsidian](https://obsidian.md/) with the [Spaced Repetition plugin](https://github.com/st3v3nmw/obsidian-spaced-repetition)

### Installation

1. Clone or download this repository
2. Open a terminal in the project directory
3. Install dependencies:
   ```
   npm install
   ```

### Configuration

1. Open `server.js` and update the `OBSIDIAN_PATH` variable to point to your Obsidian vault's Geoguessr regions folder:
   ```javascript
   const OBSIDIAN_PATH = '/path/to/your/obsidian/vault/Projects/Geoguessr/Regions';
   ```

## Running the Application

1. Start the server:
   ```
   npm start
   ```
   This will start the server on port 3001.

2. Open your browser and navigate to:
   ```
   http://localhost:3001/
   ```

3. The application will automatically load any existing flashcards from your Obsidian vault.

## Usage

### Basic Workflow

1. Select a country from the dropdown menu
2. Click on a grid cell on the map or in the sidebar
3. Click "Create/View Flashcard" to generate a flashcard for that region
4. Take screenshots in Google Street View for that region and add them to the flashcard
5. Mark cells as "Learning" when you start studying them
6. Mark cells as "Mastered" when you can consistently identify them

### Flashcard Format

Flashcards are saved as markdown files in your Obsidian vault with the following structure:
```
#flash-geo/regions/country-name/A1 #status/learning
![Screenshot of the region]
?
Country Name A1
```

### Tips

- Focus on one country at a time
- Start with distinctive regions
- Add multiple screenshots to each flashcard
- Review your flashcards regularly using Obsidian's spaced repetition

## Troubleshooting

- **Server won't start**: Check if port 3001 is already in use. If so, change the port in `server.js` and update all fetch URLs in the HTML file.
- **Can't connect to server**: Make sure the server is running and check browser console for errors.
- **Flashcards not loading**: Verify the `OBSIDIAN_PATH` is correct and the directory exists.

## License

This project is open source and available under the MIT License. 
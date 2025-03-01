# Geoguessr Trainer

A training tool for Geoguessr that helps you systematically learn regions using natural geographic regions based on Street View coverage data or a traditional chess-like grid system. Integrates with Obsidian for flashcard-based learning.

## Features

- **Two Region Systems:**
  - **Chess Grid:** Divides countries into 8x8 chess-like grids (A1-H8)
  - **Natural Regions:** Creates organic regions based on Street View coverage clustering
- Tracks your learning progress for each region (untouched, learning, mastered)
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

### Using Natural Regions

To use the natural regions mode:

1. Navigate to:
   ```
   http://localhost:3001/natural-regions.html
   ```

2. Generate region data for a country:
   ```
   node src/create-regions.js russia
   ```

   This will process the Street View data and create approximately 32 natural regions.

   Additional options:
   ```
   node src/create-regions.js russia --regions 48
   node src/create-regions.js russia --koppen 0p5 --use-years
   ```

3. Once regions are generated, they will appear on the map and in the sidebar grid.

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

## Advanced Features

### Köppen Climate Data Integration

The application can use Köppen-Geiger climate classification data to create more meaningful regions:

1. The `map_data` directory contains Köppen-Geiger data at different resolutions:
   - `koppen_geiger_0p00833333.tif` (highest resolution)
   - `koppen_geiger_0p1.tif`
   - `koppen_geiger_0p5.tif` (recommended)
   - `koppen_geiger_1p0.tif` (lowest resolution)

2. When generating regions, include the `--koppen` flag:
   ```
   node src/create-regions.js russia --koppen 0p5
   ```

3. This will create regions that respect climate boundaries, making them more geographically meaningful.

> Note: The Köppen data support requires GDAL to be installed on your system. If not available, the regions will still be generated but without climate data integration.

## Troubleshooting

- **Server won't start**: Check if port 3001 is already in use. If so, change the port in `server.js` and update all fetch URLs in the HTML file.
- **Can't connect to server**: Make sure the server is running and check browser console for errors.
- **Flashcards not loading**: Verify the `OBSIDIAN_PATH` is correct and the directory exists.
- **Region generation fails**: Ensure that the country's Street View data is in the `map_data` directory. For Köppen integration, ensure GDAL is installed.

## License

This project is open source and available under the MIT License. 
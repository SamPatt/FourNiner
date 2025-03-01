# FourNiner - Natural Regions for Geoguessr Training

## Overview

This implementation adds a new "Natural Regions" mode to the Geoguessr training app, using GeoJSON Street View coordinate data to create organic geographical regions instead of a fixed chess-like grid. The regions follow the actual distribution of Street View coverage, making them more relevant for Geoguessr training.

## Features Implemented

1. **GeoJSON Data Processing**
   - Processing of Street View coordinate data in GeoJSON format
   - Clustering coordinates into meaningful geographic regions
   - Configurable number of regions per country (20-64)

2. **Natural Region Generation**
   - Spatial clustering using DBSCAN algorithm
   - Balancing region sizes by merging and splitting clusters
   - Creating convex hulls to define region boundaries

3. **User Interface**
   - New "Natural Regions" view alongside the existing chess grid
   - Display of organic region shapes on the interactive map
   - Sidebar with region overview and progress tracking

4. **Köppen Climate Data Integration**
   - Support for incorporating climate zones in region definitions
   - Makes regions more geographically meaningful
   - Custom Köppen-Geiger data processor

5. **Command-line Tools**
   - Simple CLI for generating regions for any country
   - Configurable options for region count, climate integration, etc.

## How to Use

1. **Generate Regions for a Country**
   ```bash
   node src/create-regions.js russia
   ```

   Additional options:
   ```bash
   node src/create-regions.js russia --regions 48
   node src/create-regions.js russia --koppen 0p5 --use-years
   ```

2. **Access the Natural Regions Mode**
   - Start the server: `npm start`
   - Navigate to: `http://localhost:3001/natural-regions.html`
   - Select a country from the dropdown
   - Regions will be displayed on the map

3. **Track Learning Progress**
   - Click on regions to select them
   - Mark regions as "Learning" or "Mastered"
   - Create flashcards for regions in Obsidian

## Technical Details

### Region Generation

The region generation process follows these steps:

1. **Data Loading**
   - Reads Street View coordinates from GeoJSON files
   - Extracts metadata like coverage dates

2. **Point Reduction**
   - Applies grid-based sampling for large datasets
   - Ensures manageable processing time

3. **Spatial Clustering**
   - Groups points based on geographic proximity
   - Uses DBSCAN algorithm with adaptive distance parameters

4. **Cluster Balancing**
   - Merges small clusters to reach target region count
   - Splits large clusters if needed

5. **Region Shape Creation**
   - Creates convex hulls around point clusters
   - Falls back to buffer zones for problematic clusters

### Integration with Existing App

The implementation maintains full compatibility with the existing chess grid mode. Users can switch between modes using the navigation bar at the top of the sidebar.

All existing functionality continues to work:
- Progress tracking
- Flashcard creation
- Obsidian integration

## Next Steps

Potential improvements for the future:

1. **Improved Climate Integration**
   - Better visualization of climate zones
   - More sophisticated region boundaries based on climate transitions

2. **Customizable Region Generation**
   - User-defined region count
   - Interactive region editing

3. **Advanced Visualization**
   - Heatmap overlays of coverage density
   - Timeline view of coverage history

4. **Performance Optimizations**
   - Client-side region processing for smaller countries
   - Progressive loading of region data
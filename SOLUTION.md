# Region Creation Algorithm Improvements

This document outlines the improvements made to the region creation algorithm in the FourNiner Geoguessr Trainer application.

## Problem Statement

The original region creation algorithm primarily used geographic proximity to cluster Street View coordinates, with optional Köppen-Geiger climate data integration. This led to regions that often mixed different climate zones, making it harder to learn distinctive geographical features.

## Solution Overview

The improved algorithm now:

1. Uses Köppen-Geiger climate data by default
2. Creates regions that respect climate zone boundaries
3. Generates more complex region shapes that follow natural features
4. Dynamically adjusts the number of regions per climate zone based on road coverage density

## Implementation Details

### 1. Climate-First Approach

Rather than starting with spatial clustering and then optionally considering climate data, the new algorithm:

- First groups Street View points by Köppen-Geiger climate zones
- Allocates regions to each climate zone proportionally based on its coverage
- Only then performs clustering within each climate zone

This ensures that each region predominantly contains a single climate type, which typically corresponds to similar geographical features (coastlines, mountains, deserts, etc.).

### 2. Dynamic Region Allocation

The number of regions per climate zone is determined by:

- The relative coverage of each climate zone (percentage of total road coverage)
- A weighting formula that balances climate zone representation
- Minimum and maximum thresholds to ensure reasonable region sizes

For example, in a country like Peru:
- Coastal desert regions (BWh, BWk) might get several regions along the coast
- Highland areas (Cwb, ET) would have their own distinct regions
- Rainforest areas (Af) would be allocated regions proportional to their road coverage

### 3. Complex Region Boundaries

The algorithm now attempts to create more complex region boundaries that better follow natural features:

- Uses concave hull generation when possible (with turf.js)
- Adjusts concavity parameters based on point distribution
- Falls back to convex hull or buffer methods when necessary

This creates regions with more natural-looking boundaries that follow coastlines, mountain ranges, and other geographical features.

### 4. User Interface Improvements

- Köppen climate data is now enabled by default
- Added a new `--no-koppen` flag to disable climate-based regions if desired
- Updated help text and README to explain the new approach
- Each region now includes metadata about its climate zone

## Results

The improved algorithm produces regions that:

- Correspond more closely to distinct geographical and climatic areas
- Have more natural-looking boundaries that follow geographical features
- Provide a better learning experience by grouping similar areas
- Maintain good road coverage distribution within each region

## Usage Example

Generate climate-based regions for Peru with default settings:
```
node src/create-regions.js peru
```

Customize the number of regions and climate data resolution:
```
node src/create-regions.js brazil --regions 48 --koppen 0p1
```

Use the traditional proximity-based clustering without climate data:
```
node src/create-regions.js japan --no-koppen
```

## Technical Implementation

The changes were implemented across several files:

1. `src/region-processor.js`:
   - Added `createClimateBasedRegions()` function
   - Updated `createRegions()` to use climate-first approach
   - Improved polygon creation with concave hull support

2. `src/koppen-processor.js`:
   - Added fallback mechanism for systems without GDAL installed
   - Implemented a Köppen climate simulation based on latitude and longitude
   - Added automatic detection of GDAL availability

3. `src/create-regions.js`:
   - Made Köppen climate data enabled by default
   - Added `--no-koppen` flag
   - Updated help text and examples

4. `README.md`:
   - Updated documentation to reflect the new approach
   - Added information about the climate simulation fallback

### GDAL Fallback Mechanism

Since the Köppen-Geiger climate data processing requires GDAL to be installed, which may not be available on all systems, a fallback mechanism was implemented:

1. The system automatically detects if GDAL is installed
2. If GDAL is available, it uses the actual Köppen-Geiger climate data from the TIF files
3. If GDAL is not available, it uses a simulated climate model based on:
   - Latitude zones (equatorial, subtropical, temperate, subpolar, polar)
   - Longitude variations within each latitude zone
   - A deterministic algorithm that assigns climate codes based on coordinates

This ensures that the climate-based region creation works on all systems, even without GDAL, while still providing meaningful climate differentiation.
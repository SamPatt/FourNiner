#!/usr/bin/env node

/**
 * CLI tool to process Street View data and create training regions
 * 
 * Usage:
 *   node create-regions.js <country> [options]
 * 
 * Options:
 *   --regions <number>    Number of regions to create (default: 32)
 *   --koppen <resolution> Use Köppen climate data at specified resolution
 *                         (0p00833333, 0p1, 0p5, 1p0)
 *   --use-years           Consider the year data in clustering
 *   --help                Show this help message
 */

const fs = require('fs');
const path = require('path');
const { processCountryData } = require('./region-processor');

async function main() {
  const args = process.argv.slice(2);
  
  // Show help
  if (args.includes('--help') || args.length === 0) {
    showHelp();
    return;
  }
  
  // Parse arguments
  const country = args[0];
  
  // Check if country file exists
  const dataPath = path.join(__dirname, '..', 'map_data', `${country}.json`);
  if (!fs.existsSync(dataPath)) {
    console.error(`Error: File not found: ${dataPath}`);
    console.error(`Available countries:`);
    
    // List available countries
    const mapDataDir = path.join(__dirname, '..', 'map_data');
    const files = fs.readdirSync(mapDataDir)
      .filter(file => file.endsWith('.json') && !file.includes('_regions'));
    
    if (files.length === 0) {
      console.error('  No country data files found in map_data directory');
    } else {
      files.forEach(file => {
        console.error(`  ${file.replace('.json', '')}`);
      });
    }
    
    process.exit(1);
  }
  
  // Parse options
  let regions = 32;
  let koppenResolution = '0p5';
  let useKoppen = true; // Enable Köppen climate data by default
  let useYears = false;
  let noKoppen = false; // New flag to disable Köppen
  
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--regions' && i + 1 < args.length) {
      regions = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--koppen' && i + 1 < args.length) {
      koppenResolution = args[i + 1];
      useKoppen = true;
      i++;
    } else if (args[i] === '--use-years') {
      useYears = true;
    } else if (args[i] === '--no-koppen') {
      noKoppen = true;
      useKoppen = false;
    }
  }
  
  console.log(`Processing ${country} data to create ${regions} regions...`);
  console.log(`Options: Köppen data: ${useKoppen ? koppenResolution : 'no'}, Year data: ${useYears ? 'yes' : 'no'}`);
  
  try {
    // Process the data
    const result = await processCountryData(country, regions, {
      useKoppen,
      koppenResolution,
      useYearData: useYears
    });
    
    console.log(`Successfully created ${result.features.length} regions for ${country}`);
    console.log(`Output saved to map_data/${country}_regions.json`);
  } catch (error) {
    console.error('Error processing data:', error);
    process.exit(1);
  }
}

function showHelp() {
  console.log(`
FourNiner Region Creator
------------------------

This tool processes Street View coordinate data and creates geographical regions
for the Geoguessr Trainer app.

Usage:
  node create-regions.js <country> [options]

Arguments:
  country                The country ID to process (e.g., russia, usa)

Options:
  --regions <number>     Number of regions to create (default: 32)
                         Values between 20-64 recommended depending on country size
  --koppen <resolution>  Set Köppen climate data resolution (default: 0p5)
                         (0p00833333, 0p1, 0p5, 1p0)
  --no-koppen           Disable Köppen climate data (uses proximity clustering only)
  --use-years           Consider the year data in clustering
  --help                Show this help message

The new algorithm prioritizes creating regions based on Köppen-Geiger climate zones.
Each climate zone will have 1 or more regions depending on its size and road coverage.
This ensures regions correspond to natural geographical features and similar climate patterns.

Examples:
  node create-regions.js peru
  node create-regions.js usa --regions 48
  node create-regions.js france --koppen 0p1
  node create-regions.js japan --no-koppen --use-years
  `);
}

main().catch(error => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
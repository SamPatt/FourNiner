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
  
  // Check if country directory exists in new structure
  const countryDir = path.join(__dirname, '..', 'map_data', 'countries', country);
  const useNewStructure = fs.existsSync(countryDir);
  
  // Define paths for both old and new structure
  let dataPath;
  if (useNewStructure) {
    dataPath = path.join(countryDir, `${country}.json`);
  } else {
    // Check if country file exists in old structure
    dataPath = path.join(__dirname, '..', 'map_data', `${country}.json`);
  }
  
  if (!fs.existsSync(dataPath)) {
    console.error(`Error: File not found: ${dataPath}`);
    console.error(`Available countries:`);
    
    // List available countries from both structures
    const mapDataDir = path.join(__dirname, '..', 'map_data');
    const countriesDir = path.join(mapDataDir, 'countries');
    let files = [];
    
    // Check old structure
    if (fs.existsSync(mapDataDir)) {
      const oldFiles = fs.readdirSync(mapDataDir)
        .filter(file => file.endsWith('.json') && !file.includes('_regions'));
      files = [...files, ...oldFiles.map(file => file.replace('.json', ''))];
    }
    
    // Check new structure
    if (fs.existsSync(countriesDir)) {
      const newDirs = fs.readdirSync(countriesDir, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory())
        .map(dirent => dirent.name);
      files = [...files, ...newDirs];
    }
    
    // Remove duplicates
    files = [...new Set(files)];
    
    if (files.length === 0) {
      console.error('  No country data files found');
    } else {
      files.forEach(file => {
        console.error(`  ${file}`);
      });
    }
    
    process.exit(1);
  }
  
  // Parse options
  let regions = 32;
  let koppenResolution = '0p5';
  let useKoppen = false;
  let useYears = false;
  
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
    }
  }
  
  console.log(`Processing ${country} data to create ${regions} regions...`);
  console.log(`Options: Köppen data: ${useKoppen ? koppenResolution : 'no'}, Year data: ${useYears ? 'yes' : 'no'}`);
  
  try {
    // Make sure the country directory exists for the new structure
    const countryDir = path.join(__dirname, '..', 'map_data', 'countries', country);
    if (!fs.existsSync(countryDir)) {
      fs.mkdirSync(countryDir, { recursive: true });
      console.log(`Created directory: ${countryDir}`);
      
      // If we're creating a new directory, we should copy the country data file there
      if (fs.existsSync(path.join(__dirname, '..', 'map_data', `${country}.json`))) {
        const srcPath = path.join(__dirname, '..', 'map_data', `${country}.json`);
        const destPath = path.join(countryDir, `${country}.json`);
        fs.copyFileSync(srcPath, destPath);
        console.log(`Copied ${country}.json to new directory structure`);
      }
    }
    
    // Process the data with the new directory structure
    const result = await processCountryData(country, regions, {
      useKoppen,
      koppenResolution,
      useYearData: useYears,
      useNewDirectoryStructure: true
    });
    
    console.log(`Successfully created ${result.features.length} regions for ${country}`);
    console.log(`Output saved to map_data/countries/${country}/${country}_regions.json`);
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
  --koppen <resolution>  Use Köppen climate data at specified resolution
                         (0p00833333, 0p1, 0p5, 1p0)
  --use-years           Consider the year data in clustering
  --help                Show this help message

Examples:
  node create-regions.js russia
  node create-regions.js usa --regions 48
  node create-regions.js france --koppen 0p5 --use-years
  `);
}

main().catch(error => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
#!/usr/bin/env node

/**
 * Migration script to organize map_data into country-specific folders
 * 
 * This script moves country data files from the flat structure to organized folders:
 * 1. Creates a folder for each country under map_data/countries/
 * 2. Moves the main country data file and region-specific files to the new folder
 */

const fs = require('fs');
const path = require('path');

async function main() {
  const mapDataDir = path.join(__dirname, 'map_data');
  const countriesDir = path.join(mapDataDir, 'countries');
  
  // Ensure countries directory exists
  if (!fs.existsSync(countriesDir)) {
    fs.mkdirSync(countriesDir, { recursive: true });
    console.log(`Created directory: ${countriesDir}`);
  }
  
  // Find all country data files in the root map_data directory
  const files = fs.readdirSync(mapDataDir)
    .filter(file => file.endsWith('.json'));
  
  // Extract unique country names
  const countryNames = new Set();
  files.forEach(file => {
    // Match country name from patterns like:
    // - country.json
    // - country_regions.json
    // - country_regionID_locations.json
    const match = file.match(/^([a-z-]+)(?:_.*)?\.json$/);
    if (match && !file.includes('countries') && !file.includes('cities')) {
      countryNames.add(match[1]);
    }
  });
  
  console.log(`Found ${countryNames.size} countries to migrate`);
  
  // Process each country
  for (const country of countryNames) {
    console.log(`Processing ${country}...`);
    
    // Create country directory if it doesn't exist
    const countryDir = path.join(countriesDir, country);
    if (!fs.existsSync(countryDir)) {
      fs.mkdirSync(countryDir, { recursive: true });
      console.log(`  Created directory: ${countryDir}`);
    }
    
    // Find all files related to this country
    const countryFiles = files.filter(file => 
      file === `${country}.json` || file.startsWith(`${country}_`)
    );
    
    // Copy each file to the new location (don't delete original to be safe)
    countryFiles.forEach(file => {
      const srcPath = path.join(mapDataDir, file);
      const destPath = path.join(countryDir, file);
      
      try {
        fs.copyFileSync(srcPath, destPath);
        console.log(`  Copied ${file} to country folder`);
      } catch (error) {
        console.error(`  Error copying ${file}:`, error.message);
      }
    });
  }
  
  console.log('Migration complete!');
  console.log('Note: Original files were preserved. After verifying, you can delete them manually.');
}

main().catch(error => {
  console.error('Migration failed:', error);
  process.exit(1);
});
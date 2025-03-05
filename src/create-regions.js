#!/usr/bin/env node

/**
 * Create Regions CLI Tool for FourNiner
 * 
 * This script provides a command-line interface for creating geographic regions
 * for the FourNiner app. It supports both the original method using natural regions
 * and the new method using administrative boundaries from geojson-places.
 */

const fs = require('fs');
const path = require('path');
const { processCountryData } = require('./region-processor');
const { processAdministrativeRegions, listAvailableCountries } = require('./administrative-regions-processor');

// Parse command line arguments
const args = process.argv.slice(2);
let country = null;
let regionCount = null;
let useAdminRegions = false;
let listCountries = false;
let adminLevel = 1;
let showHelp = false;

// Parse arguments
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--admin' || args[i] === '-a') {
    useAdminRegions = true;
  } else if (args[i] === '--list' || args[i] === '-l') {
    listCountries = true;
  } else if (args[i] === '--level' && i + 1 < args.length) {
    adminLevel = parseInt(args[i + 1], 10);
    i++; // Skip the next argument
  } else if (args[i] === '--regions' && i + 1 < args.length) {
    regionCount = parseInt(args[i + 1], 10);
    i++; // Skip the next argument
  } else if (args[i] === '--help' || args[i] === '-h') {
    showHelp = true;
  } else if (!country && !args[i].startsWith('--')) {
    country = args[i];
  }
}

// Display help if requested or no valid arguments provided
if (showHelp || (args.length === 0 && !listCountries)) {
  console.log(`
FourNiner Region Creator
------------------------
Create geographic regions for countries based on two methods:
1. Natural regions (default) - Using clustering of street view locations
2. Administrative regions - Using official admin boundaries from geojson-places

Usage:
  node create-regions.js [country] [options]

Options:
  --admin, -a          Use administrative regions from geojson-places
  --list, -l           List available countries with ISO codes
  --level <number>     Admin level for regions (default: 1, which is states/provinces)
  --regions <number>   Number of regions to create (only for natural regions method)
  --help, -h           Show this help message

Examples:
  node create-regions.js usa                  # Create natural regions for USA
  node create-regions.js usa --regions 20     # Create 20 natural regions for USA
  node create-regions.js usa --admin          # Create administrative regions for USA
  node create-regions.js --list               # List all available countries
  `);
  process.exit(0);
}

// Function to list all available countries
async function showAvailableCountries() {
  console.log('\nListing available countries from geojson-places...\n');
  
  try {
    const countries = listAvailableCountries();
    
    // Group by whether they have FourNiner IDs or not
    const mappedCountries = [];
    const unmappedCountries = [];
    
    Object.entries(countries).forEach(([isoCode, country]) => {
      if (country.fourNinerId) {
        mappedCountries.push({
          isoCode,
          name: country.name,
          fourNinerId: country.fourNinerId
        });
      } else {
        unmappedCountries.push({
          isoCode,
          name: country.name
        });
      }
    });
    
    // Sort by country name
    mappedCountries.sort((a, b) => a.name.localeCompare(b.name));
    unmappedCountries.sort((a, b) => a.name.localeCompare(b.name));
    
    // Display countries that have FourNiner IDs
    console.log('Countries with FourNiner IDs:');
    console.log('-----------------------------');
    mappedCountries.forEach(country => {
      console.log(`${country.name.padEnd(25)} ISO: ${country.isoCode.padEnd(5)} FourNiner ID: ${country.fourNinerId}`);
    });
    
    console.log(`\nTotal: ${mappedCountries.length} mapped countries\n`);
    
    // Display unmapped countries if requested
    if (args.includes('--all')) {
      console.log('Unmapped Countries (no FourNiner ID):');
      console.log('------------------------------------');
      unmappedCountries.forEach(country => {
        console.log(`${country.name.padEnd(25)} ISO: ${country.isoCode}`);
      });
      
      console.log(`\nTotal: ${unmappedCountries.length} unmapped countries`);
    } else {
      console.log('Use --all to show countries without FourNiner IDs');
    }
    
  } catch (error) {
    console.error('Error listing countries:', error);
  }
}

// Function to check if country exists
function checkCountryExists(countryId) {
  // Check if country directory exists in new structure
  const countryDir = path.join(__dirname, '..', 'map_data', 'countries', countryId);
  const useNewStructure = fs.existsSync(countryDir);
  
  // Define paths for both old and new structure
  let dataPath;
  if (useNewStructure) {
    dataPath = path.join(countryDir, `${countryId}.json`);
  } else {
    // Check if country file exists in old structure
    dataPath = path.join(__dirname, '..', 'map_data', `${countryId}.json`);
  }
  
  return fs.existsSync(dataPath) ? { exists: true, path: dataPath } : { exists: false };
}

// Main function
async function main() {
  try {
    // List countries if requested
    if (listCountries) {
      await showAvailableCountries();
      return;
    }
    
    // Ensure country is provided
    if (!country) {
      console.error('Error: Country ID is required');
      console.error('Use --help for usage information');
      process.exit(1);
    }
    
    // Check if country exists
    const countryCheck = checkCountryExists(country);
    
    if (!countryCheck.exists) {
      console.error(`Error: Country data not found for ${country}`);
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
    
    if (useAdminRegions) {
      // Using administrative regions method
      console.log(`Creating administrative regions for ${country}...`);
      console.log(`Using admin level: ${adminLevel}`);
      
      // Create output folder path
      const outputFolder = path.join(__dirname, '..', 'map_data', 'countries', country);
      
      // Ensure output folder exists
      if (!fs.existsSync(outputFolder)) {
        fs.mkdirSync(outputFolder, { recursive: true });
      }
      
      // Process administrative regions
      const result = await processAdministrativeRegions(country, {
        adminLevel: adminLevel,
        outputFolder: outputFolder
      });
      
      if (result && result.features) {
        console.log(`Successfully created ${result.features.length} administrative regions for ${country}`);
        console.log(`Regions saved to ${outputFolder}/${country}_admin_regions.json`);
      } else {
        console.error(`Failed to create administrative regions for ${country}`);
      }
    } else {
      // Using original natural regions method
      console.log(`Creating natural regions for ${country}...`);
      
      // Use default region count if not specified
      if (!regionCount) {
        // Use some defaults based on country size
        const largeCountries = ['usa', 'canada', 'russia', 'china', 'brazil', 'australia'];
        const mediumCountries = ['mexico', 'argentina', 'india', 'kazakhstan', 'mongolia'];
        
        if (largeCountries.includes(country)) {
          regionCount = 18;
        } else if (mediumCountries.includes(country)) {
          regionCount = 14;
        } else {
          regionCount = 10;
        }
      }
      
      console.log(`Using ${regionCount} regions`);
      
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
      
      // Process natural regions
      const result = await processCountryData(country, regionCount, {
        useKoppen: true,
        koppenResolution: '0p5',
        useYearData: false,
        useNewDirectoryStructure: true
      });
      
      if (result && result.features) {
        console.log(`Successfully created ${result.features.length} natural regions for ${country}`);
        console.log(`Regions saved to map_data/countries/${country}/${country}_regions.json`);
      } else {
        console.error(`Failed to create natural regions for ${country}`);
      }
    }
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

// Run the main function
main().catch(error => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
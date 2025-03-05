#!/usr/bin/env node

/**
 * Batch process multiple countries for FourNiner
 * 
 * This script allows you to batch process selected countries or all countries
 * that haven't been processed yet.
 */

const fs = require('fs');
const path = require('path');
const { processCountry, getRegionCountForCountry } = require('./download-coverage');

// Get a list of all countries with data files
function getAllCountriesWithData() {
  const countriesDir = path.join(__dirname, '..', 'map_data', 'countries');
  const countries = new Set();
  
  if (fs.existsSync(countriesDir)) {
    const directories = fs.readdirSync(countriesDir, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name);
      
    directories.forEach(dir => {
      const countryFile = path.join(countriesDir, dir, `${dir}.json`);
      if (fs.existsSync(countryFile)) {
        countries.add(dir);
      }
    });
  }
  
  return [...countries];
}

// Get countries that have data but don't have regions generated
function getCountriesWithoutRegions() {
  const countriesDir = path.join(__dirname, '..', 'map_data', 'countries');
  const countries = new Set();
  
  if (fs.existsSync(countriesDir)) {
    const directories = fs.readdirSync(countriesDir, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name);
      
    directories.forEach(dir => {
      const countryFile = path.join(countriesDir, dir, `${dir}.json`);
      const regionsFile = path.join(countriesDir, dir, `${dir}_regions.json`);
      
      if (fs.existsSync(countryFile) && !fs.existsSync(regionsFile)) {
        countries.add(dir);
      }
    });
  }
  
  return [...countries];
}

// Main function
async function main() {
  try {
    console.log('FourNiner Batch Processor');
    console.log('------------------------');
    
    // Parse command line arguments
    const args = process.argv.slice(2);
    const forceProcess = args.includes('--force');
    const processAll = args.includes('--all');
    const specificCountries = args.filter(arg => !arg.startsWith('--'));
    
    let countriesToProcess = [];
    
    if (specificCountries.length > 0) {
      // Process specific countries
      countriesToProcess = specificCountries;
      console.log(`Processing ${countriesToProcess.length} specific countries`);
    } else if (processAll) {
      // Process all countries with data
      countriesToProcess = getAllCountriesWithData();
      console.log(`Processing all ${countriesToProcess.length} countries with data`);
    } else {
      // Process only countries that don't have regions generated
      countriesToProcess = getCountriesWithoutRegions();
      console.log(`Found ${countriesToProcess.length} countries without regions`);
    }
    
    if (countriesToProcess.length === 0) {
      console.log('No countries to process');
      return;
    }
    
    // Display countries to process with their region counts
    console.log('\nCountries to process:');
    countriesToProcess.forEach(country => {
      console.log(`  - ${country} (${getRegionCountForCountry(country)} regions)`);
    });
    
    // Require force flag for confirmation
    if (!forceProcess) {
      console.log('\nTo start processing, run again with --force flag');
      console.log(`  node src/batch-process.js ${args.join(' ')} --force`);
      return;
    }
    
    // Process each country
    console.log('\nStarting batch processing...');
    for (const country of countriesToProcess) {
      console.log(`\n=== Processing ${country} ===`);
      await processCountry(country);
    }
    
    console.log('\nBatch processing complete!');
    
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

// Run the main function if this script is executed directly
if (require.main === module) {
  main().catch(error => {
    console.error('Unhandled error:', error);
    process.exit(1);
  });
}
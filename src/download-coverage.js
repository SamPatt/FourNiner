#!/usr/bin/env node

/**
 * Download coverage data from geo.emily.bz/coverage-dates
 * 
 * This script downloads country coverage JSON files that haven't been downloaded yet
 * and saves them to the right directory structure.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const url = require('url');

// Base URL for the coverage data
const BASE_URL = 'https://geo.emily.bz/coverage-dates';

// Country size definitions for scaling region count
const COUNTRY_SIZES = {
  // Microstates (1 region)
  MICRO: ['singapore', 'monaco', 'vatican', 'san-marino', 'liechtenstein', 'andorra', 'malta', 'luxembourg'],
  
  // Small countries (~5 regions)
  SMALL: ['bangladesh', 'slovenia', 'denmark', 'switzerland', 'netherlands', 'belgium', 'austria', 'czechia', 
          'serbia', 'portugal', 'hungary', 'ireland', 'slovakia', 'croatia', 'bosnia-herzegovina', 'albania',
          'north-macedonia', 'taiwan', 'israel', 'lebanon', 'bulgaria', 'new-zealand', 'jordan', 'sri-lanka',
          'guatemala', 'panama', 'costa-rica', 'dominican-republic', 'puerto-rico', 'el-salvador', 'jamaica'],
  
  // Medium countries (~8-12 regions)
  MEDIUM: ['poland', 'italy', 'united-kingdom', 'romania', 'greece', 'spain', 'ukraine', 'france', 'germany',
           'sweden', 'norway', 'finland', 'japan', 'philippines', 'vietnam', 'malaysia', 'colombia', 'peru',
           'chile', 'ecuador', 'south-africa', 'morocco', 'egypt', 'tunisia', 'kenya', 'tanzania', 'nigeria',
           'thailand', 'south-korea', 'uzbekistan', 'kyrgyzstan', 'turkmenistan', 'turkey'],
  
  // Large countries (~12-16 regions)
  LARGE: ['mexico', 'argentina', 'bolivia', 'brazil', 'india', 'indonesia', 'mongolia', 'kazakhstan', 'australia'],
  
  // Huge countries (16-18 regions)
  HUGE: ['canada', 'usa', 'russia', 'china']
};

// Get region count based on country size
function getRegionCountForCountry(countryId) {
  const normalizedId = countryId.toLowerCase().replace(/_/g, '-');
  
  if (COUNTRY_SIZES.MICRO.includes(normalizedId)) return 1;
  if (COUNTRY_SIZES.SMALL.includes(normalizedId)) return 5;
  if (COUNTRY_SIZES.MEDIUM.includes(normalizedId)) return 10;
  if (COUNTRY_SIZES.LARGE.includes(normalizedId)) return 14;
  if (COUNTRY_SIZES.HUGE.includes(normalizedId)) return 18;
  
  // Default for unknown countries
  return 8;
}

// Get a list of all country data files that already exist
function getExistingCountries() {
  const mapDataDir = path.join(__dirname, '..', 'map_data');
  const countriesDir = path.join(mapDataDir, 'countries');
  let existingCountries = new Set();
  
  // Check in new directory structure
  if (fs.existsSync(countriesDir)) {
    const directories = fs.readdirSync(countriesDir, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name);
      
    directories.forEach(dir => {
      const countryFile = path.join(countriesDir, dir, `${dir}.json`);
      if (fs.existsSync(countryFile)) {
        existingCountries.add(dir);
      }
    });
  }
  
  console.log(`Found ${existingCountries.size} existing countries`);
  return existingCountries;
}

// Fetch available countries from the website
function fetchAvailableCountries() {
  return new Promise((resolve, reject) => {
    https.get(`${BASE_URL}`, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Request failed with status code ${res.statusCode}`));
        return;
      }
      
      let data = '';
      res.on('data', chunk => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          // Parse the HTML response to extract country links
          const countryLinks = [];
          const linkRegex = /<a href="([^"]+)"/g;
          let match;
          
          while ((match = linkRegex.exec(data)) !== null) {
            const link = match[1];
            if (link !== '../' && !link.startsWith('/')) {
              // Remove trailing slash and filter out non-country files
              const country = link.replace(/\/$/, '');
              if (!country.includes('.')) {
                // Clean up country name - remove prefix if it exists
                const cleanCountry = country.replace(/^.*?\//, '');
                countryLinks.push(cleanCountry);
              }
            }
          }
          
          resolve(countryLinks);
        } catch (error) {
          reject(error);
        }
      });
    }).on('error', reject);
  });
}

// Download a JSON file
function downloadJson(url, filePath) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Request failed with status code ${res.statusCode}`));
        return;
      }
      
      const fileStream = fs.createWriteStream(filePath);
      res.pipe(fileStream);
      
      fileStream.on('finish', () => {
        fileStream.close();
        resolve();
      });
      
      fileStream.on('error', (err) => {
        fs.unlink(filePath, () => {}); // Delete the file if there was an error
        reject(err);
      });
    }).on('error', reject);
  });
}

// Process a country - download only without region generation
async function processCountry(countryId) {
  try {
    console.log(`Processing country: ${countryId}`);
    
    // Create country directory
    const countryDir = path.join(__dirname, '..', 'map_data', 'countries', countryId);
    if (!fs.existsSync(countryDir)) {
      fs.mkdirSync(countryDir, { recursive: true });
      console.log(`Created directory: ${countryDir}`);
    }
    
    // Download country JSON
    const countryUrl = `${BASE_URL}/${countryId}.json`;
    const countryFilePath = path.join(countryDir, `${countryId}.json`);
    console.log(`Downloading from ${countryUrl} to ${countryFilePath}`);
    
    await downloadJson(countryUrl, countryFilePath);
    console.log(`Downloaded ${countryId} data successfully`);
    
    return true;
  } catch (error) {
    console.error(`Error processing ${countryId}:`, error);
    return false;
  }
}

// Main function
async function main() {
  try {
    console.log('FourNiner Coverage Downloader');
    console.log('-----------------------------');
    
    const args = process.argv.slice(2);
    const forceDownload = args.includes('--force');
    const listAll = args.includes('--list');
    const specificCountries = args.filter(arg => !arg.startsWith('--'));
    
    // Get existing countries
    const existingCountries = getExistingCountries();
    
    // Fetch all available countries
    console.log('Fetching available countries from website...');
    const availableCountries = await fetchAvailableCountries();
    console.log(`Found ${availableCountries.length} countries available for download`);
    
    // If --list flag is provided, display all available countries
    if (listAll) {
      console.log('\nAvailable countries:');
      availableCountries.sort().forEach(country => {
        const exists = existingCountries.has(country);
        console.log(`  - ${country} (${exists ? '[DOWNLOADED]' : 'Not downloaded'})`);
      });
      return;
    }
    
    // Filter countries that don't exist yet
    const countriesToDownload = specificCountries.length > 0 
      ? specificCountries.filter(country => !existingCountries.has(country))
      : availableCountries.filter(country => !existingCountries.has(country));
    
    console.log(`Need to download ${countriesToDownload.length} countries`);
    
    if (countriesToDownload.length === 0) {
      console.log('No new countries to download');
      return;
    }
    
    // Ask for confirmation if not forced
    if (!forceDownload) {
      console.log('\nCountries that will be downloaded:');
      countriesToDownload.sort().forEach(country => {
        console.log(`  - ${country}`);
      });
      
      console.log('\nTo start download, run again with --force flag');
      
      if (specificCountries.length > 0) {
        console.log(`  node src/download-coverage.js ${specificCountries.join(' ')} --force`);
      } else {
        console.log('  node src/download-coverage.js --force');
        console.log('\nOr download specific countries:');
        console.log('  node src/download-coverage.js country1 country2 --force');
      }
      return;
    }
    
    // Download countries without region generation
    console.log('\nStarting download...');
    for (const country of countriesToDownload) {
      await processCountry(country);
    }
    
    console.log('\nDownload complete!');
    
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

// Check if this script is being run directly
if (require.main === module) {
  main().catch(error => {
    console.error('Unhandled error:', error);
    process.exit(1);
  });
}

module.exports = {
  processCountry,
  getRegionCountForCountry
};
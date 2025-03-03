const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const app = express();
const port = 3001;

// Load environment variables for Google Maps API key
require('dotenv').config();

// Configure CORS and JSON parsing with increased size limits
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Set up a middleware to inject environment variables into templates
app.use((req, res, next) => {
  // Make API key available to frontend
  app.locals.GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
  next();
});

// Serve static files with template processing
app.get('*.html', (req, res, next) => {
  const filePath = path.join(__dirname, 'public', req.path);
  fs.readFile(filePath, 'utf8', (err, data) => {
    if (err) {
      next();
      return;
    }
    
    // Replace environment placeholders
    const processed = data.replace(/\${GOOGLE_MAPS_API_KEY}/g, process.env.GOOGLE_MAPS_API_KEY || '');
    res.setHeader('Content-Type', 'text/html');
    res.send(processed);
  });
});

app.use(express.static('public'));  // Serve static files from the public directory

// Set the path to your Obsidian vault
const OBSIDIAN_PATH = '/home/nondescript/mind/mind/Projects/Geoguessr/Regions';

// Add route to serve map data
app.use('/map_data', express.static(path.join(__dirname, 'map_data')));

// API endpoint to get all countries and cells
app.get('/api/progress', (req, res) => {
    try {
        const progress = {};
        
        // Check if the directory exists
        if (!fs.existsSync(OBSIDIAN_PATH)) {
            console.log(`Creating directory: ${OBSIDIAN_PATH}`);
            fs.mkdirSync(OBSIDIAN_PATH, { recursive: true });
            return res.json(progress); // Return empty progress
        }
        
        // Read all directories (countries) in the Obsidian path
        const countries = fs.readdirSync(OBSIDIAN_PATH, { withFileTypes: true })
            .filter(dirent => dirent.isDirectory())
            .map(dirent => dirent.name);
        
        // For each country, read all markdown files (cells)
        countries.forEach(country => {
            const countryPath = path.join(OBSIDIAN_PATH, country);
            progress[country] = {};
            
            const files = fs.readdirSync(countryPath, { withFileTypes: true })
                .filter(dirent => dirent.isFile() && dirent.name.endsWith('.md'))
                .map(dirent => dirent.name);
            
            // For each file, determine its status
            files.forEach(file => {
                const cellId = file.replace('.md', '');
                const filePath = path.join(countryPath, file);
                const content = fs.readFileSync(filePath, 'utf8');
                
                if (content.includes('#status/mastered')) {
                    progress[country][cellId] = 'mastered';
                } else if (content.includes('#status/learning')) {
                    progress[country][cellId] = 'learning';
                } else {
                    progress[country][cellId] = 'learning'; // Default to learning if file exists
                }
            });
        });
        
        res.json(progress);
    } catch (error) {
        console.error('Error reading progress:', error);
        res.status(500).json({ error: error.message });
    }
});

// API endpoint to create or update a flashcard
app.post('/api/flashcard', (req, res) => {
    try {
        const { countryId, cellId, content, status } = req.body;
        
        if (!countryId || !cellId || !content) {
            return res.status(400).json({ error: 'Missing required fields' });
        }
        
        // Create country directory if it doesn't exist
        const countryPath = path.join(OBSIDIAN_PATH, countryId);
        if (!fs.existsSync(countryPath)) {
            fs.mkdirSync(countryPath, { recursive: true });
        }
        
        // Write the file
        const filePath = path.join(countryPath, `${cellId}.md`);
        fs.writeFileSync(filePath, content);
        
        res.json({ success: true });
    } catch (error) {
        console.error('Error creating flashcard:', error);
        res.status(500).json({ error: error.message });
    }
});

// API endpoint to add a Street View location to a flashcard
app.post('/api/flashcard/location', (req, res) => {
    try {
        const { countryId, cellId, lat, lng, imageData, locationInfo } = req.body;
        
        if (!countryId || !cellId || !lat || !lng) {
            return res.status(400).json({ error: 'Missing required fields' });
        }
        
        // Get the path to the flashcard file
        const countryPath = path.join(OBSIDIAN_PATH, countryId);
        const filePath = path.join(countryPath, `${cellId}.md`);
        
        // Check if the file exists
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'Flashcard not found' });
        }
        
        // Read the current content
        let content = fs.readFileSync(filePath, 'utf8');
        
        // Check if this is an answer image (goes after the question mark)
        const isAnswer = req.body.isAnswer === true;
        
        // Handle location info differently depending on if it's answer content
        if (!isAnswer) {
            // For non-answer (question) content, add location before the question mark
            const locationInfoText = locationInfo 
                ? `\n\nLocation: ${locationInfo}` 
                : `\n\nStreet View Location: ${lat}, ${lng}`;
            
            // Add the location info before the question mark
            const qIndex = content.indexOf('\n?');
            if (qIndex !== -1) {
                content = content.substring(0, qIndex) + locationInfoText + content.substring(qIndex);
            } else {
                content += locationInfoText;
            }
        }
        
        // If we have image data (Base64 encoded), save it as a file and add it to the flashcard
        if (imageData) {
            // Determine the images directory
            const imagesDir = path.join(countryPath, 'images');
            if (!fs.existsSync(imagesDir)) {
                fs.mkdirSync(imagesDir, { recursive: true });
            }
            
            // Generate a unique filename based on coordinates and timestamp
            const filename = `${countryId}_${cellId}_${lat.toFixed(6)}_${lng.toFixed(6)}_${Date.now()}.png`;
            const imagePath = path.join(imagesDir, filename);
            
            // Remove the data:image/png;base64, part from the data
            const base64Data = imageData.replace(/^data:image\/[^;]+;base64,/, '');
            
            // Write the image file
            fs.writeFileSync(imagePath, base64Data, 'base64');
            
            // Format the caption based on whether this is an answer or question image
            let caption;
            if (isAnswer) {
                caption = locationInfo
                    ? `Road map: ${locationInfo}`
                    : `Road map at ${lat.toFixed(6)}, ${lng.toFixed(6)}`;
            } else {
                caption = "Street View location (question)";
            }
            
            // Create the image reference with single newlines for proper Obsidian spacing
            const imageReference = `![${caption}](images/${filename})`;
            
            // Check if file is empty (brand new region file)
            const isEmptyFile = content.trim() === '';
            
            if (isEmptyFile) {
                // For a completely empty file, just add tags 
                content = `#flash-geo/regions/${countryId}/${cellId} #status/learning\n`;
                
                if (!isAnswer) {
                    // This is a question image for a new file
                    content += `${imageReference}\n?\n`;
                } else {
                    // This is an answer image for a new file (unusual but handle it)
                    content += `[Your screenshot will appear here as the question]\n?\n${imageReference}\n${locationInfo || ''}\n`;
                }
            } else {
                // Always append a new complete flashcard at the end of the file
                
                // Make sure there's at least one newline at the end 
                if (!content.endsWith('\n')) {
                    content += '\n';
                }
                
                // Add an extra newline to separate from previous content if needed
                if (!content.endsWith('\n\n')) {
                    content += '\n';
                }
                
                if (isAnswer) {
                    // For answer images, add a complete flashcard with placeholder question
                    content += `[Your screenshot will appear here as the question]\n?\n${imageReference}\n${locationInfo || ''}\n`;
                } else {
                    // For question images, add just the question part (no answer yet)
                    content += `${imageReference}\n?\n`;
                }
            }
        } else if (isAnswer && locationInfo) {
            // Handle text-only answers (no image data)
            
            // Check if file is empty (brand new region file)
            const isEmptyFile = content.trim() === '';
            
            if (isEmptyFile) {
                // For a completely empty file, just add tags and a text-only flashcard
                content = `#flash-geo/regions/${countryId}/${cellId} #status/learning\n`;
                content += `[Your screenshot will appear here as the question]\n?\n${locationInfo}\n`;
            } else {
                // Always append a new complete flashcard at the end
                
                // Make sure there's at least one newline at the end
                if (!content.endsWith('\n')) {
                    content += '\n';
                }
                
                // Add an extra newline to separate from previous content if needed
                if (!content.endsWith('\n\n')) {
                    content += '\n';
                }
                
                // Add a complete text-only flashcard
                content += `[Your screenshot will appear here as the question]\n?\n${locationInfo}\n`;
            }
        }
        
        // Write the updated content back to the file
        fs.writeFileSync(filePath, content);
        
        res.json({ success: true });
        
    } catch (error) {
        console.error('Error adding location to flashcard:', error);
        res.status(500).json({ error: error.message });
    }
});

// API endpoint to get country boundaries in GeoJSON format
app.get('/api/countries', (req, res) => {
    try {
        const countriesPath = path.join(__dirname, 'map_data', 'countries.geojson');
        
        // Check if countries file exists
        if (!fs.existsSync(countriesPath)) {
            console.error('Countries GeoJSON file not found:', countriesPath);
            return res.status(404).json({ 
                error: 'Countries data not found',
                message: 'The countries GeoJSON file is missing. Please add a countries.geojson file to your map_data directory.'
            });
        }
        
        console.log('Serving countries GeoJSON file:', countriesPath);
        
        // Set appropriate content type
        res.setHeader('Content-Type', 'application/json');
        
        // Stream the file directly to response instead of loading it into memory
        const fileStream = fs.createReadStream(countriesPath);
        
        fileStream.on('error', (err) => {
            console.error('Error streaming countries GeoJSON file:', err);
            res.status(500).json({ error: 'Error reading countries data' });
        });
        
        fileStream.pipe(res);
    } catch (error) {
        console.error('Error retrieving countries data:', error);
        res.status(500).json({ error: error.message });
    }
});

// API endpoint to get regions for a country
app.get('/api/regions/:countryId', (req, res) => {
    try {
        const countryId = req.params.countryId.toLowerCase();
        
        // First check in the new directory structure
        let regionsPath = path.join(__dirname, 'map_data', 'countries', countryId, `${countryId}_regions.json`);
        
        // If not found, try the old path as fallback
        if (!fs.existsSync(regionsPath)) {
            regionsPath = path.join(__dirname, 'map_data', `${countryId}_regions.json`);
        }
        
        // Check if regions file exists in either location
        if (!fs.existsSync(regionsPath)) {
            // If not, check if we have raw data to process
            let rawDataPath = path.join(__dirname, 'map_data', 'countries', countryId, `${countryId}.json`);
            
            if (!fs.existsSync(rawDataPath)) {
                rawDataPath = path.join(__dirname, 'map_data', `${countryId}.json`);
                
                if (!fs.existsSync(rawDataPath)) {
                    return res.status(404).json({ 
                        error: 'Country not found',
                        message: `No data found for country '${countryId}'` 
                    });
                }
            }
            
            return res.status(404).json({
                error: 'Regions not generated',
                message: `Regions have not been generated for '${countryId}'. Run 'node src/create-regions.js ${countryId}' to generate them.`
            });
        }
        
        // Read and return the regions
        const regionsData = fs.readFileSync(regionsPath, 'utf8');
        const regions = JSON.parse(regionsData);
        
        res.json(regions);
    } catch (error) {
        console.error('Error retrieving regions:', error);
        res.status(500).json({ error: error.message });
    }
});

// API endpoint to get street view locations for a specific region
app.get('/api/locations/:countryId/:regionId', (req, res) => {
    try {
        const countryId = req.params.countryId.toLowerCase();
        const regionId = req.params.regionId;
        const zoomLevel = parseInt(req.query.zoom || '0');
        
        console.log(`API request for locations: country=${countryId}, region=${regionId}, zoom=${zoomLevel}`);
        
        // First, check if the country folder exists in the new structure
        const countryDir = path.join(__dirname, 'map_data', 'countries', countryId);
        const useNewStructure = fs.existsSync(countryDir);
        
        // Load the country regions to get the polygon for this region
        let regionsPath;
        if (useNewStructure) {
            regionsPath = path.join(countryDir, `${countryId}_regions.json`);
        } else {
            regionsPath = path.join(__dirname, 'map_data', `${countryId}_regions.json`);
        }
        
        if (!fs.existsSync(regionsPath)) {
            return res.status(404).json({
                error: 'Regions not found',
                message: `No region data found for country '${countryId}'`
            });
        }
        
        const regionsData = JSON.parse(fs.readFileSync(regionsPath, 'utf8'));
        
        // Find the specific region by ID
        const region = regionsData.features.find(feature => 
            feature.properties.clusterID === regionId);
        
        if (!region) {
            return res.status(404).json({
                error: 'Region not found',
                message: `Region '${regionId}' not found in country '${countryId}'`
            });
        }
        
        // Load the country locations file
        let locationsPath;
        if (useNewStructure) {
            locationsPath = path.join(countryDir, `${countryId}.json`);
        } else {
            locationsPath = path.join(__dirname, 'map_data', `${countryId}.json`);
        }
        
        if (!fs.existsSync(locationsPath)) {
            return res.status(404).json({
                error: 'Locations not found',
                message: `No location data found for country '${countryId}'`
            });
        }
        
        const locationsData = JSON.parse(fs.readFileSync(locationsPath, 'utf8'));
        
        // Check if we have a preprocessed file for this region already
        let regionLocationsPath;
        if (useNewStructure) {
            regionLocationsPath = path.join(countryDir, `${countryId}_${regionId}_locations.json`);
        } else {
            regionLocationsPath = path.join(__dirname, 'map_data', `${countryId}_${regionId}_locations.json`);
        }
        
        let locations;
        if (fs.existsSync(regionLocationsPath)) {
            // Use preprocessed file if it exists
            locations = JSON.parse(fs.readFileSync(regionLocationsPath, 'utf8'));
        } else {
            // Process locations dynamically (this could be slow for large datasets)
            let turf;
            try {
                turf = require('@turf/turf');
            } catch (e) {
                console.error('Error loading @turf/turf, falling back to turf:', e);
                turf = require('turf');
            }
            const regionPolygon = region.geometry;
            
            // Filter locations that are within this region's polygon
            let filteredLocations = [];
            
            try {
                console.log(`Filtering ${locationsData.customCoordinates.length} locations for region ${regionId}`);
                
                // Let's try both polygon and bbox approaches for maximum coverage
                // First use bbox method since it's more reliable
                let bbox;
                try {
                    // Get the bounding box of the region
                    bbox = turf.bbox(region);
                    console.log(`Region ${regionId} bbox: ${JSON.stringify(bbox)}`);
                } catch (bboxError) {
                    console.error('Error calculating bbox:', bboxError);
                    // Manual bbox calculation from coords as fallback
                    const coords = region.geometry.coordinates[0];
                    const lngs = coords.map(c => c[0]);
                    const lats = coords.map(c => c[1]);
                    bbox = [
                        Math.min(...lngs), // min lng
                        Math.min(...lats), // min lat
                        Math.max(...lngs), // max lng
                        Math.max(...lats)  // max lat
                    ];
                    console.log(`Manually calculated bbox: ${JSON.stringify(bbox)}`);
                }
                
                // Filter points using bbox
                filteredLocations = locationsData.customCoordinates.filter(coord => {
                    return coord.lng >= bbox[0] && 
                           coord.lng <= bbox[2] && 
                           coord.lat >= bbox[1] && 
                           coord.lat <= bbox[3];
                });
                
                console.log(`Found ${filteredLocations.length} locations within region bbox`);
                
                // If we have many points in the bbox, we could try to refine with point-in-polygon
                // but it's better to have too many points than none
            } catch (e) {
                console.error('Error during location filtering:', e);
                filteredLocations = []; // Empty array as fallback
            }
            
            locations = { customCoordinates: filteredLocations };
            
            // Cache the results to a file for future use
            fs.writeFileSync(regionLocationsPath, JSON.stringify(locations));
        }
        
        // Apply sampling based on zoom level
        let sampledLocations;
        if (zoomLevel < 6) {  // Lower threshold to make testing easier
            // No locations at very low zoom levels
            sampledLocations = { customCoordinates: [] };
        } else if (zoomLevel < 10) {  // Lower medium threshold
            // Sample approximately 20% of locations at medium zoom (increased from 10%)
            const sampleRate = 0.2;
            sampledLocations = { 
                customCoordinates: locations.customCoordinates.filter(() => Math.random() < sampleRate) 
            };
        } else {
            // All locations at high zoom
            sampledLocations = locations;
        }
        
        console.log(`Returning ${sampledLocations.customCoordinates.length} street view locations for zoom level ${zoomLevel}`)
        
        res.json(sampledLocations);
    } catch (error) {
        console.error('Error retrieving region locations:', error);
        res.status(500).json({ error: error.message });
    }
});

// Start the server
app.listen(port, () => {
    console.log(`Geoguessr Trainer server running at http://localhost:${port}`);
    console.log(`Obsidian path: ${OBSIDIAN_PATH}`);
    console.log(`Open your browser and navigate to http://localhost:${port}/`);
});
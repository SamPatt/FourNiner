const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const app = express();
const port = 3001;

// Configure CORS and JSON parsing
app.use(cors());
app.use(express.json());
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
        const regionsPath = path.join(__dirname, 'map_data', `${countryId}_regions.json`);
        
        // Check if regions file exists
        if (!fs.existsSync(regionsPath)) {
            // If not, check if we have raw data to process
            const rawDataPath = path.join(__dirname, 'map_data', `${countryId}.json`);
            
            if (!fs.existsSync(rawDataPath)) {
                return res.status(404).json({ 
                    error: 'Country not found',
                    message: `No data found for country '${countryId}'` 
                });
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

// Start the server
app.listen(port, () => {
    console.log(`Geoguessr Trainer server running at http://localhost:${port}`);
    console.log(`Obsidian path: ${OBSIDIAN_PATH}`);
    console.log(`Open your browser and navigate to http://localhost:${port}/`);
});
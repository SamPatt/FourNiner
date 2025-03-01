const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const app = express();
const port = 3001;

// Configure CORS and JSON parsing
app.use(cors());
app.use(express.json());
app.use(express.static('public'));  // Serve static files from current directory

// Set the path to your Obsidian vault
const OBSIDIAN_PATH = '/home/nondescript/mind/mind/Projects/Geoguessr/Regions';

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

// Start the server
app.listen(port, () => {
    console.log(`Geoguessr Trainer server running at http://localhost:${port}`);
    console.log(`Obsidian path: ${OBSIDIAN_PATH}`);
    console.log(`Open your browser and navigate to http://localhost:${port}/`);
});
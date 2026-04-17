#!/usr/bin/env node

/**
 * Simple HTTP server for Bowhead Whale Piano
 * Serves the web app and whale sound files
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8080;
const PUBLIC_DIR = __dirname;

const MIME_TYPES = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.wav': 'audio/wav',
    '.WAV': 'audio/wav',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
};

const server = http.createServer((req, res) => {
    // Default to index.html
    let filePath = req.url === '/' ? '/index.html' : req.url;
    filePath = path.join(PUBLIC_DIR, filePath);

    // Security: prevent directory traversal
    if (!filePath.startsWith(PUBLIC_DIR)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }

    // Check if file exists
    fs.access(filePath, fs.constants.R_OK, (err) => {
        if (err) {
            res.writeHead(404);
            res.end('404 Not Found');
            return;
        }

        // Get file extension and MIME type
        const ext = path.extname(filePath);
        const mimeType = MIME_TYPES[ext] || 'application/octet-stream';

        // Read and serve file
        fs.readFile(filePath, (err, data) => {
            if (err) {
                res.writeHead(500);
                res.end('500 Internal Server Error');
                return;
            }

            res.writeHead(200, {
                'Content-Type': mimeType,
                'Access-Control-Allow-Origin': '*'
            });
            res.end(data);
        });
    });
});

server.listen(PORT, () => {
    console.log('🐋 Bowhead Whale Piano Server');
    console.log('=============================');
    console.log(`Server running at http://localhost:${PORT}/`);
    console.log('\nOpen your browser and navigate to:');
    console.log(`  → http://localhost:${PORT}/\n`);
    console.log('Press Ctrl+C to stop the server\n');
});

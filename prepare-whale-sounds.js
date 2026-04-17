#!/usr/bin/env node

/**
 * Bowhead Whale Sound Selector
 * 
 * Scans the whale sound directory, randomly selects .WAV files from all folders
 * in equal proportion using seed 42, and copies them to the wav-files directory.
 */

const fs = require('fs');
const path = require('path');

// Configuration
const SOURCE_DIR = '/Volumes/Bowhead/Shell2013_GSI_Data';
const OUTPUT_DIR = path.join(__dirname, 'wav-files');
const NUM_FILES_TO_SELECT = 88; // 88 piano keys
const RANDOM_SEED = 42;

// Seeded random number generator (Mulberry32)
function createSeededRandom(seed) {
    return function() {
        let t = seed += 0x6D2B79F5;
        t = Math.imul(t ^ t >>> 15, t | 1);
        t ^= t + Math.imul(t ^ t >>> 7, t | 61);
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

// Recursively find all .WAV files
function findWAVFiles(dir) {
    let results = [];
    
    try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        
        for (const entry of entries) {
            // Skip hidden files and .DS_Store
            if (entry.name.startsWith('.')) continue;
            
            const fullPath = path.join(dir, entry.name);
            
            if (entry.isDirectory()) {
                results = results.concat(findWAVFiles(fullPath));
            } else if (entry.isFile() && entry.name.toUpperCase().endsWith('.WAV')) {
                results.push(fullPath);
            }
        }
    } catch (error) {
        console.error(`Error reading directory ${dir}:`, error.message);
    }
    
    return results;
}

// Group files by their top-level folder (S213gsif, S313gsif, etc.)
function groupFilesByFolder(files, sourceDir) {
    const groups = {};
    
    for (const file of files) {
        const relativePath = path.relative(sourceDir, file);
        const topFolder = relativePath.split(path.sep)[0];
        
        if (!groups[topFolder]) {
            groups[topFolder] = [];
        }
        groups[topFolder].push(file);
    }
    
    return groups;
}

// Shuffle array using seeded random
function shuffle(array, random) {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

// Select files in equal proportion from each folder
function selectFiles(groups, totalToSelect, random) {
    const folderNames = Object.keys(groups).sort(); // Sort for consistency
    const numFolders = folderNames.length;
    const filesPerFolder = Math.floor(totalToSelect / numFolders);
    const remainingFiles = totalToSelect % numFolders;
    
    console.log(`\nSelecting ${totalToSelect} files from ${numFolders} folders:`);
    console.log(`Base allocation: ${filesPerFolder} files per folder`);
    console.log(`Remaining to distribute: ${remainingFiles} files\n`);
    
    const selectedFiles = [];
    
    folderNames.forEach((folderName, index) => {
        const files = groups[folderName];
        const shuffled = shuffle(files, random);
        
        // Calculate how many to take from this folder
        let numToTake = filesPerFolder;
        if (index < remainingFiles) {
            numToTake++; // Distribute remaining files to first folders
        }
        
        const taken = shuffled.slice(0, Math.min(numToTake, shuffled.length));
        selectedFiles.push(...taken);
        
        console.log(`${folderName}: ${taken.length}/${files.length} files selected`);
    });
    
    return selectedFiles;
}

// Copy files to output directory with sequential naming
function copyFiles(files, outputDir) {
    // Create output directory if it doesn't exist
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    } else {
        // Clean existing files
        const existing = fs.readdirSync(outputDir);
        for (const file of existing) {
            if (file.endsWith('.WAV') || file.endsWith('.wav')) {
                fs.unlinkSync(path.join(outputDir, file));
            }
        }
    }
    
    console.log(`\nCopying ${files.length} files to ${outputDir}...\n`);
    
    files.forEach((file, index) => {
        const ext = path.extname(file);
        const newName = `whale_sound_${String(index + 1).padStart(3, '0')}${ext}`;
        const destPath = path.join(outputDir, newName);
        
        try {
            fs.copyFileSync(file, destPath);
            console.log(`✓ ${newName} <- ${path.basename(file)}`);
        } catch (error) {
            console.error(`✗ Error copying ${file}:`, error.message);
        }
    });
}

// Generate manifest file
function generateManifest(files, outputDir) {
    const manifest = {
        timestamp: new Date().toISOString(),
        seed: RANDOM_SEED,
        totalFiles: files.length,
        sourceDirectory: SOURCE_DIR,
        files: files.map((file, index) => ({
            index: index + 1,
            newName: `whale_sound_${String(index + 1).padStart(3, '0')}${path.extname(file)}`,
            originalPath: file,
            originalName: path.basename(file),
            folder: path.relative(SOURCE_DIR, file).split(path.sep)[0]
        }))
    };
    
    const manifestPath = path.join(outputDir, 'manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    console.log(`\n✓ Manifest saved to ${manifestPath}`);
    
    return manifest;
}

// Main execution
function main() {
    console.log('🐋 Bowhead Whale Sound Selector\n');
    console.log('=================================');
    console.log(`Source: ${SOURCE_DIR}`);
    console.log(`Output: ${OUTPUT_DIR}`);
    console.log(`Random Seed: ${RANDOM_SEED}`);
    console.log(`Files to Select: ${NUM_FILES_TO_SELECT}`);
    console.log('=================================\n');
    
    // Check if source directory exists
    if (!fs.existsSync(SOURCE_DIR)) {
        console.error(`❌ Source directory not found: ${SOURCE_DIR}`);
        console.error('Please ensure the VPN is connected and the path is correct.');
        process.exit(1);
    }
    
    // Find all WAV files
    console.log('Scanning for .WAV files...');
    const allFiles = findWAVFiles(SOURCE_DIR);
    console.log(`Found ${allFiles.length} .WAV files total\n`);
    
    if (allFiles.length === 0) {
        console.error('❌ No .WAV files found in the source directory');
        process.exit(1);
    }
    
    // Group by folder
    const groups = groupFilesByFolder(allFiles, SOURCE_DIR);
    console.log('File distribution by folder:');
    for (const [folder, files] of Object.entries(groups)) {
        console.log(`  ${folder}: ${files.length} files`);
    }
    
    // Initialize seeded random
    const random = createSeededRandom(RANDOM_SEED);
    
    // Select files
    const selectedFiles = selectFiles(groups, NUM_FILES_TO_SELECT, random);
    
    // Copy files
    copyFiles(selectedFiles, OUTPUT_DIR);
    
    // Generate manifest
    const manifest = generateManifest(selectedFiles, OUTPUT_DIR);
    
    console.log('\n✅ Complete!');
    console.log(`\n${selectedFiles.length} whale sound files are ready in: ${OUTPUT_DIR}`);
    console.log('\nYou can now open index.html and load these files to create your whale piano!');
}

// Run the script
main();

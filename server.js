const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs').promises;
const { createReadStream } = require('fs');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- Page Routes ---
app.get('/shorts', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'shorts.html'));
});

app.get('/video', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'video.html'));
});

app.get('/mp3', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'mp3.html'));
});

// Rate Limiting
const rateLimit = new Map();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const MAX_REQUESTS = 100; // 100 requests per minute

const checkRateLimit = (ip) => {
    const now = Date.now();
    const client = rateLimit.get(ip) || { count: 0, startTime: now };

    if (now - client.startTime > RATE_LIMIT_WINDOW) {
        client.count = 1;
        client.startTime = now;
    } else {
        client.count++;
    }

    rateLimit.set(ip, client);
    return client.count <= MAX_REQUESTS;
};

// Store active progress clients
const progressClients = new Map();

// SSE Endpoint for Progress
app.get('/api/progress', (req, res) => {
    const { id } = req.query;
    if (!id) return res.status(400).send('Missing ID');

    console.log(`SSE Connection established for ID: ${id}`);

    // Set headers for SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // Store client
    progressClients.set(id, res);

    // Remove client on close
    req.on('close', () => {
        console.log(`SSE Connection closed for ID: ${id}`);
        progressClients.delete(id);
    });
});

// Helper to run yt-dlp
const runYtDlp = (args, cwd = null, onProgress = null) => {
    return new Promise((resolve, reject) => {
        const options = cwd ? { cwd } : {};
        const ytDlpPath = path.join(__dirname, 'yt-dlp.exe');

        console.log(`Spawning: ${ytDlpPath} with args: ${args.join(' ')} in ${cwd || 'current dir'}`);

        const process = spawn(ytDlpPath, args, options);
        let stdout = '';
        let stderr = '';

        let buffer = '';

        process.stdout.on('data', (data) => {
            const str = data.toString();

            // Only accumulate stdout if we are NOT tracking progress (i.e. for JSON info)
            // or if the buffer is small enough to be safe.
            if (!onProgress || stdout.length < 10 * 1024 * 1024) {
                stdout += str;
            }

            buffer += str;

            // Process line by line for progress
            let lines = buffer.split(/[\r\n]+/);
            buffer = lines.pop(); // Keep the last partial line

            lines.forEach(line => {
                if (!line.trim()) return;

                // Parse progress
                if (onProgress) {
                    // Regex to capture: percent, size, unit, speed, speed unit, eta
                    // [download]  23.5% of 10.00MiB at  2.50MiB/s ETA 00:03
                    const match = line.match(/\[download\]\s+(\d+\.?\d*)%\s+of\s+(~?[\d\.]+)(\w+)\s+at\s+([\d\.]+)(\w+\/s)\s+ETA\s+([\d:]+)/);
                    if (match) {
                        // console.log('Progress match:', match[1]); // Optional debug
                        onProgress({
                            percent: parseFloat(match[1]),
                            size: match[2] + match[3],
                            speed: match[4] + match[5],
                            eta: match[6]
                        });
                    } else {
                        // Fallback for just percent
                        const simpleMatch = line.match(/\[download\]\s+(\d+\.?\d*)%/);
                        if (simpleMatch) {
                            onProgress({ percent: parseFloat(simpleMatch[1]) });
                        } else if (line.includes('[download]')) {
                            console.log('Unmatched download line:', line);
                        }
                    }
                }
            });
        });

        process.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        process.on('error', (err) => {
            console.error('Spawn error:', err);
            reject(err);
        });

        process.on('close', (code) => {
            if (code === 0) {
                resolve(stdout);
            } else {
                reject(new Error(stderr || `Process exited with code ${code}`));
            }
        });

        // Timeout after 10 minutes (increased for large files)
        setTimeout(() => {
            process.kill();
            reject(new Error('Download timed out'));
        }, 10 * 60 * 1000);
    });
};

// Health Check Endpoint
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Get Video Info
app.post('/api/info', async (req, res) => {
    const { url } = req.body;
    const ip = req.ip;

    if (!checkRateLimit(ip)) {
        return res.status(429).json({ success: false, error: 'Rate limit exceeded. Please try again later.' });
    }

    console.log(`Info request: ${url}`);

    try {
        // -j: JSON output, --flat-playlist: don't list playlist items if URL is playlist
        // -j: JSON output, --flat-playlist: don't list playlist items if URL is playlist
        const jsonOutput = await runYtDlp(['-j', '--no-playlist', url]);

        let info;
        try {
            info = JSON.parse(jsonOutput);
        } catch (e) {
            console.error('JSON Parse Error. Raw Output:', jsonOutput);
            throw new Error('Failed to parse video info');
        }

        let resolutions = new Set();
        let hasAudio = false;

        if (info.formats) {
            info.formats.forEach(f => {
                if (f.vcodec !== 'none' && f.height) {
                    resolutions.add(f.height);
                }
                if (f.acodec !== 'none') {
                    hasAudio = true;
                }
            });
        }

        // Sort resolutions descending
        const sortedResolutions = Array.from(resolutions).sort((a, b) => b - a);
        console.log(`Found resolutions for ${url}:`, sortedResolutions);

        res.json({
            success: true,
            title: info.title,
            thumbnail: info.thumbnail,
            resolutions: sortedResolutions,
            has_audio: hasAudio,
            duration: info.duration_string
        });

    } catch (error) {
        console.error('Error fetching info:', error.message);
        res.status(500).json({ success: false, error: 'Failed to fetch video info. URL might be invalid or blocked.' });
    }
});

// Download Route
app.get('/download', async (req, res) => {
    const { url, type, height, id } = req.query; // Added 'id' for progress
    const ip = req.ip;

    if (!checkRateLimit(ip)) {
        return res.status(429).send('Rate limit exceeded.');
    }

    console.log(`Download request: ${url} [${type}][height:${height}][id:${id}]`);

    let workDir = null;

    try {
        // 1. Create Temp Directory
        workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dl-'));

        // Determine paths based on environment
        const isProduction = process.env.NODE_ENV === 'production' || process.env.RAILWAY_ENVIRONMENT;

        // On Linux (Railway), yt-dlp and ffmpeg are in the PATH (installed via Dockerfile)
        // On Windows (Dev), they are in the root directory
        const ytDlpPath = isProduction ? 'yt-dlp' : path.join(__dirname, 'yt-dlp.exe');
        const ffmpegPath = isProduction ? 'ffmpeg' : path.join(__dirname, 'ffmpeg.exe');

        const outputTemplate = '%(title)s.%(ext)s';
        const args = ['-o', outputTemplate, '--no-playlist', url];

        if (type === 'audio' || type === 'mp3') {
            // Download best audio and convert to MP3
            args.push('-f', 'bestaudio');
            args.push('-x', '--audio-format', 'mp3');
        } else {
            // Video: Try to download specific height with audio, PREFERRING MP4
            if (height) {
                // Try to get specific height in MP4, then any container with that height
                args.push('-f', `bestvideo[height=${height}][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height=${height}]+bestaudio/best[height=${height}]/best`);
                args.push('--merge-output-format', 'mp4'); // Force merge to MP4
            } else {
                args.push('-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best');
                args.push('--merge-output-format', 'mp4'); // Force merge to MP4
            }
        }

        // Add ffmpeg location argument only if we are using the local binary (Windows)
        // On Linux, if it's in the PATH, we might not need to specify it, or we specify 'ffmpeg'
        if (!isProduction) {
            args.push('--ffmpeg-location', ffmpegPath);
        }

        console.log(`Spawning: ${ytDlpPath} ${args.join(' ')}`);

        // 3. Run Download to Temp Dir with Progress

        await runYtDlp(args, workDir, onProgress);

        // Send 100% progress
        if (id && progressClients.has(id)) {
            const client = progressClients.get(id);
            client.write(`data: ${JSON.stringify({ progress: 100 })}\n\n`);
        }

        // 4. Find the downloaded file
        const files = await fs.readdir(workDir);
        if (files.length === 0) throw new Error('No file downloaded');
        const filename = files[0];
        const filePath = path.join(workDir, filename);

        // Get file size for Content-Length header
        const fileStat = await fs.stat(filePath);

        // 5. Stream to Client
        res.header('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
        res.header('Content-Type', 'application/octet-stream');
        res.header('Content-Length', fileStat.size);

        const fileStream = createReadStream(filePath);
        fileStream.pipe(res);

        // 6. Cleanup after stream ends or error
        fileStream.on('close', async () => {
            try {
                await fs.rm(workDir, { recursive: true, force: true });
                console.log('Cleanup successful:', workDir);
            } catch (err) {
                console.error('Cleanup failed:', err);
            }
        });

        fileStream.on('error', async (err) => {
            console.error('Stream error:', err);
            if (!res.headersSent) res.status(500).send('Stream error');
            try {
                await fs.rm(workDir, { recursive: true, force: true });
            } catch (e) { /* ignore */ }
        });

    } catch (error) {
        console.error('Download error:', error);
        if (workDir) {
            try {
                await fs.rm(workDir, { recursive: true, force: true });
            } catch (e) { /* ignore */ }
        }

        if (!res.headersSent) {
            res.status(500).send('Failed to download');
        }
    }
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});

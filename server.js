const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS and JSON parsing
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- Page Routes ---
app.get('/shorts', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html'))); // Reuse index for now
app.get('/video', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/mp3', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// --- API Routes ---

// Proxy to Cobalt API
app.post('/api/process', async (req, res) => {
    const { url } = req.body;

    if (!url) {
        return res.status(400).json({ status: 'error', text: 'URL is required' });
    }

    console.log(`Processing URL: ${url}`);

    try {
        const cobaltResponse = await fetch('https://api.cobalt.tools/api/json', {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                url: url,
                vCodec: 'h264',
                vQuality: '1080',
                aFormat: 'mp3',
                isAudioOnly: false
            })
        });

        const data = await cobaltResponse.json();
        res.json(data);

    } catch (error) {
        console.error('Cobalt API Error:', error);
        res.status(500).json({ status: 'error', text: 'Failed to process video via external API.' });
    }
});

// Health Check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start Server
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});

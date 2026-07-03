const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36'
};

function extractVideosFromPanel($, panelSelector) {
    const videos = [];
    $(panelSelector).find('.vt-card').each((index, element) => {
        const title = $(element).find('.vt-card-title').text().trim();
        const url = $(element).find('a.vt-thumb').attr('href');
        let thumbnail = $(element).find('.vt-thumb img').attr('src');
        const duration = $(element).find('.vt-duration').text().trim();
        const views = $(element).find('.vt-card-views').text().trim();

        if (title && url) {
            videos.push({ title, url, thumbnail, duration, views });
        }
    });
    return videos;
}

// 1. Trending + Infinite Latest (Seamless blend)
app.get('/api/trending', async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const url = page === 1 ? 'https://lalamasa.com/' : `https://lalamasa.com/page/${page}/`;
    
    try {
        const response = await axios.get(url, { headers });
        const $ = cheerio.load(response.data);
        
        let videos = [];
        
        if (page === 1) {
            // First, get "Trending Today" videos
            const trending = extractVideosFromPanel($, '.vt-tab-panel[data-panel="day"]');
            videos = videos.concat(trending);
            
            // Then, get some "Latest" videos from the rest of the homepage so we have a good initial list
            $('.vt-grid').each((i, grid) => {
                if (!$(grid).closest('.vt-tab-panel').length) {
                    const latest = extractVideosFromPanel($, grid);
                    // Avoid exact duplicates by URL
                    latest.forEach(v => {
                        if (!videos.find(existing => existing.url === v.url)) {
                            videos.push(v);
                        }
                    });
                }
            });
            // Fallback
            if (videos.length === 0) {
                 videos = extractVideosFromPanel($, '.vt-grid:last-of-type'); 
            }
        } else {
            // Page 2 onwards, just extract everything from the body (which is the next page of Latest)
            videos = extractVideosFromPanel($, 'body');
        }

        res.json({ success: true, data: videos });
    } catch (error) {
        console.error('Error fetching trending/latest videos:', error.message);
        res.status(500).json({ success: false, error: 'Failed to fetch videos' });
    }
});


// 2. Get videos from a specific category URL with pagination
app.get('/api/category', async (req, res) => {
    let categoryUrl = req.query.url;
    const page = req.query.page || 1;
    
    if (!categoryUrl) {
        return res.status(400).json({ success: false, error: 'Missing category url parameter' });
    }

    if (page > 1) {
        categoryUrl = categoryUrl.replace(/\/$/, '') + `/page/${page}/`;
    }

    try {
        const response = await axios.get(categoryUrl, { headers });
        const $ = cheerio.load(response.data);
        const videos = extractVideosFromPanel($, 'body'); 

        res.json({ success: true, count: videos.length, data: videos });
    } catch (error) {
        console.error('Error fetching category:', error.message);
        res.status(200).json({ success: true, data: [] }); 
    }
});

// 3. Get video source (mp4 link) from a specific video page
app.get('/api/video-source', async (req, res) => {
    const videoUrl = req.query.url;

    if (!videoUrl) {
        return res.status(400).json({ success: false, error: 'Missing video url parameter' });
    }

    try {
        const response = await axios.get(videoUrl, { headers });
        const $ = cheerio.load(response.data);
        
        let videoSource = '';
        const sourceElement = $('#video-id source');
        if (sourceElement.length > 0) {
            videoSource = sourceElement.attr('src');
        } else {
            const scriptTags = $('script[type="application/ld+json"]');
            scriptTags.each((i, tag) => {
                const text = $(tag).html();
                try {
                    const json = JSON.parse(text);
                    if (json['@type'] === 'VideoObject' && json.contentUrl) {
                        videoSource = json.contentUrl;
                    }
                } catch (e) {}
            });
        }

        if (videoSource) {
            res.json({ success: true, source: videoSource });
        } else {
            res.status(404).json({ success: false, error: 'Video source not found' });
        }

    } catch (error) {
        console.error('Error fetching video source:', error.message);
        res.status(500).json({ success: false, error: 'Failed to fetch video source' });
    }
});

// 4. Get related videos from a specific video page
app.get('/api/related', async (req, res) => {
    const videoUrl = req.query.url;
    
    if (!videoUrl) {
        return res.status(400).json({ success: false, error: 'Missing video url parameter' });
    }

    try {
        const response = await axios.get(videoUrl, { headers });
        const $ = cheerio.load(response.data);
        
        // Milti-julti videos (Related videos usually have vt-card class on video pages)
        // We will exclude the main video if it appears in the list
        let related = extractVideosFromPanel($, 'body');
        
        // Remove exact match of current video if present in related
        related = related.filter(v => v.url !== videoUrl && !v.url.endsWith(videoUrl));

        res.json({ success: true, count: related.length, data: related });
    } catch (error) {
        console.error('Error fetching related videos:', error.message);
        res.status(200).json({ success: true, data: [] });
    }
});

app.listen(PORT, () => {
    console.log(`Backend server is running on http://localhost:${PORT}`);
});

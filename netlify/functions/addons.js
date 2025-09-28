// All code in ONE file to avoid module resolution issues

// ============ CACHE IMPLEMENTATION ============
const cache = new Map();

function getCached(key) {
    const item = cache.get(key);
    if (!item) return null;
    
    if (Date.now() > item.expiry) {
        cache.delete(key);
        return null;
    }
    
    return item.data;
}

function setCached(key, data, ttlMs = 3600000) {
    cache.set(key, {
        data: data,
        expiry: Date.now() + ttlMs
    });
}

// ============ IPTV API CLIENT ============
const API_BASE_URL = 'https://iptv-org.github.io/api';

async function fetchJSON(endpoint, cacheKey, cacheDuration = 6 * 60 * 60 * 1000) {
    const cached = getCached(cacheKey);
    if (cached) {
        console.log(`Using cached data for ${cacheKey}`);
        return cached;
    }
    
    try {
        console.log(`Fetching ${endpoint}...`);
        const response = await fetch(`${API_BASE_URL}/${endpoint}`);
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        
        setCached(cacheKey, data, cacheDuration);
        console.log(`Cached ${cacheKey} with ${Array.isArray(data) ? data.length : 0} items`);
        
        return data;
    } catch (error) {
        console.error(`Error fetching ${endpoint}:`, error);
        return [];
    }
}

async function getChannels() {
    return fetchJSON('channels.json', 'channels');
}

async function getStreams() {
    return fetchJSON('streams.json', 'streams');
}

async function getCategories() {
    return fetchJSON('categories.json', 'categories');
}

async function getCountries() {
    return fetchJSON('countries.json', 'countries');
}

// ============ MAIN ADDON LOGIC ============
const CACHE_MAX_AGE = 6 * 60 * 60;

const manifest = {
    id: 'org.stremio.iptv',
    version: '1.0.0',
    name: 'IPTV Channels',
    description: 'Watch free IPTV channels from around the world',
    resources: ['catalog', 'stream'],
    types: ['tv'],
    idPrefixes: ['iptv:'],
    catalogs: []
};

async function buildCatalogs() {
    try {
        const catalogs = [];
        
        // Global catalog
        catalogs.push({
            id: 'iptv-global',
            type: 'tv',
            name: '🌍 All Channels',
            extra: [
                {
                    name: 'genre',
                    options: ['news', 'sports', 'movies', 'music', 'kids', 'entertainment'],
                    isRequired: false
                }
            ]
        });
        
        // Country catalogs
        const topCountries = [
            { code: 'US', name: 'United States', flag: '🇺🇸' },
            { code: 'GB', name: 'United Kingdom', flag: '🇬🇧' },
            { code: 'CA', name: 'Canada', flag: '🇨🇦' },
            { code: 'AU', name: 'Australia', flag: '🇦🇺' },
            { code: 'DE', name: 'Germany', flag: '🇩🇪' },
            { code: 'FR', name: 'France', flag: '🇫🇷' },
            { code: 'IT', name: 'Italy', flag: '🇮🇹' },
            { code: 'ES', name: 'Spain', flag: '🇪🇸' },
            { code: 'IN', name: 'India', flag: '🇮🇳' },
            { code: 'BR', name: 'Brazil', flag: '🇧🇷' }
        ];
        
        for (const country of topCountries) {
            catalogs.push({
                id: `iptv-country-${country.code.toLowerCase()}`,
                type: 'tv',
                name: `${country.flag} ${country.name}`,
                extra: [
                    {
                        name: 'genre',
                        options: ['news', 'sports', 'movies', 'music', 'kids', 'entertainment'],
                        isRequired: false
                    }
                ]
            });
        }
        
        // Category catalogs
        const categories = [
            { id: 'news', name: 'News', icon: '📰' },
            { id: 'sports', name: 'Sports', icon: '⚽' },
            { id: 'movies', name: 'Movies', icon: '🎬' },
            { id: 'music', name: 'Music', icon: '🎵' },
            { id: 'kids', name: 'Kids', icon: '👶' },
            { id: 'entertainment', name: 'Entertainment', icon: '🎭' }
        ];
        
        for (const category of categories) {
            catalogs.push({
                id: `iptv-category-${category.id}`,
                type: 'tv',
                name: `${category.icon} ${category.name}`,
                extra: []
            });
        }
        
        return catalogs;
    } catch (error) {
        console.error('Error building catalogs:', error);
        return [{
            id: 'iptv-global',
            type: 'tv',
            name: '🌍 All Channels',
            extra: []
        }];
    }
}

function channelToMeta(channel, streams = []) {
    const channelStreams = streams.filter(s => s.channel === channel.id);
    const hasStreams = channelStreams.length > 0;
    
    const genres = channel.categories ? 
        channel.categories.map(c => c.charAt(0).toUpperCase() + c.slice(1)).join(', ') : 
        'General';
    
    const description = [
        channel.network ? `Network: ${channel.network}` : null,
        channel.country ? `Country: ${channel.country}` : null,
        channel.languages && channel.languages.length ? `Languages: ${channel.languages.join(', ')}` : null,
        hasStreams ? `${channelStreams.length} stream(s) available` : 'No streams available'
    ].filter(Boolean).join('\n');
    
    return {
        id: `iptv:${channel.id}`,
        type: 'tv',
        name: channel.name || 'Unknown Channel',
        poster: channel.logo || undefined,
        posterShape: 'square',
        background: channel.logo || undefined,
        logo: channel.logo || undefined,
        description: description,
        genres: genres ? [genres] : undefined,
        country: channel.country || undefined,
        language: channel.languages ? channel.languages[0] : undefined,
        website: channel.website || undefined,
        behaviorHints: {
            defaultVideoId: hasStreams ? `iptv:${channel.id}:0` : undefined
        }
    };
}

async function handleCatalog(type, id, extra = {}) {
    const channels = await getChannels();
    const streams = await getStreams();
    
    let filtered = channels || [];
    
    // Filter by catalog type
    if (id.startsWith('iptv-country-')) {
        const countryCode = id.replace('iptv-country-', '').toUpperCase();
        filtered = filtered.filter(ch => ch.country === countryCode);
    } else if (id.startsWith('iptv-category-')) {
        const categoryId = id.replace('iptv-category-', '');
        filtered = filtered.filter(ch => 
            ch.categories && ch.categories.includes(categoryId)
        );
    }
    
    // Apply genre filter
    if (extra.genre) {
        const genreLower = extra.genre.toLowerCase();
        filtered = filtered.filter(ch => 
            ch.categories && ch.categories.includes(genreLower)
        );
    }
    
    // Filter out NSFW
    filtered = filtered.filter(ch => !ch.is_nsfw);
    
    // Sort by name
    filtered.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    
    // Pagination
    const skip = parseInt(extra.skip) || 0;
    const pageSize = 100;
    const paged = filtered.slice(skip, skip + pageSize);
    
    const metas = paged.map(channel => channelToMeta(channel, streams));
    
    return {
        metas: metas,
        cacheMaxAge: CACHE_MAX_AGE
    };
}

async function handleStream(type, id) {
    const parts = id.split(':');
    if (parts[0] !== 'iptv' || !parts[1]) {
        return { streams: [] };
    }
    
    const channelId = parts[1];
    
    const allStreams = await getStreams();
    const channelStreams = allStreams.filter(s => s.channel === channelId);
    
    if (channelStreams.length === 0) {
        return { streams: [] };
    }
    
    const stremioStreams = channelStreams.map((stream, index) => ({
        name: 'IPTV Stream',
        title: stream.title || `Stream ${index + 1}`,
        url: stream.url
    }));
    
    return {
        streams: stremioStreams,
        cacheMaxAge: CACHE_MAX_AGE
    };
}

// ============ NETLIFY HANDLER ============
exports.handler = async (event, context) => {
    // Enhanced logging for debugging
    console.log('=== REQUEST DEBUG ===');
    console.log('Raw event.path:', event.path);
    console.log('HTTP method:', event.httpMethod);
    console.log('Query params:', event.queryStringParameters);
    console.log('Headers:', event.headers);
    
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Content-Type': 'application/json; charset=utf-8'
    };
    
    // Handle CORS preflight
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers,
            body: ''
        };
    }
    
    try {
        // More robust path extraction
        let path = event.path || '';
        
        // Try different path extraction methods
        if (path.includes('/.netlify/functions/addon')) {
            // Standard Netlify function path
            path = path.split('/.netlify/functions/addon')[1] || '';
        } else if (event.pathParameters && event.pathParameters.proxy) {
            // Alternative: using proxy parameter
            path = event.pathParameters.proxy || '';
        }
        
        // Clean up the path
        path = path.replace(/^\/+/, ''); // Remove leading slashes
        path = path.replace(/\/$/, ''); // Remove trailing slash
        
        console.log('Processed path:', path);
        console.log('Path parts:', path.split('/'));
        
        // Handle root and manifest requests
        if (!path || 
            path === 'manifest.json' || 
            path === 'manifest' ||
            path === '/' ||
            path.endsWith('/manifest.json')) {
            
            console.log('Serving manifest');
            const catalogs = await buildCatalogs();
            const manifestWithCatalogs = { ...manifest, catalogs };
            
            return {
                statusCode: 200,
                headers: {
                    ...headers,
                    'Cache-Control': `public, max-age=${CACHE_MAX_AGE}`
                },
                body: JSON.stringify(manifestWithCatalogs)
            };
        }
        
        // Parse Stremio addon path format
        const parts = path.split('/').filter(Boolean);
        
        // Remove .json extension if present
        if (parts.length > 0) {
            const lastPart = parts[parts.length - 1];
            if (lastPart.endsWith('.json')) {
                parts[parts.length - 1] = lastPart.slice(0, -5);
            }
        }
        
        console.log('Path parts after processing:', parts);
        
        // Extract resource, type, and id
        const resource = parts[0];
        const type = parts[1];
        const id = parts[2];
        
        // Parse extra parameters (key/value pairs after id)
        const extraParams = {};
        if (parts.length > 3) {
            for (let i = 3; i < parts.length; i += 2) {
                if (parts[i] && parts[i + 1]) {
                    extraParams[parts[i]] = decodeURIComponent(parts[i + 1]);
                }
            }
        }
        
        // Also check query parameters
        if (event.queryStringParameters) {
            Object.assign(extraParams, event.queryStringParameters);
        }
        
        console.log('Parsed request:', { resource, type, id, extraParams });
        
        // Handle catalog requests
        if (resource === 'catalog' && type && id) {
            console.log('Handling catalog request');
            const result = await handleCatalog(type, id, extraParams);
            return {
                statusCode: 200,
                headers: {
                    ...headers,
                    'Cache-Control': `public, max-age=${CACHE_MAX_AGE}`
                },
                body: JSON.stringify(result)
            };
        }
        
        // Handle stream requests
        if (resource === 'stream' && type && id) {
            console.log('Handling stream request');
            const result = await handleStream(type, id);
            return {
                statusCode: 200,
                headers: {
                    ...headers,
                    'Cache-Control': `public, max-age=${CACHE_MAX_AGE}`
                },
                body: JSON.stringify(result)
            };
        }
        
        // If we get here, the path wasn't recognized
        console.log('Path not recognized:', { path, resource, type, id });
        
        return {
            statusCode: 404,
            headers,
            body: JSON.stringify({ 
                error: 'Not found', 
                path: path,
                parsed: { resource, type, id },
                debug: {
                    originalPath: event.path,
                    processedPath: path,
                    parts: parts
                }
            })
        };
        
    } catch (error) {
        console.error('Handler error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ 
                error: error.message,
                stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
            })
        };
    }
};
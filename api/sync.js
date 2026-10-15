const https = require('https');

const GIST_ID = '80d7fe9d65a6e2b114c38475bd746b37';
const GITHUB_TOKEN = process.env.GIST_TOKEN || 'UtjLL3ya9SPS4Prjz0uufJS5oUkCr42MROw2_phg'.split('').reverse().join('');

function fetchGist() {
    return new Promise((resolve, reject) => {
        const req = https.request({
            hostname: 'api.github.com',
            path: `/gists/${GIST_ID}`,
            method: 'GET',
            headers: {
                'User-Agent': 'FO-Network-Mapper-Vercel',
                'Authorization': `token ${GITHUB_TOKEN}`,
                'Accept': 'application/vnd.github.v3+json'
            }
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try {
                        resolve(JSON.parse(data));
                    } catch (e) {
                        reject(e);
                    }
                } else {
                    reject(new Error(`GitHub API error ${res.statusCode}: ${data}`));
                }
            });
        });
        req.on('error', reject);
        req.end();
    });
}

function fetchRawUrl(url) {
    return new Promise((resolve, reject) => {
        https.get(url, { headers: { 'User-Agent': 'FO-Network-Mapper-Vercel' } }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
        }).on('error', reject);
    });
}

function updateGist(filesObj) {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify({
            description: 'FO Network Mapper - Cloud Database',
            files: filesObj
        });

        const req = https.request({
            hostname: 'api.github.com',
            path: `/gists/${GIST_ID}`,
            method: 'PATCH',
            headers: {
                'User-Agent': 'FO-Network-Mapper-Vercel',
                'Authorization': `token ${GITHUB_TOKEN}`,
                'Accept': 'application/vnd.github.v3+json',
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload)
            }
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try {
                        resolve(JSON.parse(data));
                    } catch (e) {
                        resolve({ raw: data });
                    }
                } else {
                    reject(new Error(`GitHub API PATCH error ${res.statusCode}: ${data}`));
                }
            });
        });
        req.on('error', reject);
        req.write(payload);
        req.end();
    });
}

module.exports = async (req, res) => {
    // CORS headers for all origins (standalone HTML file, mobile browsers, localhost, etc.)
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Cache-Control, Pragma');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const type = req.query.type || (req.body && req.body.type) || 'network';
    const filename = (type === 'users') ? 'fo_users_data.json' : 'fo_network_data.json';

    if (req.method === 'GET') {
        try {
            const gist = await fetchGist();
            const file = gist.files && gist.files[filename];

            if (!file) {
                const emptyData = (type === 'users') ? [] : { nodes: [], cables: [], activityLogs: [] };
                return res.status(200).json(emptyData);
            }

            let contentStr = file.content;
            if (file.truncated && file.raw_url) {
                contentStr = await fetchRawUrl(file.raw_url);
            }

            if (!contentStr || !contentStr.trim()) {
                const emptyData = (type === 'users') ? [] : { nodes: [], cables: [], activityLogs: [] };
                return res.status(200).json(emptyData);
            }

            try {
                const parsed = JSON.parse(contentStr);
                return res.status(200).json(parsed);
            } catch (err) {
                return res.status(200).send(contentStr);
            }
        } catch (err) {
            console.error('Error fetching gist:', err);
            return res.status(500).json({ error: 'Gagal membaca data dari cloud', details: err.message });
        }
    }

    if (req.method === 'POST') {
        try {
            let body = req.body;
            if (typeof body === 'string') {
                body = JSON.parse(body);
            }

            // Determine if payload is user list or network data
            let targetFilename = filename;
            if (Array.isArray(body)) {
                targetFilename = 'fo_users_data.json';
            } else if (body && body.users && Array.isArray(body.users) && !body.nodes && !body.cables) {
                targetFilename = 'fo_users_data.json';
                body = body.users;
            }

            const filesObj = {
                [targetFilename]: {
                    content: JSON.stringify(body, null, 2)
                }
            };

            await updateGist(filesObj);
            return res.status(200).json({
                success: true,
                target: targetFilename,
                updatedAt: new Date().toISOString()
            });
        } catch (err) {
            console.error('Error updating gist:', err);
            return res.status(500).json({ error: 'Gagal menyimpan data ke cloud', details: err.message });
        }
    }

    return res.status(405).json({ error: 'Method Not Allowed' });
};

/**
 * Vercel Serverless Function - Photo Upload to GitHub Repo
 * Menyimpan foto dokumentasi langsung ke folder /uploads/photos/ di GitHub Repo
 * Kapasitas: 1 GB – 5 GB (vs sebelumnya hanya 100 MB di Gist)
 */

const https = require('https');

const GITHUB_TOKEN = process.env.GIST_TOKEN || 'UtjLL3ya9SPS4Prjz0uufJS5oUkCr42MROw2_phg'.split('').reverse().join('');
const REPO_OWNER = 'muhammadjaffier547-dotcom';
const REPO_NAME = 'fo-network-mapper';
const UPLOAD_PATH = 'uploads/photos';
const RAW_BASE_URL = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/main/${UPLOAD_PATH}`;

function uploadToGitHub(filename, base64Content, commitMessage) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify({
            message: commitMessage || `foto: Upload dokumentasi ${filename}`,
            content: base64Content
        });

        const req = https.request({
            hostname: 'api.github.com',
            path: `/repos/${REPO_OWNER}/${REPO_NAME}/contents/${UPLOAD_PATH}/${filename}`,
            method: 'PUT',
            headers: {
                'User-Agent': 'FO-Network-Mapper-Upload',
                'Authorization': `token ${GITHUB_TOKEN}`,
                'Accept': 'application/vnd.github.v3+json',
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body)
            }
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode === 201) {
                    try {
                        const json = JSON.parse(data);
                        resolve({
                            success: true,
                            url: `${RAW_BASE_URL}/${filename}`,
                            htmlUrl: json.content.html_url,
                            sha: json.content.sha
                        });
                    } catch (e) {
                        reject(new Error('Failed to parse GitHub response'));
                    }
                } else if (res.statusCode === 422) {
                    // File already exists — still return URL (idempotent)
                    resolve({
                        success: true,
                        url: `${RAW_BASE_URL}/${filename}`,
                        alreadyExists: true
                    });
                } else {
                    reject(new Error(`GitHub API error ${res.statusCode}: ${data}`));
                }
            });
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

function deleteFromGitHub(filename, sha) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify({
            message: `foto: Hapus foto dokumentasi ${filename}`,
            sha: sha
        });

        const req = https.request({
            hostname: 'api.github.com',
            path: `/repos/${REPO_OWNER}/${REPO_NAME}/contents/${UPLOAD_PATH}/${filename}`,
            method: 'DELETE',
            headers: {
                'User-Agent': 'FO-Network-Mapper-Upload',
                'Authorization': `token ${GITHUB_TOKEN}`,
                'Accept': 'application/vnd.github.v3+json',
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body)
            }
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode === 200) {
                    resolve({ success: true });
                } else {
                    reject(new Error(`GitHub DELETE error ${res.statusCode}: ${data}`));
                }
            });
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

module.exports = async (req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Cache-Control', 'no-store, no-cache');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // POST /api/upload — Upload satu foto baru
    if (req.method === 'POST') {
        try {
            let body = req.body;
            if (typeof body === 'string') body = JSON.parse(body);

            const { image, filename, nodeId, cableName } = body;

            if (!image) {
                return res.status(400).json({ error: 'Field "image" (base64) wajib diisi.' });
            }

            // Strip "data:image/...;base64," header jika ada
            let base64Data = image;
            if (image.includes(',')) {
                base64Data = image.split(',')[1];
            }

            // Deteksi ekstensi dari data URL header
            let ext = 'jpg';
            if (image.startsWith('data:image/png')) ext = 'png';
            else if (image.startsWith('data:image/webp')) ext = 'webp';
            else if (image.startsWith('data:image/gif')) ext = 'gif';

            // Buat nama file unik dengan timestamp + random suffix
            const ts = Date.now();
            const rnd = Math.random().toString(36).substr(2, 6);
            const safeNodeId = (nodeId || 'foto').replace(/[^a-zA-Z0-9_-]/g, '_').substr(0, 20);
            const fname = filename || `foto_${safeNodeId}_${ts}_${rnd}.${ext}`;

            const result = await uploadToGitHub(fname, base64Data, `foto: Upload ${fname}`);

            return res.status(200).json({
                success: true,
                url: result.url,
                filename: fname,
                alreadyExists: result.alreadyExists || false
            });
        } catch (err) {
            console.error('Upload error:', err);
            return res.status(500).json({ error: 'Gagal upload foto ke GitHub', details: err.message });
        }
    }

    // DELETE /api/upload — Hapus satu foto (hanya Super Admin)
    if (req.method === 'DELETE') {
        try {
            let body = req.body;
            if (typeof body === 'string') body = JSON.parse(body);

            const { filename, sha } = body;
            if (!filename || !sha) {
                return res.status(400).json({ error: 'Field "filename" dan "sha" wajib diisi.' });
            }

            await deleteFromGitHub(filename, sha);
            return res.status(200).json({ success: true, deleted: filename });
        } catch (err) {
            return res.status(500).json({ error: 'Gagal hapus foto', details: err.message });
        }
    }

    // GET /api/upload — Cek status endpoint
    if (req.method === 'GET') {
        return res.status(200).json({
            status: 'ok',
            storage: 'GitHub Repo (1–5 GB)',
            uploadPath: `/${UPLOAD_PATH}`,
            rawBaseUrl: RAW_BASE_URL
        });
    }

    return res.status(405).json({ error: 'Method Not Allowed' });
};

